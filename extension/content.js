let subtitleContainer = null;
let textEl = null;
let hideTimeout = null;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let posX = null;
let posY = null;
let finalShownAt = 0;
const FINAL_HOLD_MS = 3000;

createSubtitleOverlay();

function createSubtitleOverlay() {
  if (document.getElementById('subtitleai-container')) {
    subtitleContainer = document.getElementById('subtitleai-container');
    textEl = document.getElementById('subtitleai-text');
    return;
  }

  subtitleContainer = document.createElement('div');
  subtitleContainer.id = 'subtitleai-container';
  subtitleContainer.innerHTML = `<div id="subtitleai-text"></div>`;

  Object.assign(subtitleContainer.style, {
    position: 'fixed',
    bottom: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '75vw',
    textAlign: 'center',
    cursor: 'grab',
    userSelect: 'none',
  });

  textEl = subtitleContainer.querySelector('#subtitleai-text');
  Object.assign(textEl.style, {
    background: 'rgba(18, 18, 24, 0.88)',
    color: '#f0ece4',
    padding: '12px 28px',
    borderRadius: '10px',
    fontFamily: 'Segoe UI, Inter, Arial, sans-serif',
    fontSize: '22px',
    fontWeight: '500',
    lineHeight: '1.6',
    letterSpacing: '0.15px',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    maxWidth: '100%',
    wordWrap: 'break-word',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
    transition: 'opacity 0.35s ease',
    backdropFilter: 'blur(8px)',
    opacity: '0'
  });

  // Drag on the text box itself
  subtitleContainer.addEventListener('mousedown', (e) => {
    isDragging = true;
    subtitleContainer.style.cursor = 'grabbing';

    const rect = subtitleContainer.getBoundingClientRect();
    subtitleContainer.style.transform = 'none';
    subtitleContainer.style.bottom = 'auto';
    subtitleContainer.style.left = rect.left + 'px';
    subtitleContainer.style.top = rect.top + 'px';

    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    posX = e.clientX - dragOffsetX;
    posY = e.clientY - dragOffsetY;
    subtitleContainer.style.left = posX + 'px';
    subtitleContainer.style.top = posY + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      subtitleContainer.style.cursor = 'grab';
    }
  });

  document.body.appendChild(subtitleContainer);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_SUBTITLE') {
    handleSubtitle(message.text, message.is_final, message.mode);
    sendResponse({ success: true });
  }
  if (message.type === 'HIDE_SUBTITLES') {
    hideSubtitles();
    sendResponse({ success: true });
  }
});

function handleSubtitle(text, isFinal, mode) {
  if (!text || text.trim() === '') return;

  subtitleContainer = document.getElementById('subtitleai-container');
  textEl = document.getElementById('subtitleai-text');
  if (!subtitleContainer || !textEl) createSubtitleOverlay();

  // Restore dragged position
  if (posX !== null) {
    subtitleContainer.style.left = posX + 'px';
    subtitleContainer.style.top = posY + 'px';
    subtitleContainer.style.transform = 'none';
    subtitleContainer.style.bottom = 'auto';
  }

  subtitleContainer.style.display = 'flex';

  const now = Date.now();

  if (isFinal) {
    finalShownAt = now;
    showText(text, true);
  } else {
    if (now - finalShownAt < FINAL_HOLD_MS) return;
    showText(text, false);
  }
}

function showText(text, isFinal) {
  clearTimeout(hideTimeout);

  textEl.style.opacity = '0';

  // Small fade-in delay for smooth feel
  setTimeout(() => {
    textEl.textContent = text;
    textEl.style.opacity = '1';
    // Final = warm white, interim = slightly dimmer
    textEl.style.color = isFinal ? '#f0ece4' : '#b8b4ac';
    textEl.style.fontWeight = isFinal ? '500' : '400';
  }, 80);

  if (isFinal) {
    hideTimeout = setTimeout(() => {
      if (textEl) textEl.style.opacity = '0';
    }, 6000);
  }
}

function hideSubtitles() {
  if (subtitleContainer) subtitleContainer.style.display = 'none';
  if (textEl) textEl.style.opacity = '0';
  clearTimeout(hideTimeout);
}

document.addEventListener('fullscreenchange', () => {
  if (!subtitleContainer) return;
  if (document.fullscreenElement) {
    document.fullscreenElement.appendChild(subtitleContainer);
  } else {
    document.body.appendChild(subtitleContainer);
  }
});

const observer = new MutationObserver(() => {
  if (!document.getElementById('subtitleai-container')) {
    createSubtitleOverlay();
  }
});
observer.observe(document.body, { childList: true, subtree: false });