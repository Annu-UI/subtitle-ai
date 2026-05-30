const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const latencyVal = document.getElementById('latencyVal');
const wordsVal = document.getElementById('wordsVal');
const sourceLang = document.getElementById('sourceLang');
const fontSize = document.getElementById('fontSize');
const modeBtns = document.querySelectorAll('.mode-btn');

let currentMode = 'subtitles';

// Load saved settings
chrome.storage.local.get(['sourceLang', 'fontSize', 'mode'], (result) => {
  if (result.sourceLang) sourceLang.value = result.sourceLang;
  if (result.fontSize) fontSize.value = result.fontSize;
  if (result.mode) {
    currentMode = result.mode;
    updateModeUI(currentMode);
  }
});

// Mode toggle
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    updateModeUI(currentMode);
    chrome.storage.local.set({ mode: currentMode });
  });
});

function updateModeUI(mode) {
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// Check status
chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
  if (response?.isCapturing) {
    setUIState('capturing');
    wordsVal.textContent = response.wordCount || 0;
  }
});

// Start
startBtn.addEventListener('click', async () => {
  const settings = {
    sourceLang: sourceLang.value,
    fontSize: fontSize.value,
    mode: currentMode
  };

  chrome.storage.local.set(settings);

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab) {
    setStatus('error', 'No active tab found');
    return;
  }

  setStatus('connecting', 'Connecting...');
  startBtn.disabled = true;

  chrome.runtime.sendMessage(
    {
      action: 'START_CAPTURE',
      tabId: tab.id,
      settings
    },
    (response) => {
      if (response?.success) {
        setUIState('capturing');
      } else {
        setUIState('idle');
        setStatus('error', response?.error || 'Failed — is backend running?');
      }
    }
  );
});

// Stop
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP_CAPTURE' }, () => {
    setUIState('idle');
  });
});

// Listen for updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE') {
    handleStatusUpdate(message.status);
  }
  if (message.type === 'STATS_UPDATE') {
    if (message.latency) latencyVal.textContent = Math.round(message.latency);
    if (message.wordCount !== undefined) wordsVal.textContent = message.wordCount;
  }
});

function handleStatusUpdate(status) {
  const states = {
    connected:    { dot: 'active', text: 'Live — active' },
    disconnected: { dot: '',       text: 'Disconnected' },
    error:        { dot: 'error',  text: 'Error' },
    stopped:      { dot: '',       text: 'Stopped' },
    connecting:   { dot: '',       text: 'Connecting...' }
  };
  const state = states[status];
  if (state) {
    statusDot.className = `status-dot ${state.dot}`;
    statusText.textContent = state.text;
  }
}

function setUIState(state) {
  if (state === 'capturing') {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Live — active';
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusDot.className = 'status-dot';
    statusText.textContent = 'Ready — click Start on a video tab';
    latencyVal.textContent = '--';
  }
}

function setStatus(type, text) {
  statusDot.className = `status-dot ${type === 'error' ? 'error' : ''}`;
  statusText.textContent = text;
}