// Allowance system UI

import { localDateStr } from './utils.js';
import { getDomainStatsByDate, getTempFocusLogByDate } from '../../lib/stats-db.js';

export function initAllowances() {
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
    try { input = decodeURIComponent(input); } catch(e) {}
    input = input.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].trim();
    if (input && input.includes('.')) return input;
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

  async function loadAllowances() {
    const today = localDateStr();

    // Read allowances from chrome.storage, stats from IndexedDB
    const [storageData, todayStats, todayTempFocus] = await Promise.all([
      new Promise(resolve => chrome.storage.local.get({ allowances: {} }, resolve)),
      getDomainStatsByDate(today),
      getTempFocusLogByDate(today)
    ]);

    const allowances = storageData.allowances || {};
    renderAllowances(allowances, todayStats, todayTempFocus);
  }

  function renderAllowances(allowances, todayStats, todayTempFocus = {}) {
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

      let usedSeconds = 0;
      Object.entries(todayStats).forEach(([d, seconds]) => {
        if (d === domain || d.endsWith('.' + domain)) {
          const tempSec = todayTempFocus[d] || 0;
          usedSeconds += Math.max(0, seconds - tempSec);
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
}
