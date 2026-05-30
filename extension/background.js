// background.js — Service Worker (MV3)
// Manages offscreen document + message routing

let isCapturing = false;
let wordCount = 0;

// --- MESSAGE HANDLER ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'START_CAPTURE') {
    startCapture(message.tabId, message.settings)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'GET_STATUS') {
    sendResponse({ isCapturing, wordCount });
    return true;
  }

  // Forward transcript from offscreen to content + popup
  if (message.target === 'background' && message.type === 'TRANSCRIPT') {
    handleTranscript(message.data);
    return true;
  }

  // Forward status updates to popup
  if (message.type === 'STATUS_UPDATE') {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  }
});

// --- START CAPTURE ---
async function startCapture(tabId, settings) {
  // Store tab ID immediately — before anything else
  await chrome.storage.local.set({ captureTabId: tabId });
  console.log('[BG] Stored captureTabId:', tabId);

  // Close any existing offscreen document first
  const existing = await chrome.offscreen.hasDocument();
  if (existing) {
    await chrome.offscreen.closeDocument();
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  isCapturing = false;

  // Step 1: Get stream ID from tabCapture
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabId },
      (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      }
    );
  });

  // Step 2: Create offscreen document
  await createOffscreenDocument();

  // Step 3: Tell offscreen to start capture
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'START_CAPTURE',
    streamId,
    settings
  });

  if (!response?.success) {
    throw new Error(response?.error || 'Capture failed');
  }

  isCapturing = true;
  wordCount = 0;
}

// --- STOP CAPTURE ---
async function stopCapture() {
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'STOP_CAPTURE'
  }).catch(() => {});

  isCapturing = false;
  notifyContentScript({ type: 'HIDE_SUBTITLES' });
}

// --- HANDLE TRANSCRIPT ---
function handleTranscript(data) {
  if (data.type === 'transcript') {
    if (data.is_final) {
      wordCount += (data.translated || data.text).split(' ').filter(w => w).length;
    }

    chrome.storage.local.get(['captureTabId'], (result) => {
      const tabId = result.captureTabId;

      // What text to show depends on mode
      // Mode captions: always show original text
      // Mode subtitles: always show translated English
      const textToShow = data.mode === 'captions'
        ? data.text
        : (data.translated || data.text);

      if (!textToShow || !textToShow.trim()) return;

      console.log('[BG] Mode:', data.mode, '| Text:', textToShow);

      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_SUBTITLE',
          text: textToShow,
          is_final: data.is_final,
          mode: data.mode,
          latency: data.latency_ms
        }).catch((err) => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          }).then(() => {
            chrome.tabs.sendMessage(tabId, {
              type: 'SHOW_SUBTITLE',
              text: textToShow,
              is_final: data.is_final,
              mode: data.mode,
              latency: data.latency_ms
            }).catch(() => {});
          }).catch(() => {});
        });
      }
    });

    chrome.runtime.sendMessage({
      type: 'STATS_UPDATE',
      latency: data.latency_ms,
      wordCount
    }).catch(() => {});
  }
}
// --- CREATE OFFSCREEN DOCUMENT ---
async function createOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html');

  // Check if already exists
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;

  await chrome.offscreen.createDocument({
    url,
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio for real-time transcription'
  });
}

// --- HELPERS ---
function notifyContentScript(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      console.log('[BG] Sending text:', data.translated, '| original:', data.text);
      console.log('[BG] Sending to tab:', tabs[0].id, message);
      chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
    }
  });
}