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

        // Show first-time tip when first domain is added
        if (currentList.length === 1) {
          showFirstTimeTip();
        }
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
      li.textContent = 'No focus domains added yet.';
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

  function showFirstTimeTip() {
    // Only show once
    chrome.storage.local.get({ firstTipShown: false }, (data) => {
      if (data.firstTipShown) return;
      chrome.storage.local.set({ firstTipShown: true });

      const tip = document.createElement('div');
      tip.className = 'first-time-tip';
      tip.innerHTML = `
        <div class="tip-header">How it works</div>
        <ul class="tip-list">
          <li><strong>Browse normally</strong> — time on focus sites counts as deep work, everything else is distraction.</li>
          <li><strong>Badge timer</strong> — the icon shows how long you've been on the current site. Green = focus, Red = distraction.</li>
          <li><strong>Get nudged</strong> — you'll get a reminder every time you open a non-focus site.</li>
          <li><strong>Pin the extension</strong> — click the puzzle icon in Chrome toolbar, then pin Hocus Focus for quick access.</li>
        </ul>
        <button class="tip-dismiss">Got it</button>
      `;
      tip.querySelector('.tip-dismiss').onclick = () => tip.remove();

      const popup = document.querySelector('.popup');
      popup.insertBefore(tip, popup.children[2]);
    });
  }
});

// =============================================
// Allowance System
// =============================================
(function () {
  const allowanceDomainInput = document.getElementById('allowanceDomainInput');
  const allowanceHours = document.getElementById('allowanceHours');
  const allowanceMinutes = document.getElementById('allowanceMinutes');
  const addAllowanceBtn = document.getElementById('addAllowanceBtn');
  const allowanceList = document.getElementById('allowanceList');

  loadAllowances();

  addAllowanceBtn.addEventListener('click', addAllowance);
  allowanceDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addAllowance();
  });

  // "Limit Current Website" button
  document.getElementById('addCurrentAllowanceBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          if (url.protocol.startsWith('http')) {
            allowanceDomainInput.value = url.hostname.replace('www.', '');
          }
        } catch (e) {}
      }
    });
  });

  function addAllowance() {
    let domain = allowanceDomainInput.value.trim().toLowerCase();
    if (!domain) {
      // If input is empty, try adding current tab's domain
      addCurrentSiteAllowance();
      return;
    }

    domain = cleanAllowanceDomain(domain);
    if (!domain) return;

    const hours = parseInt(allowanceHours.value) || 0;
    const minutes = parseInt(allowanceMinutes.value) || 0;
    const totalSeconds = (hours * 3600) + (minutes * 60);

    if (totalSeconds <= 0) return;

    chrome.storage.local.get({ allowances: {} }, (data) => {
      const allowances = data.allowances;
      allowances[domain] = { limitSeconds: totalSeconds };
      chrome.storage.local.set({ allowances }, () => {
        allowanceDomainInput.value = '';
        allowanceHours.value = '0';
        allowanceMinutes.value = '15';
        loadAllowances();
      });
    });
  }

  function cleanAllowanceDomain(input) {
    // Remove protocol, paths, whitespace, decode URI
    try { input = decodeURIComponent(input); } catch(e) {}
    input = input.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].trim();
    // If it has a dot, treat as valid domain
    if (input && input.includes('.')) return input;
    // Common shortcuts without TLD
    const commonSites = {
      'youtube': 'youtube.com',
      'reddit': 'reddit.com',
      'twitter': 'twitter.com',
      'x': 'x.com',
      'instagram': 'instagram.com',
      'facebook': 'facebook.com',
      'tiktok': 'tiktok.com',
      'netflix': 'netflix.com',
      'twitch': 'twitch.tv',
      'discord': 'discord.com',
      'telegram': 'web.telegram.org',
      'whatsapp': 'web.whatsapp.com',
      'pinterest': 'pinterest.com',
      'snapchat': 'snapchat.com',
      'linkedin': 'linkedin.com',
      'amazon': 'amazon.com',
    };
    if (commonSites[input]) return commonSites[input];
    // Fallback: add .com
    if (input) return input + '.com';
    return '';
  }

  function addCurrentSiteAllowance() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          if (url.protocol.startsWith('http')) {
            allowanceDomainInput.value = url.hostname.replace('www.', '');
          }
        } catch (e) {}
      }
    });
  }

  function removeAllowance(domain) {
    chrome.storage.local.get({ allowances: {} }, (data) => {
      const allowances = data.allowances;
      delete allowances[domain];
      chrome.storage.local.set({ allowances }, () => {
        loadAllowances();
      });
    });
  }

  function loadAllowances() {
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.get({ allowances: {}, dailyStats: {} }, (data) => {
      const allowances = data.allowances || {};
      const todayStats = data.dailyStats[today] || {};
      renderAllowances(allowances, todayStats);
    });
  }

  function renderAllowances(allowances, todayStats) {
    allowanceList.innerHTML = '';

    const domains = Object.keys(allowances);
    if (domains.length === 0) {
      const li = document.createElement('li');
      li.className = 'allowance-empty';
      li.textContent = 'No allowances set. Add a site to limit daily usage.';
      allowanceList.appendChild(li);
      return;
    }

    domains.forEach(domain => {
      const { limitSeconds } = allowances[domain];

      // Calculate used time today for this domain (including subdomains)
      let usedSeconds = 0;
      Object.entries(todayStats).forEach(([d, seconds]) => {
        if (d === domain || d.endsWith('.' + domain)) {
          usedSeconds += seconds;
        }
      });

      const remainingSeconds = Math.max(limitSeconds - usedSeconds, 0);
      const isOver = remainingSeconds <= 0;
      const isWarn = !isOver && remainingSeconds <= (limitSeconds * 0.25);

      const li = document.createElement('li');
      li.className = 'allowance-item';

      const info = document.createElement('div');
      info.className = 'allowance-item-info';
      info.innerHTML = `
        <span class="allowance-item-domain">${domain}</span>
        <span class="allowance-item-time">Limit: ${formatAllowanceTime(limitSeconds)}/day</span>
      `;

      const badge = document.createElement('span');
      badge.className = `allowance-item-remaining ${isOver ? 'allowance-remaining-over' : isWarn ? 'allowance-remaining-warn' : 'allowance-remaining-ok'}`;
      badge.textContent = isOver ? 'Used up!' : formatAllowanceTime(remainingSeconds) + ' left';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'allowance-delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Remove allowance';
      deleteBtn.addEventListener('click', () => removeAllowance(domain));

      li.appendChild(info);
      li.appendChild(badge);
      li.appendChild(deleteBtn);
      allowanceList.appendChild(li);
    });
  }

  function formatAllowanceTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  // Refresh every 30s to update remaining times
  setInterval(loadAllowances, 30000);
})();

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

