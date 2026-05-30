let lastNotifiedDomain = '';
let lastNotifiedAt = 0;
const NOTIFICATION_COOLDOWN_MS = 8000;

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
      console.error(`Focus Flow Analyzer: Failed to send message to tab ${tabId}. Is content script injected?`, err);
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
