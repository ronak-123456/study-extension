let lastNotifiedDomain = '';
let lastNotifiedAt = 0;
const REMINDER_INTERVAL_MINS = 15;
const NOTIFICATION_COOLDOWN_MS = REMINDER_INTERVAL_MINS * 60 * 1000;

let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let activeUrl = null;
let activeTitle = null;

let isEnabled = true;

// Initialize isEnabled from storage
chrome.storage.local.get({ extensionEnabled: true }, (data) => {
  isEnabled = data.extensionEnabled;
});

// Listen for storage changes to sync isEnabled
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    isEnabled = changes.extensionEnabled.newValue;
    if (!isEnabled) {
      stopTracking();
    } else {
      // Re-initialize tracking if we just enabled
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
      });
    }
  }
});

function getDomain(url) {
  if (!url || isSkippableUrl(url)) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function stopTracking() {
  if (activeStartTime && activeUrl) {
    const duration = Math.round((Date.now() - activeStartTime) / 1000);
    if (duration > 0) {
      saveStats(activeDomain, activeUrl, activeTitle, duration);
    }
  }
  activeTabId = null;
  activeStartTime = null;
  activeDomain = null;
  activeUrl = null;
  activeTitle = null;
}

function startTracking(tabId, url, title) {
  if (!isEnabled) return;
  const domain = getDomain(url);
  if (!domain) {
    stopTracking();
    return;
  }

  // If the URL is the same, just keep tracking
  if (url === activeUrl) return;

  stopTracking();

  activeTabId = tabId;
  activeStartTime = Date.now();
  activeDomain = domain;
  activeUrl = url;
  activeTitle = title || 'Untitled Tab';
}

function saveStats(domain, url, title, duration) {
  const today = new Date().toISOString().split('T')[0];
  chrome.storage.local.get({ dailyStats: {}, dailyUrlStats: {} }, (data) => {
    const stats = data.dailyStats;
    const urlStats = data.dailyUrlStats;

    // Update domain stats
    if (!stats[today]) stats[today] = {};
    if (!stats[today][domain]) stats[today][domain] = 0;
    stats[today][domain] += duration;

    // Update URL stats
    if (!urlStats[today]) urlStats[today] = {};
    if (!urlStats[today][url]) {
      urlStats[today][url] = { title: title, domain: domain, duration: 0 };
    }
    urlStats[today][url].duration += duration;
    // Always update title in case it changed
    urlStats[today][url].title = title || urlStats[today][url].title;

    chrome.storage.local.set({ dailyStats: stats, dailyUrlStats: urlStats });
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
  if (!tab || !isEnabled) return;
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
    startTracking(activeInfo.tabId, tab.url, tab.title);
    evaluateTab(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active) {
    if (changeInfo.url || changeInfo.title) {
      startTracking(tabId, tab.url, tab.title);
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
      if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
    });
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state !== 'active') {
    stopTracking();
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
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

  // Initialize tracking for the current active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
  });
  checkSummaryNotification();
});

function checkSummaryNotification() {
  const today = new Date().toISOString().split('T')[0];
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  chrome.storage.local.get(['lastSummaryNotifiedDate', 'dailyStats', 'studyDomains'], (data) => {
    if (data.lastSummaryNotifiedDate === today) return;

    const stats = data.dailyStats || {};
    const yesterdayStats = stats[yesterday];
    const studyDomains = data.studyDomains || [];

    if (yesterdayStats) {
      let focusSeconds = 0;
      Object.entries(yesterdayStats).forEach(([domain, seconds]) => {
        const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
        if (isStudy) focusSeconds += seconds;
      });

      if (focusSeconds > 0) {
        const h = Math.floor(focusSeconds / 3600);
        const m = Math.floor((focusSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Daily Summary',
          message: `Yesterday you focused for ${timeStr}. Keep up the great work today!`,
          priority: 2
        });
      }
    }
    chrome.storage.local.set({ lastSummaryNotifiedDate: today });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flushStats') {
    if (activeTabId && activeStartTime && activeUrl) {
      const duration = Math.round((Date.now() - activeStartTime) / 1000);
      if (duration > 0) {
        saveStats(activeDomain, activeUrl, activeTitle, duration);
        activeStartTime = Date.now(); // Reset start time after flushing
      }
    }
    checkSummaryNotification();
  }
});
