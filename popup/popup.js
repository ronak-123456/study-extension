// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domainInput');
  const addCustomBtn = document.getElementById('addCustomBtn');
  const addCurrentBtn = document.getElementById('addCurrentBtn');
  const domainList = document.getElementById('domainList');
  const countText = document.getElementById('countText');
  const status = document.getElementById('status');
  const viewStatsBtn = document.getElementById('viewStatsBtn');
  const extensionToggle = document.getElementById('extensionToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const themeToggle = document.getElementById('themeToggle');
  const moonIcon = document.getElementById('moonIcon');
  const sunIcon = document.getElementById('sunIcon');

  loadSettings();
  loadDomains();

  viewStatsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('analysis/analysis.html') });
  });

  addCustomBtn.addEventListener('click', () => {
    let domain = domainInput.value.trim().toLowerCase();
    if (!domain) {
      setStatus('Type a domain first.', 'error');
      return;
    }

    domain = cleanDomain(domain);
    if (!domain) {
      setStatus('Invalid domain.', 'error');
      return;
    }

    addDomain(domain);
    domainInput.value = '';
  });

  domainInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      addCustomBtn.click();
    }
  });

  addCurrentBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        if (url.protocol.startsWith('http')) {
          addDomain(url.hostname.toLowerCase(), true);
        } else {
          setStatus('Only http/https tabs are supported.', 'error');
        }
      }
    } catch (e) {
      console.error('Could not capture active tab URL', e);
      setStatus('Could not read active tab.', 'error');
    }
  });

  extensionToggle.addEventListener('change', () => {
    const isEnabled = extensionToggle.checked;
    chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
      updateToggleUI(isEnabled);
    });
  });

  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
    updateThemeUI(isDark);
  });

  function loadSettings() {
    chrome.storage.local.get({ extensionEnabled: true, theme: 'light' }, (data) => {
      extensionToggle.checked = data.extensionEnabled;
      updateToggleUI(data.extensionEnabled);

      const isDark = data.theme === 'dark';
      document.body.classList.toggle('dark', isDark);
      updateThemeUI(isDark);
    });
  }

  function updateThemeUI(isDark) {
    moonIcon.style.display = isDark ? 'none' : 'block';
    sunIcon.style.display = isDark ? 'block' : 'none';
  }

  function updateToggleUI(isEnabled) {
    toggleLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
    toggleLabel.style.color = isEnabled ? 'var(--primary-strong)' : 'var(--muted)';
  }

  function loadDomains() {
    chrome.storage.local.get({ studyDomains: [] }, (data) => {
      renderList(data.studyDomains);
    });
  }

  function cleanDomain(input) {
    try {
      let normalized = input;
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized;
      }
      return new URL(normalized).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function addDomain(domain, fromCurrent = false) {
    chrome.storage.local.get({ studyDomains: [] }, (data) => {
      const currentList = data.studyDomains;
      if (currentList.includes(domain)) {
        setStatus('Domain already added.', 'error');
        return;
      }

      currentList.push(domain);
      chrome.storage.local.set({ studyDomains: currentList }, () => {
        renderList(currentList);
        setStatus(fromCurrent ? 'Current website added.' : 'Domain added.', 'success');
      });
    });
  }

  function removeDomain(domainToRemove) {
    chrome.storage.local.get({ studyDomains: [] }, (data) => {
      const updatedList = data.studyDomains.filter((d) => d !== domainToRemove);
      chrome.storage.local.set({ studyDomains: updatedList }, () => {
        renderList(updatedList);
        setStatus('Domain removed.', 'success');
      });
    });
  }

  function renderList(domains) {
    domainList.innerHTML = '';
    countText.textContent = `${domains.length} ${domains.length === 1 ? 'domain' : 'domains'}`;

    if (domains.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No study domains added yet.';
      domainList.appendChild(li);
      return;
    }

    domains.forEach((domain) => {
      const li = document.createElement('li');

      const span = document.createElement('span');
      span.className = 'domain-name';
      span.textContent = domain;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = 'Remove';
      deleteBtn.addEventListener('click', () => {
        removeDomain(domain);
      });

      li.appendChild(span);
      li.appendChild(deleteBtn);
      domainList.appendChild(li);
    });
  }

  function setStatus(message, type) {
    status.textContent = message;
    status.className = type;
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => {
      status.textContent = '';
      status.className = '';
    }, 2200);
  }
});

// Pomodoro Timer
(function() {
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
    startInterval();
  });

  pauseBtn.addEventListener('click', () => {
    running = false;
    pauseBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    clearInterval(intervalId);
    chrome.storage.local.set({ pomoState: null });
  });

  resetBtn.addEventListener('click', () => {
    running = false;
    clearInterval(intervalId);
    timeLeft = MODES[currentMode];
    pauseBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    chrome.storage.local.set({ pomoState: null });
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
    chrome.storage.local.set({ pomoState: null });
    if (currentMode === 'focus') {
      chrome.storage.local.get({ pomoSessions: 0 }, (data) => {
        const count = data.pomoSessions + 1;
        chrome.storage.local.set({ pomoSessions: count });
        sessionsEl.textContent = count;
      });
      chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Pomodoro Complete!', message: 'Great work! Take a break.', priority: 2 });
    } else {
      chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Break Over!', message: 'Time to focus again.', priority: 2 });
    }
  }

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
})();
