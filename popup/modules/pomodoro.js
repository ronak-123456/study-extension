// Pomodoro timer UI

export function initPomodoro() {
  const MODES = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const LABELS = { focus: 'Focus Session', short: 'Short Break', long: 'Long Break' };
  let currentMode = 'focus';
  let timeLeft = MODES.focus;
  let running = false;
  let intervalId = null;

  const timeEl = document.getElementById('pomoTime');
  const labelEl = document.getElementById('pomoLabel');
  const startBtn = document.getElementById('pomoStart');
  const pauseBtn = document.getElementById('pomoPause');
  const resetBtn = document.getElementById('pomoReset');
  const sessionsEl = document.getElementById('pomoSessions');
  const tabs = document.querySelectorAll('.pomo-tab');

  // Load state from storage
  chrome.storage.local.get({ pomoSessions: 0, pomoState: null }, (data) => {
    sessionsEl.textContent = data.pomoSessions;
    if (data.pomoState && data.pomoState.running) {
      const elapsed = Math.floor((Date.now() - data.pomoState.startedAt) / 1000);
      timeLeft = Math.max(data.pomoState.timeLeft - elapsed, 0);
      currentMode = data.pomoState.mode;
      setActiveTab(currentMode);
      if (timeLeft > 0) {
        running = true;
        startBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        chrome.runtime.sendMessage({ action: 'pomodoroStart', endsAt: data.pomoState.startedAt + data.pomoState.timeLeft * 1000 });
        startInterval();
      } else {
        onComplete();
      }
    }
    updateDisplay();
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (running) return;
      currentMode = tab.dataset.mode;
      timeLeft = MODES[currentMode];
      setActiveTab(currentMode);
      updateDisplay();
    });
  });

  startBtn.addEventListener('click', () => {
    running = true;
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'flex';
    saveState();
    chrome.runtime.sendMessage({ action: 'pomodoroStart', endsAt: Date.now() + timeLeft * 1000 });
    startInterval();
  });

  pauseBtn.addEventListener('click', () => {
    running = false;
    pauseBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    clearInterval(intervalId);
    chrome.storage.local.set({ pomoState: null });
    chrome.runtime.sendMessage({ action: 'pomodoroStop' });
  });

  resetBtn.addEventListener('click', () => {
    running = false;
    clearInterval(intervalId);
    timeLeft = MODES[currentMode];
    pauseBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    chrome.storage.local.set({ pomoState: null });
    chrome.runtime.sendMessage({ action: 'pomodoroStop' });
    updateDisplay();
  });

  function startInterval() {
    clearInterval(intervalId);
    intervalId = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        timeLeft = 0;
        clearInterval(intervalId);
        onComplete();
      }
      updateDisplay();
    }, 1000);
  }

  function onComplete() {
    running = false;
    pauseBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    updateDisplay();
  }

  // Keep the session counter live when the background worker completes a session.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pomoSessions) {
      sessionsEl.textContent = changes.pomoSessions.newValue;
    }
  });

  function saveState() {
    chrome.storage.local.set({ pomoState: { mode: currentMode, timeLeft, startedAt: Date.now(), running: true } });
  }

  function setActiveTab(mode) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    labelEl.textContent = LABELS[mode];
  }

  function updateDisplay() {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    labelEl.textContent = LABELS[currentMode];
  }
}
