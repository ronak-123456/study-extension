console.log('Focus Flow Analyzer: Content script loaded');

// =============================================
// Shared Styles
// =============================================
const SHARED_STYLES = `
  .ff-notification-container {
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 2147483647;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: none;
  }

  .ff-notification-card {
    width: 360px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    pointer-events: auto;
    transform: translateY(-20px);
    opacity: 0;
    animation: ffSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes ffSlideIn {
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes ffSlideOut {
    to {
      transform: translateY(-20px);
      opacity: 0;
    }
  }

  .ff-logo-wrap {
    width: 64px;
    height: 64px;
    padding: 3px;
    border-radius: 18px;
    box-shadow: 0 6px 14px rgba(0,0,0,0.1);
  }

  .ff-logo-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 15px;
    background: white;
  }

  .ff-title {
    font-size: 18px;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.3px;
  }

  .ff-message {
    font-size: 14px;
    line-height: 1.6;
    margin: 0;
    color: #4b5563;
  }

  .ff-time-badge {
    font-size: 12px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
    letter-spacing: 0.3px;
  }

  .ff-btn {
    padding: 12px 24px;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .ff-btn:hover {
    transform: translateY(-1px);
  }

  .ff-btn:active {
    transform: translateY(0);
  }

  .ff-btn-row {
    display: flex;
    gap: 10px;
    width: 100%;
    justify-content: center;
  }
`;

// =============================================
// Initial Focus Nudge (on first switch to distraction)
// =============================================
function createNudgeModal(domain) {
  removeExisting();

  const container = document.createElement('div');
  container.id = 'focus-flow-nudge-container';
  container.className = 'ff-notification-container';

  const style = document.createElement('style');
  style.textContent = SHARED_STYLES + `
    #ff-nudge-card {
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.4);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.12);
    }

    #ff-nudge-card .ff-logo-wrap {
      background: linear-gradient(135deg, #6abf9b, #57ae8b);
    }

    #ff-nudge-card .ff-title {
      background: linear-gradient(135deg, #2d5f4d, #6abf9b);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    #ff-nudge-card .ff-btn-primary {
      background: #6abf9b;
      color: white;
      box-shadow: 0 4px 12px rgba(106, 191, 155, 0.3);
    }

    #ff-nudge-card .ff-btn-primary:hover {
      background: #57ae8b;
      box-shadow: 0 6px 16px rgba(106, 191, 155, 0.4);
    }
  `;

  const card = document.createElement('div');
  card.id = 'ff-nudge-card';
  card.className = 'ff-notification-card';
  card.innerHTML = `
    <div class="ff-logo-wrap">
      <img src="${chrome.runtime.getURL('logo.jpg')}" alt="Focus Flow">
    </div>
    <h3 class="ff-title">Stay Focused!</h3>
    <p class="ff-message">You wandered onto <strong>${domain}</strong>.<br>Time to get back to work!</p>
    <button class="ff-btn ff-btn-primary">Got it, focusing! ✨</button>
  `;

  card.querySelector('.ff-btn-primary').onclick = () => dismissNotification(container);

  container.appendChild(style);
  container.appendChild(card);
  document.body.appendChild(container);
  autoRemove(container, 10000);
}

