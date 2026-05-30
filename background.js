let lastNotifiedDomain = '';
let lastNotifiedAt = 0;
const REMINDER_INTERVAL_MINS = 15;
const NOTIFICATION_COOLDOWN_MS = REMINDER_INTERVAL_MINS * 60 * 1000;

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

  // 1. Show system notification (as before)
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Stay Focused',
    message: `You switched to ${currentDomain}. Get back to your study flow.`,
    priority: 1
  });

  // 2. Send message to content script to show in-browser popup
  if (tabId) {
    console.log(`Focus Flow Analyzer: Sending nudge to tab ${tabId} for domain ${currentDomain}`);
    chrome.tabs.sendMessage(tabId, {
      action: 'showFocusNudge',
      domain: currentDomain
    }).then(() => {
      console.log(`Focus Flow Analyzer: Message sent successfully to tab ${tabId}`);
    }).catch(err => {
      console.log(`Focus Flow Analyzer: Message failed. Attempting dynamic injection for tab ${tabId}.`);
      // Try to inject the content script if it's missing
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        // Retry the message after injection
        chrome.tabs.sendMessage(tabId, {
          action: 'showFocusNudge',
          domain: currentDomain
        });
      }).catch(injectErr => {
        console.error(`Focus Flow Analyzer: Failed to dynamically inject script into tab ${tabId}:`, injectErr);
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
    url.startsWith('brave://')
  );
}

function evaluateTab(tab) {
  if (!tab || isSkippableUrl(tab.url)) {
    return;
  }

  try {
    const currentUrl = new URL(tab.url);
    const currentDomain = currentUrl.hostname.toLowerCase();

    chrome.storage.local.get({ studyDomains: [] }, (data) => {
      const allowedStudyDomains = data.studyDomains;
      console.log('Focus Flow Analyzer: Checking domain:', currentDomain, 'Allowed domains:', allowedStudyDomains);

      const isStudyTab = allowedStudyDomains.some(
        (allowedDomain) =>
          currentDomain === allowedDomain || currentDomain.endsWith(`.${allowedDomain}`)
      );

      if (!isStudyTab && allowedStudyDomains.length > 0) {
        console.log('Focus Flow Analyzer: Non-study domain detected. Triggering nudge.');
        triggerFocusNotification(tab.id, currentDomain);
      } else if (allowedStudyDomains.length === 0) {
        console.log('Focus Flow Analyzer: No study domains configured. Skipping nudge.');
      }
    });
  } catch (error) {
    console.error(error);
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    evaluateTab(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
    evaluateTab(tab);
  }
});

// Dynamically inject content scripts into all tabs when the extension is installed or reloaded
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).then(() => {
        console.log(`Focus Flow Analyzer: Successfully injected on install into tab ${tab.id}`);
      }).catch(err => {
        console.log(`Focus Flow Analyzer: Could not inject into tab ${tab.id} on install:`, err);
      });
    });
  });
});

// Periodic check every minute to see if a reminder is needed for the active tab
chrome.alarms.create('periodicFocusCheck', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicFocusCheck') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        console.log('Focus Flow Analyzer: Periodic check triggered for active tab');
        evaluateTab(tabs[0]);
      }
    });
  }
});
