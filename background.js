let lastNotifiedDomain = '';
let lastNotifiedAt = 0;
const REMINDER_INTERVAL_MINS = 15;
const NOTIFICATION_COOLDOWN_MS = REMINDER_INTERVAL_MINS * 60 * 1000;

let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;

function getDomain(url) {
  if (!url || isSkippableUrl(url)) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function stopTracking() {
  if (activeStartTime && activeDomain) {
    const duration = Math.round((Date.now() - activeStartTime) / 1000);
    if (duration > 0) {
      saveStats(activeDomain, duration);
    }
  }
  activeTabId = null;
  activeStartTime = null;
  activeDomain = null;
}

function startTracking(tabId, url) {
  const domain = getDomain(url);
  if (!domain) {
    stopTracking();
    return;
  }

  if (domain === activeDomain) return;

  stopTracking();

  activeTabId = tabId;
  activeStartTime = Date.now();
  activeDomain = domain;
}

function saveStats(domain, duration) {
  const today = new Date().toISOString().split('T')[0];
  chrome.storage.local.get({ dailyStats: {} }, (data) => {
    const stats = data.dailyStats;
    if (!stats[today]) stats[today] = {};
    if (!stats[today][domain]) stats[today][domain] = 0;
    stats[today][domain] += duration;
    chrome.storage.local.set({ dailyStats: stats });
  });
}

function triggerFocusNotification(tabId, currentDomain) {
  const now = Date.now();
  if (
    currentDomain === lastNotifiedDomain &&
    now - lastNotifiedAt < NOTIFICATION_COOLDOWN_MS
  ) {
    return;
  }

  lastNotifiedDomain = currentDomain;
  lastNotifiedAt = now;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Stay Focused',
    message: `You switched to ${currentDomain}. Get back to your study flow.`,
    priority: 1
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'showFocusNudge',
      domain: currentDomain
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'showFocusNudge',
          domain: currentDomain
        });
      });
    });
  }
}

function isSkippableUrl(url) {
  return (
    !url ||
    url.startsWith('chrome://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://') ||
    url.startsWith('chrome-extension://')
  );
}

function evaluateTab(tab) {
  if (!tab) return;
  const domain = getDomain(tab.url);
  if (!domain) return;

  chrome.storage.local.get({ studyDomains: [] }, (data) => {
    const allowedStudyDomains = data.studyDomains;
    const isStudyTab = allowedStudyDomains.some(
      (allowedDomain) =>
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
    );

    if (!isStudyTab && allowedStudyDomains.length > 0) {
      triggerFocusNotification(tab.id, domain);
    }
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    startTracking(activeInfo.tabId, tab.url);
    evaluateTab(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active) {
    if (changeInfo.url) {
      startTracking(tabId, changeInfo.url);
    }
    if (changeInfo.status === 'complete') {
      evaluateTab(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopTracking();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    stopTracking();
  } else {
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs[0]) startTracking(tabs[0].id, tabs[0].url);
    });
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state !== 'active') {
    stopTracking();
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) startTracking(tabs[0].id, tabs[0].url);
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(() => { });
    });
  });
});

chrome.alarms.create('flushStats', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flushStats') {
    if (activeTabId && activeStartTime && activeDomain) {
      const duration = Math.round((Date.now() - activeStartTime) / 1000);
      if (duration > 0) {
        saveStats(activeDomain, duration);
        activeStartTime = Date.now(); // Reset start time after flushing
      }
    }
  }
});