// =============================================
// Graduated Distraction Block (every 10 min)
// =============================================
function createDistractionBlock(domain, minutes, message, severity) {
  removeExisting();

  const container = document.createElement('div');
  container.id = 'focus-flow-nudge-container';
  container.className = 'ff-notification-container';

  const colors = {
    low: { bg: 'rgba(255, 251, 235, 0.95)', border: '#fbbf24', accent: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.15)' },
    medium: { bg: 'rgba(255, 243, 235, 0.95)', border: '#fb923c', accent: '#ea580c', shadow: 'rgba(234, 88, 12, 0.15)' },
    high: { bg: 'rgba(254, 235, 235, 0.95)', border: '#f87171', accent: '#dc2626', shadow: 'rgba(220, 38, 38, 0.15)' }
  };
  const c = colors[severity] || colors.low;

  const style = document.createElement('style');
  style.textContent = SHARED_STYLES + `
    #ff-distraction-card {
      background: ${c.bg};
      border: 1.5px solid ${c.border};
      box-shadow: 0 20px 40px ${c.shadow}, 0 0 0 1px ${c.border}22;
    }

    #ff-distraction-card .ff-logo-wrap {
      background: linear-gradient(135deg, ${c.accent}, ${c.border});
    }

    #ff-distraction-card .ff-title {
      color: ${c.accent};
    }

    #ff-distraction-card .ff-message {
      color: #374151;
    }

    #ff-distraction-card .ff-time-badge {
      background: ${c.accent}18;
      color: ${c.accent};
      border: 1px solid ${c.accent}33;
    }

    #ff-distraction-card .ff-btn-leave {
      background: ${c.accent};
      color: white;
      box-shadow: 0 4px 12px ${c.shadow};
    }

    #ff-distraction-card .ff-btn-leave:hover {
      filter: brightness(1.1);
      box-shadow: 0 6px 16px ${c.shadow};
    }

    #ff-distraction-card .ff-btn-continue {
      background: transparent;
      color: ${c.accent};
      border: 1.5px solid ${c.accent}44;
    }

    #ff-distraction-card .ff-btn-continue:hover {
      background: ${c.accent}0d;
      border-color: ${c.accent}88;
    }
  `;

  const emoji = severity === 'high' ? '🚨' : severity === 'medium' ? '⚠️' : '⏰';
  const title = severity === 'high' ? 'Seriously, Close This!' : severity === 'medium' ? 'Still Distracted?' : 'Time Check!';

  const card = document.createElement('div');
  card.id = 'ff-distraction-card';
  card.className = 'ff-notification-card';
  card.innerHTML = `
    <div class="ff-logo-wrap">
      <img src="${chrome.runtime.getURL('logo.jpg')}" alt="Focus Flow">
    </div>
    <span class="ff-time-badge">${minutes} min on ${domain.replace('www.', '')}</span>
    <h3 class="ff-title">${emoji} ${title}</h3>
    <p class="ff-message">${message}</p>
    <div class="ff-btn-row">
      <button class="ff-btn ff-btn-leave">Leave & Focus 🎯</button>
      <button class="ff-btn ff-btn-continue">Continue</button>
    </div>
  `;

  card.querySelector('.ff-btn-leave').onclick = () => {
    dismissNotification(container);
    // Try to go back or close
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  };

  card.querySelector('.ff-btn-continue').onclick = () => dismissNotification(container);

  container.appendChild(style);
  container.appendChild(card);
  document.body.appendChild(container);

  // High severity: don't auto-remove, make them click
  if (severity !== 'high') {
    autoRemove(container, 20000);
  }
}

// =============================================
// Study Encouragement (milestones)
// =============================================
function createStudyEncouragement(domain, minutes, message) {
  removeExisting();

  const container = document.createElement('div');
  container.id = 'focus-flow-nudge-container';
  container.className = 'ff-notification-container';

  const style = document.createElement('style');
  style.textContent = SHARED_STYLES + `
    #ff-study-card {
      background: rgba(236, 253, 245, 0.95);
      border: 1.5px solid #6ee7b7;
      box-shadow: 0 20px 40px rgba(16, 185, 129, 0.12);
    }

    #ff-study-card .ff-logo-wrap {
      background: linear-gradient(135deg, #10b981, #059669);
    }

    #ff-study-card .ff-title {
      color: #059669;
    }

    #ff-study-card .ff-message {
      color: #065f46;
    }

    #ff-study-card .ff-time-badge {
      background: rgba(16, 185, 129, 0.1);
      color: #059669;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    #ff-study-card .ff-btn-primary {
      background: #10b981;
      color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }

    #ff-study-card .ff-btn-primary:hover {
      background: #059669;
    }

    @keyframes ffConfetti {
      0% { transform: scale(1); }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }

    #ff-study-card .ff-celebration {
      animation: ffConfetti 0.6s ease-in-out;
    }
  `;

  const timeLabel = minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;

  const card = document.createElement('div');
  card.id = 'ff-study-card';
  card.className = 'ff-notification-card ff-celebration';
  card.innerHTML = `
    <div class="ff-logo-wrap">
      <img src="${chrome.runtime.getURL('logo.jpg')}" alt="Focus Flow">
    </div>
    <span class="ff-time-badge">🎯 ${timeLabel} focused on ${domain.replace('www.', '')}</span>
    <h3 class="ff-title">🌟 Great Work!</h3>
    <p class="ff-message">${message}</p>
    <button class="ff-btn ff-btn-primary">Keep Going! 🚀</button>
  `;

  card.querySelector('.ff-btn-primary').onclick = () => dismissNotification(container);

  container.appendChild(style);
  container.appendChild(card);
  document.body.appendChild(container);
  autoRemove(container, 8000);
}

// =============================================
// Helpers
// =============================================
function removeExisting() {
  const existing = document.getElementById('focus-flow-nudge-container');
  if (existing) existing.remove();
}

function dismissNotification(container) {
  const card = container.querySelector('.ff-notification-card');
  if (card) {
    card.style.animation = 'ffSlideOut 0.3s ease-in forwards';
    setTimeout(() => container.remove(), 300);
  } else {
    container.remove();
  }
}

function autoRemove(container, ms) {
  setTimeout(() => {
    if (container.parentNode) {
      dismissNotification(container);
    }
  }, ms);
}

