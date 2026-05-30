// offscreen.js — runs in offscreen document
// Has access to navigator.mediaDevices unlike service worker

let mediaRecorder = null;
let websocket = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'START_CAPTURE') {
    startCapture(message.streamId, message.settings)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ success: true });
    return true;
  }
});

async function startCapture(streamId, settings) {
  // Get media stream from tab
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Play audio back so user can still hear
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  
  // Connect to destination so audio plays through speakers
  source.connect(audioContext.destination);

  // Connect WebSocket to backend
  websocket = new WebSocket('ws://localhost:8000/ws/transcribe');

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend connection timeout')), 5000);
    websocket.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    websocket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Backend not reachable')); });
  });

  // Send config IMMEDIATELY after connection opens — before any audio
  websocket.send(JSON.stringify({
    type: 'config',
    sourceLang: settings.sourceLang || 'auto',
    mode: settings.mode || 'subtitles',
    fontSize: settings.fontSize || '22'
  }));

  console.log('[Offscreen] Config sent:', settings.sourceLang, settings.mode);

  websocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    chrome.runtime.sendMessage({ 
      target: 'background',
      type: 'TRANSCRIPT', 
      data 
    });
  };

  websocket.onerror = () => {
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'error' });
  };

  websocket.onclose = () => {
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'disconnected' });
  };

  // ScriptProcessor for raw PCM audio
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (websocket?.readyState === WebSocket.OPEN) {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      websocket.send(int16.buffer);
    }
  };

  // Store references for cleanup
  window._audioContext = audioContext;
  window._processor = processor;
  window._stream = stream;

  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: 'connected' });
}

function stopCapture() {
  if (window._processor) {
    window._processor.disconnect();
    window._processor = null;
  }
  if (window._audioContext) {
    window._audioContext.close();
    window._audioContext = null;
  }
  if (window._stream) {
    window._stream.getTracks().forEach(t => t.stop());
    window._stream = null;
  }
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.close();
  }
  websocket = null;
}