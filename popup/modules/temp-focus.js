// Temp Focus Pass UI

export function initTempFocus() {
  const durationBtns = document.querySelectorAll('.temp-focus-dur-btn');
  const inactiveSection = document.getElementById('tempFocusInactive');
  const activeSection = document.getElementById('tempFocusActive');
  const domainEl = document.getElementById('tempFocusDomain');
  const countdownEl = document.getElementById('tempFocusCountdown');
  const cancelBtn = document.getElementById('tempFocusCancel');
  const customMinInput = document.getElementById('tempFocusCustomMin');
  const customBtn = document.getElementById('tempFocusCustomBtn');
  let countdownInterval = null;

  async function getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        return url.hostname.toLowerCase().replace(/^www\./, '');
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
}