// =============================================
// Allowance Countdown Notification
// =============================================
function createAllowanceCountdown(domain, remainingSeconds, limitSeconds, level) {
  removeExisting();

  const container = document.createElement('div');
  container.id = 'focus-flow-nudge-container';
  container.className = 'ff-notification-container';

  const isExceeded = level === 'exceeded';
  const isCritical = level === 'critical';
  const borderColor = isExceeded ? '#dc2626' : isCritical ? '#f59e0b' : '#3b82f6';
  const bgColor = isExceeded ? 'rgba(254, 226, 226, 0.97)' : isCritical ? 'rgba(255, 251, 235, 0.97)' : 'rgba(239, 246, 255, 0.97)';
  const textColor = isExceeded ? '#991b1b' : isCritical ? '#92400e' : '#1e40af';

  const limitMin = Math.floor(limitSeconds / 60);
  const limitStr = limitMin >= 60 ? `${Math.floor(limitMin/60)}h${limitMin%60 > 0 ? ` ${limitMin%60}m` : ''}` : `${limitMin}m`;

  let countdownText;
  if (isExceeded) {
    countdownText = 'Time\'s up!';
  } else if (remainingSeconds < 60) {
    countdownText = `${remainingSeconds}s left`;
  } else {
    countdownText = `${Math.ceil(remainingSeconds / 60)}m left`;
  }

  const style = document.createElement('style');
  style.textContent = SHARED_STYLES + `
    #ff-allowance-card {
      background: ${bgColor};
      border: 2px solid ${borderColor};
      box-shadow: 0 20px 40px rgba(0,0,0,0.12);
    }
    #ff-allowance-card .ff-title { color: ${textColor}; }
    #ff-allowance-card .ff-message { color: ${textColor}; opacity: 0.85; }
    #ff-allowance-card .ff-countdown {
      font-size: 28px;
      font-weight: 900;
      color: ${borderColor};
      font-variant-numeric: tabular-nums;
    }
    #ff-allowance-card .ff-limit-label {
      font-size: 11px;
      color: ${textColor};
      opacity: 0.7;
      font-weight: 600;
    }
    #ff-allowance-card .ff-btn-leave {
      background: ${borderColor};
      color: white;
      box-shadow: 0 4px 12px ${borderColor}44;
    }
    #ff-allowance-card .ff-btn-leave:hover { filter: brightness(1.1); }
    #ff-allowance-card .ff-btn-continue {
      background: transparent;
      color: ${textColor};
      border: 1.5px solid ${borderColor}44;
    }
    #ff-allowance-card .ff-btn-continue:hover { background: ${borderColor}0d; }
  `;

  const emoji = isExceeded ? '🚫' : isCritical ? '⚠️' : '⏱️';
  const title = isExceeded ? 'Allowance Used Up!' : isCritical ? 'Almost Out of Time!' : 'Allowance Running Low';

  const card = document.createElement('div');
  card.id = 'ff-allowance-card';
  card.className = 'ff-notification-card';
  card.innerHTML = `
    <span class="ff-countdown">${countdownText}</span>
    <span class="ff-limit-label">${domain.replace('www.', '')} — ${limitStr}/day limit</span>
    <h3 class="ff-title">${emoji} ${title}</h3>
    <p class="ff-message">${isExceeded ? 'Your daily allowance is finished. Close this tab to stay on track!' : 'Wrap up what you\'re doing — time is almost up.'}</p>
    <div class="ff-btn-row">
      <button class="ff-btn ff-btn-leave">Leave Now 🎯</button>
      ${!isExceeded ? '<button class="ff-btn ff-btn-continue">OK</button>' : ''}
    </div>
  `;

  card.querySelector('.ff-btn-leave').onclick = () => {
    dismissNotification(container);
    if (window.history.length > 1) window.history.back();
    else window.close();
  };

  const continueBtn = card.querySelector('.ff-btn-continue');
  if (continueBtn) continueBtn.onclick = () => dismissNotification(container);

  container.appendChild(style);
  container.appendChild(card);
  document.body.appendChild(container);

  // Exceeded doesn't auto-dismiss
  if (!isExceeded) autoRemove(container, 15000);
}

// =============================================
// Message Listener
// =============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showFocusNudge') {
    createNudgeModal(request.domain);
  }
  if (request.action === 'showDistractionBlock') {
    createDistractionBlock(request.domain, request.minutes, request.message, request.severity);
  }
  if (request.action === 'showStudyEncouragement') {
    createStudyEncouragement(request.domain, request.minutes, request.message);
  }
  if (request.action === 'showAllowanceCountdown') {
    createAllowanceCountdown(request.domain, request.remainingSeconds, request.limitSeconds, request.level);
  }
});