// Temp Focus Pass
(function() {
  const durationBtns = document.querySelectorAll('.temp-focus-dur-btn');
  const inactiveSection = document.getElementById('tempFocusInactive');
  const activeSection = document.getElementById('tempFocusActive');
  const domainEl = document.getElementById('tempFocusDomain');
  const countdownEl = document.getElementById('tempFocusCountdown');
  const cancelBtn = document.getElementById('tempFocusCancel');
  const customMinInput = document.getElementById('tempFocusCustomMin');
  const customBtn = document.getElementById('tempFocusCustomBtn');
  let countdownInterval = null;

  // Get current tab domain
  async function getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        return url.hostname.toLowerCase();
      }
    } catch (e) {}
    return null;
  }

  // Start a temp focus pass
  durationBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const minutes = parseInt(btn.dataset.minutes);
      if (!minutes || minutes <= 0) return;
      const domain = await getCurrentDomain();
      if (!domain) return;

      // Save directly to storage from popup (more reliable than messaging)
      chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
        const passes = data.tempFocusPasses || {};
        const expiresAt = Date.now() + (minutes * 60 * 1000);
        passes[domain] = { expiresAt, minutes };
        chrome.storage.local.set({ tempFocusPasses: passes }, () => {
          chrome.alarms.create(`tempFocus_${domain}`, { delayInMinutes: Math.max(minutes, 1) });
          showActivePass(domain, expiresAt);
        });
      });
    });
  });

  // Custom timer
  customBtn.addEventListener('click', async () => {
    const minutes = parseInt(customMinInput.value);
    if (!minutes || minutes <= 0) return;
    const domain = await getCurrentDomain();
    if (!domain) return;

    chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
      const passes = data.tempFocusPasses || {};
      const expiresAt = Date.now() + (minutes * 60 * 1000);
      passes[domain] = { expiresAt, minutes };
      chrome.storage.local.set({ tempFocusPasses: passes }, () => {
        chrome.alarms.create(`tempFocus_${domain}`, { delayInMinutes: Math.max(minutes, 1) });
        showActivePass(domain, expiresAt);
        customMinInput.value = '';
      });
    });
  });

  customMinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') customBtn.click();
  });

  // Cancel
  cancelBtn.addEventListener('click', () => {
    const domain = domainEl.textContent;
    if (domain) {
      chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
        const passes = data.tempFocusPasses || {};
        delete passes[domain];
        chrome.storage.local.set({ tempFocusPasses: passes }, () => {
          chrome.alarms.clear(`tempFocus_${domain}`);
          showInactive();
        });
      });
    }
  });

  // Show active pass state with countdown
  function showActivePass(domain, expiresAt) {
    inactiveSection.style.display = 'none';
    activeSection.style.display = 'flex';
    domainEl.textContent = domain;
    updateCountdown(expiresAt);

    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        showInactive();
      } else {
        updateCountdown(expiresAt);
      }
    }, 1000);
  }

  function updateCountdown(expiresAt) {
    const remaining = Math.max(0, expiresAt - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = `${mins}m ${secs}s remaining`;
  }

  function showInactive() {
    clearInterval(countdownInterval);
    inactiveSection.style.display = 'block';
    activeSection.style.display = 'none';
  }

  // On popup open, check if there's any active pass
  function checkActivePass() {
    chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
      const passes = data.tempFocusPasses || {};
      const activeEntry = Object.entries(passes).find(([d, p]) => p.expiresAt > Date.now());
      if (activeEntry) {
        showActivePass(activeEntry[0], activeEntry[1].expiresAt);
      }
    });
  }

  checkActivePass();
})();

