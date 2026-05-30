import asyncio
import json
import time
import os
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from deepgram import DeepgramClient, DeepgramClientOptions, LiveTranscriptionEvents, LiveOptions
from deep_translator import GoogleTranslator
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SubtitleAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

@app.get("/")
async def root():
    return {"status": "SubtitleAI backend running"}


@app.websocket("/ws/transcribe")
async def transcribe_websocket(websocket: WebSocket):
    await websocket.accept()
    print("[Backend] Extension connected")

    loop = asyncio.get_event_loop()
    transcript_queue = asyncio.Queue()
    latency_log = []
    last_send_time = [time.time() * 1000]

    # Sentence buffer for context-aware translation
    sentence_buffer = []
    MAX_BUFFER = 2  # translate every 2 sentences together

    # Wait for config FIRST before starting Deepgram
    config = {}
    try:
        first_message = await asyncio.wait_for(websocket.receive(), timeout=5.0)
        if "text" in first_message:
            config = json.loads(first_message["text"])
            print(f"[Backend] Config received — source: {config.get('sourceLang')}, mode: {config.get('mode')}")
    except asyncio.TimeoutError:
        print("[Backend] No config received, using defaults")
        config = {"sourceLang": "auto", "mode": "subtitles"}

    source_lang = config.get("sourceLang", "auto")
    mode = config.get("mode", "subtitles")

    dg_client = DeepgramClient(
        DEEPGRAM_API_KEY,
        DeepgramClientOptions(options={"keepalive": "true"})
    )
    dg_connection = dg_client.listen.websocket.v("1")

    def translate_text(text):
        """Translate text to English using Google Translate."""
        try:
            src = "auto" if source_lang == "auto" else source_lang
            return GoogleTranslator(source=src, target="en").translate(text)
        except Exception as e:
            print(f"[Backend] Translation error: {e}")
            return text

    def on_transcript(self_handler, result, **kwargs):
        try:
            transcript = result.channel.alternatives[0].transcript
            print(f"[Deepgram Raw] is_final={result.is_final}, transcript='{transcript}'")

            if not transcript:
                return

            is_final = result.is_final

            receive_time = time.time() * 1000
            latency_ms = receive_time - last_send_time[0]
            latency_log.append(latency_ms)
            if len(latency_log) > 100:
                latency_log.pop(0)
            p95 = float(np.percentile(latency_log, 95)) if len(latency_log) >= 10 else None

            if mode == "captions":
                # Captions — always show original language, no translation
                response = {
                    "type": "transcript",
                    "text": transcript,
                    "translated": transcript,
                    "is_final": is_final,
                    "mode": "captions",
                    "latency_ms": round(latency_ms, 1),
                    "p95_latency": round(p95, 1) if p95 else None
                }
                asyncio.run_coroutine_threadsafe(
                    transcript_queue.put(response), loop
                )

            else:
                # Subtitles mode
                if not is_final:
                    # Interim — show original language as it builds
                    response = {
                        "type": "transcript",
                        "text": transcript,
                        "translated": transcript,  # no translation for interim
                        "is_final": False,
                        "mode": "subtitles",
                        "latency_ms": round(latency_ms, 1),
                        "p95_latency": round(p95, 1) if p95 else None
                    }
                    asyncio.run_coroutine_threadsafe(
                        transcript_queue.put(response), loop
                    )
                else:
                    # Final — buffer sentences and translate together
                    sentence_buffer.append(transcript)

                    if len(sentence_buffer) >= MAX_BUFFER:
                        # Translate buffered sentences together for better context
                        combined = " ".join(sentence_buffer)
                        translated = translate_text(combined)
                        print(f"[Backend] '{combined}' → '{translated}' (latency:{latency_ms:.0f}ms)")
                        sentence_buffer.clear()

                        response = {
                            "type": "transcript",
                            "text": combined,
                            "translated": translated,
                            "is_final": True,
                            "mode": "subtitles",
                            "latency_ms": round(latency_ms, 1),
                            "p95_latency": round(p95, 1) if p95 else None
                        }
                        asyncio.run_coroutine_threadsafe(
                            transcript_queue.put(response), loop
                        )
                    else:
                        # Buffer not full yet — translate individually as fallback
                        # so screen doesn't feel frozen
                        translated = translate_text(transcript)
                        print(f"[Backend] (buffering) '{transcript}' → '{translated}'")

                        response = {
                            "type": "transcript",
                            "text": transcript,
                            "translated": translated,
                            "is_final": True,
                            "mode": "subtitles",
                            "latency_ms": round(latency_ms, 1),
                            "p95_latency": round(p95, 1) if p95 else None
                        }
                        asyncio.run_coroutine_threadsafe(
                            transcript_queue.put(response), loop
                        )

        except Exception as e:
            print(f"[Backend] Transcript handler error: {e}")

    def on_error(self_handler, error, **kwargs):
        print(f"[Backend] Deepgram error: {error}")

    def on_close(self_handler, close, **kwargs):
        print("[Backend] Deepgram connection closed")

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_transcript)
    dg_connection.on(LiveTranscriptionEvents.Error, on_error)
    dg_connection.on(LiveTranscriptionEvents.Close, on_close)

    dg_language = "multi" if source_lang == "auto" else source_lang

    options = LiveOptions(
        model="nova-2",
        language=dg_language,
        smart_format=True,
        interim_results=True,
        encoding="linear16",
        channels=1,
        sample_rate=16000,
        endpointing=300,
        no_delay=True,
        punctuate=True,
    )

    print(f"[Backend] Starting Deepgram — language: {dg_language}, mode: {mode}")

    if not dg_connection.start(options):
        await websocket.send_json({"type": "error", "message": "Failed to connect to Deepgram"})
        return

    print("[Backend] Deepgram connection started")

    async def sender():
        while True:
            response = await transcript_queue.get()
            try:
                await websocket.send_json(response)
            except Exception as e:
                print(f"[Backend] Send error: {e}")
                break

    sender_task = asyncio.create_task(sender())

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message:
                audio_chunk = message["bytes"]
                if audio_chunk and len(audio_chunk) > 0:
                    last_send_time[0] = time.time() * 1000
                    dg_connection.send(audio_chunk)

    except WebSocketDisconnect:
        print("[Backend] Extension disconnected")
    except Exception as e:
        print(f"[Backend] Error: {e}")
    finally:
        sender_task.cancel()
        try:
            dg_connection.finish()
        except:
            pass
        # In the finally block, before "Session ended"
        session_stats = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "language": dg_language,
            "mode": mode,
            "total_sentences": len(latency_log),
            "avg_latency_ms": round(float(np.mean(latency_log)), 1) if latency_log else 0,
            "p95_latency_ms": round(float(np.percentile(latency_log, 95)), 1) if len(latency_log) >= 10 else 0,
            "p99_latency_ms": round(float(np.percentile(latency_log, 99)), 1) if len(latency_log) >= 10 else 0,
        }
        os.makedirs("logs", exist_ok=True)
        log_path = f"logs/session_{int(time.time())}.json"
        with open(log_path, "w") as f:
            json.dump(session_stats, f, indent=2)
        print(f"[Backend] Session stats saved: {session_stats}")
        print("[Backend] Session ended")