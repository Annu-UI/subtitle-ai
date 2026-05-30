<div align="center">

# ◈ SubtitleAI

**Real-time AI subtitles for any streaming platform — YouTube, Netflix, Prime Video, and beyond.**  
No subscriptions. No manual setup. Just click and watch in any language.

<img src="assets/popup.png" width="900"/>

<br/>

![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-WebSocket-009688?style=flat-square&logo=fastapi&logoColor=white)
![Deepgram](https://img.shields.io/badge/Deepgram-Nova--2-13EF93?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-Japanese%20%7C%20Korean%20%7C%20Hindi%20%7C%20Chinese-c8a97e?style=flat-square)

</div>

---

## What Is This?

SubtitleAI is a Chrome extension that generates live subtitles for any video playing in your browser — in real time, across any language, with no manual configuration.

Open a Japanese anime, a Korean drama, a Hindi film — click one button and English subtitles appear directly over the video. Drag them anywhere. Switch between captions (original language) and translated subtitles instantly.

---

## Demo

<div align="center">
<img src="assets/subtitle.png" width="80%"/>
<br/>
<sub>Live English subtitles on a Japanese YouTube video — 150ms average latency</sub>
</div>

---

## Performance (Real Measurements)

Tested across 100+ sentences in Japanese, Korean, and Hindi:

| Metric | Value |
|---|---|
| Average latency | **150ms** |
| p95 latency | **259ms** |
| p99 latency | **260ms** |
| Languages tested | Japanese, Korean, Hindi, English |
| Platforms tested | YouTube, BBC News, Prime Video |

---

## How It Works

```
Browser tab (any streaming platform)
         ↓
Chrome tabCapture API — captures tab audio
         ↓
offscreen.js — converts to 16kHz PCM via AudioContext + ScriptProcessor
         ↓
WebSocket → FastAPI backend (localhost:8000)
         ↓
Deepgram Nova-2 — real-time speech-to-text
(language-specific model: ja / ko / hi / multi)
         ↓
Context-buffered translation (2-sentence window)
         ↓
WebSocket → Chrome extension background worker
         ↓
content.js — injects subtitle overlay into video page
(fixed position, draggable, z-index: 2147483647)
```

---

## Two Modes

**CC Captions** — transcribes in the original language. Word by word as the person speaks. Identical to native closed captions.

**Subtitles (EN)** — original language builds interim, then switches to English translation on sentence completion. Context-buffered across 2 sentences for better translation accuracy.

---

## Architecture

```
subtitle-ai/
├── backend/
│   ├── main.py          # FastAPI WebSocket server
│   │                    # Deepgram integration + translation pipeline
│   │                    # Session latency tracking (p50/p95/p99)
│   ├── logs/            # Per-session JSON stats
│   └── .env             # API keys
└── extension/
    ├── manifest.json    # MV3 extension config
    ├── background.js    # Service worker — tab ID management, message routing
    ├── offscreen.js     # Audio capture — tabCapture → PCM → WebSocket
    ├── content.js       # Subtitle overlay — draggable, fullscreen-aware
    ├── popup.html       # Extension UI
    └── popup.js         # Mode toggle, language selector, stats display
```

---

## Key Engineering Decisions

**Why offscreen document?**
Chrome Manifest V3 service workers don't have access to `navigator.mediaDevices`. The offscreen document pattern gives us a sandboxed context with full Web APIs while keeping the service worker lean.

**Why PCM over WebM/Opus?**
MediaRecorder with WebM produces container headers every chunk — Deepgram's streaming API expects raw audio. Converting Float32 → Int16 PCM at 16kHz gives clean, header-free audio chunks with consistent 8192-byte payloads.

**Why context-buffered translation?**
Translating individual sentence fragments produces inaccurate results — "なんでだろう" alone translates poorly, but buffered with the preceding sentence gives correct context. 2-sentence window balances accuracy vs display latency.

**Why p95/p99 latency tracking?**
Average latency is misleading for real-time systems. Tracking percentiles gives a true picture of tail latency — the worst 5% of sentences determine whether the system feels responsive.

---

## Setup

### Prerequisites
- Chrome browser
- Python 3.11
- Deepgram API key (free tier available at deepgram.com)

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux

pip install -r requirements.txt

# Create .env
echo "DEEPGRAM_API_KEY=your_key_here" > .env

uvicorn main:app --reload --port 8000
```

### Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

The SubtitleAI icon appears in your toolbar.

---

## Usage

1. Open any video on YouTube, Netflix, Prime, or any streaming site
2. Click the **SubtitleAI** icon in Chrome toolbar
3. Select video language (or leave on Auto Detect)
4. Choose mode — **CC Captions** or **Subtitles EN**
5. Click **▶ START SUBTITLES**
6. Subtitles appear over the video — drag to reposition

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, tabCapture API, Offscreen Documents |
| Audio Processing | Web Audio API, ScriptProcessor, PCM conversion |
| Backend | FastAPI, WebSockets, asyncio |
| Transcription | Deepgram Nova-2 (ja/ko/hi/multi) |
| Translation | Google Translate (context-buffered) |
| Real-time | Bidirectional WebSocket, asyncio Queue |

---

## Limitations

- Requires local backend running (deployment coming soon)
- Translation accuracy varies — best on Japanese and Korean, good on Hindi
- Audio slightly suppressed during capture (Chrome tabCapture limitation)
- Netflix DRM may block audio capture on some content

---

## Author

**Annu Kumari**  
B.Tech Mathematics and Computing, IIT Guwahati  
[LinkedIn](https://linkedin.com/in/annu-kumari-b5098a332) &nbsp;|&nbsp; [GitHub](https://github.com/Annu-UI)