// Tasks
(function() {
  const taskInput = document.getElementById('taskInput');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const taskList = document.getElementById('taskList');
  const tasksCount = document.getElementById('tasksCount');

  function loadTasks() {
    chrome.storage.local.get({ tasks: [] }, (data) => {
      renderTasks(data.tasks);
    });
  }

  function saveTasks(tasks) {
    chrome.storage.local.set({ tasks }, () => renderTasks(tasks));
  }

  function renderTasks(tasks) {
    taskList.innerHTML = '';
    const done = tasks.filter(t => t.done).length;
    tasksCount.textContent = `${done}/${tasks.length}`;

    if (tasks.length === 0) {
      taskList.innerHTML = '<li style="padding:10px;text-align:center;font-size:11px;color:var(--muted);font-style:italic;">No tasks yet</li>';
      return;
    }

    tasks.forEach((task, i) => {
      const li = document.createElement('li');
      li.className = `task-item ${task.done ? 'done' : ''}`;
      li.innerHTML = `
        <div class="task-checkbox ${task.done ? 'checked' : ''}" data-index="${i}"></div>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="task-delete" data-index="${i}">&times;</button>
      `;
      taskList.appendChild(li);
    });

    // Checkbox click
    taskList.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.addEventListener('click', () => {
        const idx = parseInt(cb.dataset.index);
        chrome.storage.local.get({ tasks: [] }, (data) => {
          data.tasks[idx].done = !data.tasks[idx].done;
          saveTasks(data.tasks);
        });
      });
    });

    // Delete click
    taskList.querySelectorAll('.task-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        chrome.storage.local.get({ tasks: [] }, (data) => {
          data.tasks.splice(idx, 1);
          saveTasks(data.tasks);
        });
      });
    });
  }

  function addTask() {
    const text = taskInput.value.trim();
    if (!text) return;
    chrome.storage.local.get({ tasks: [] }, (data) => {
      data.tasks.push({ text, done: false, createdAt: Date.now() });
      saveTasks(data.tasks);
      taskInput.value = '';
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  addTaskBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  loadTasks();
})();

// --- Cloud Sync UI Logic ---
(function initCloudSync() {
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const pushSyncBtn = document.getElementById('pushSyncBtn');
  const pullSyncBtn = document.getElementById('pullSyncBtn');
  const syncSignedOut = document.getElementById('syncSignedOut');
  const syncSignedIn = document.getElementById('syncSignedIn');
  const syncUserEmail = document.getElementById('syncUserEmail');
  const syncStatus = document.getElementById('syncStatus');

  function showSyncStatus(msg, isError = false) {
    syncStatus.textContent = msg;
    syncStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    setTimeout(() => { syncStatus.textContent = ''; }, 4000);
  }

  function updateSyncUI(user) {
    if (user) {
      syncSignedOut.style.display = 'none';
      syncSignedIn.style.display = 'block';
      syncUserEmail.textContent = user.email || user.displayName || 'Google User';
    } else {
      syncSignedOut.style.display = 'block';
      syncSignedIn.style.display = 'none';
    }
  }

  // Check auth state on load
  firebaseOnAuthStateChanged((user) => {
    updateSyncUI(user);
  });

  // Sign In
  signInBtn.addEventListener('click', async () => {
    signInBtn.disabled = true;
    signInBtn.textContent = 'Signing in...';
    try {
      const user = await signInWithGoogle();
      updateSyncUI(user);
      // Auto-sync on first sign-in: pull existing cloud data, or push if none exists
      const hadCloudData = await pullFromCloud(user.uid);
      if (!hadCloudData) {
        await pushToCloud(user.uid);
        showSyncStatus('Data backed up to cloud ✓');
      } else {
        showSyncStatus('Data restored from cloud ✓');
      }
    } catch (err) {
      console.error('[Hocus Focus] Sign-in error:', err);
      showSyncStatus('Sign-in failed: ' + (err.message || err), true);
    } finally {
      signInBtn.disabled = false;
      signInBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign in with Google to Sync`;
    }
  });

  // Sign Out
  signOutBtn.addEventListener('click', async () => {
    try {
      await signOutUser();
      updateSyncUI(null);
    } catch (err) {
      console.error('[Hocus Focus] Sign-out error:', err);
      showSyncStatus('Sign-out failed', true);
    }
  });

  // Push to Cloud
  pushSyncBtn.addEventListener('click', async () => {
    const user = firebaseCurrentUser();
    if (!user) return showSyncStatus('Not signed in', true);
    pushSyncBtn.disabled = true;
    pushSyncBtn.textContent = '⬆️ Pushing...';
    try {
      await pushToCloud(user.uid);
      showSyncStatus('Data pushed to cloud ✓');
    } catch (err) {
      console.error('[Hocus Focus] Push error:', err);
      showSyncStatus('Push failed: ' + err.message, true);
    } finally {
      pushSyncBtn.disabled = false;
      pushSyncBtn.textContent = '⬆️ Push to Cloud';
    }
  });

  // Pull from Cloud
  pullSyncBtn.addEventListener('click', async () => {
    const user = firebaseCurrentUser();
    if (!user) return showSyncStatus('Not signed in', true);
    pullSyncBtn.disabled = true;
    pullSyncBtn.textContent = '⬇️ Pulling...';
    try {
      const success = await pullFromCloud(user.uid);
      if (success) {
        showSyncStatus('Data restored from cloud ✓');
        // Reload popup to reflect new data
        setTimeout(() => location.reload(), 1000);
      } else {
        showSyncStatus('No cloud data found');
      }
    } catch (err) {
      console.error('[Hocus Focus] Pull error:', err);
      showSyncStatus('Pull failed: ' + err.message, true);
    } finally {
      pullSyncBtn.disabled = false;
      pullSyncBtn.textContent = '⬇️ Pull from Cloud';
    }
  });
})();
