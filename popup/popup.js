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

  function loadSettings() {
    chrome.storage.local.get({ extensionEnabled: true }, (data) => {
      extensionToggle.checked = data.extensionEnabled;
      updateToggleUI(data.extensionEnabled);
    });
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
