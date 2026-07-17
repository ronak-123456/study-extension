// Background service worker — main entry point (ES module)
// Imports Firebase via importScripts are not available in ES modules, so we
// rely on the global scope being set up via the manifest's importScripts
// alternative — but MV3 ES module workers cannot use importScripts.
// Instead, we import Firebase client as a module-compatible wrapper.
// NOTE: Firebase is loaded via lib/firebase-bundle.js which sets globals.
// For module workers, we use a small shim that re-exports those globals.

import { getDomain, isNeutralDomain, isAllowedSiteSearch, isSkippableUrl } from './utils.js';
import { triggerFocusNotification } from './notifications.js';
import { saveStats, sendEndOfDaySummary, checkSummaryNotification, sendWeeklySummary } from './stats.js';
import { completePomodoro } from './pomodoro.js';
import {
  initTracking,
  startTracking,
  stopTracking,
  updateBadge,
  flushCurrentSession,
  getActiveTabId,
  getActiveDomain,
  getActiveUrl,
  getActiveStartTime,
  getIsEnabled
} from './tracking.js';
import { runMigrations } from './migrations.js';

// =============================================
// Constants
// =============================================
const REMINDER_INTERVAL_MINS = 15;
const NOTIFICATION_COOLDOWN_MS = REMINDER_INTERVAL_MINS * 60 * 1000;
// Per-domain timestamp of the last "off track" nudge, used to throttle spam.
let focusNudgeTimestamps = {};

// =============================================
// Initialization
// =============================================
initTracking();

// =============================================
// Tab evaluation — focus nudge logic
// =============================================
function evaluateTab(tab) {
  if (!tab || !getIsEnabled()) return;
  const domain = getDomain(tab.url);
  if (!domain) return;
  if (isNeutralDomain(domain)) return;

  chrome.storage.local.get({ studyDomains: [], tempFocusPasses: {} }, (data) => {
    const allowedStudyDomains = data.studyDomains;
    const isStudyTab = allowedStudyDomains.some(
      (allowedDomain) =>
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
    );

    // Check temp focus pass
    const hasTempPass = Object.entries(data.tempFocusPasses).find(([d, p]) =>
      (domain === d || domain.endsWith('.' + d)) && p.expiresAt > Date.now()
    );

    // Searching for one of your allowed sites is transit, not distraction
    if (isAllowedSiteSearch(tab.url, allowedStudyDomains)) return;

    if (!isStudyTab && !hasTempPass && allowedStudyDomains.length > 0) {
      const now = Date.now();
      if (now - (focusNudgeTimestamps[domain] || 0) < NOTIFICATION_COOLDOWN_MS) return;
      focusNudgeTimestamps[domain] = now;
      triggerFocusNotification(tab.id, domain);
    }
  });
}

// =============================================
// Chrome event listeners
// =============================================
let evaluateTabTimer = null;

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    startTracking(activeInfo.tabId, tab.url, tab.title);

    // Debounce nudge evaluation — only nudge on the tab the user settles on,
    // not every tab flipped through during rapid switching.
    clearTimeout(evaluateTabTimer);
    evaluateTabTimer = setTimeout(() => evaluateTab(tab), 350);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || !tab.url || isSkippableUrl(tab.url)) return;
  if (changeInfo.url || changeInfo.title) {
    startTracking(tabId, tab.url, tab.title);
  }
  if (changeInfo.status === 'complete') {
    evaluateTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === getActiveTabId()) {
    stopTracking();
  }
});

// The popup opens a port while it's on screen. Opening the action popup makes
// Chrome briefly report "no focused window", which would otherwise stop tracking.
let popupOpen = false;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'hocus-popup') {
    popupOpen = true;
    port.onDisconnect.addListener(() => { popupOpen = false; });
  }
});

let blurStopTimer = null;
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    clearTimeout(blurStopTimer);
    blurStopTimer = setTimeout(() => {
      if (!popupOpen) stopTracking();
    }, 600);
  } else {
    clearTimeout(blurStopTimer);
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

// =============================================
// Install & Startup
// =============================================
chrome.runtime.onInstalled.addListener((details) => {
  // Run versioned data migrations
  runMigrations();

  chrome.alarms.create('flushStats', { periodInMinutes: 30 });
  scheduleDailySummaryAlarm();
  scheduleWeeklySummaryAlarm();
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

  // Show onboarding on first install
  if (details.reason === 'install') {
    chrome.storage.local.get({ onboardingComplete: false }, (data) => {
      if (!data.onboardingComplete) {
        chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
      }
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  runMigrations(); // Retry any interrupted migrations
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
  });
  scheduleDailySummaryAlarm();
  scheduleWeeklySummaryAlarm();
  checkSummaryNotification();
});

// Schedule a daily alarm at 9 PM for end-of-day summary
function scheduleDailySummaryAlarm() {
  const now = new Date();
  let target = new Date();
  target.setHours(21, 0, 0, 0);

  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  const delayInMinutes = (target.getTime() - now.getTime()) / 60000;
  chrome.alarms.create('dailySummary', {
    delayInMinutes,
    periodInMinutes: 24 * 60
  });
}

// Schedule a weekly alarm — fires every Sunday at 8 PM for the weekly summary
function scheduleWeeklySummaryAlarm() {
  const now = new Date();
  let target = new Date();
  // Next Sunday at 8 PM
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7; // 0=Sun, so if today is Sun use 7 for next week
  target.setDate(now.getDate() + daysUntilSunday);
  target.setHours(20, 0, 0, 0);

  // If it's currently Sunday before 8 PM, fire today
  if (now.getDay() === 0 && now.getHours() < 20) {
    target = new Date();
    target.setHours(20, 0, 0, 0);
  }

  const delayInMinutes = Math.max(1, (target.getTime() - now.getTime()) / 60000);
  chrome.alarms.create('weeklySummary', {
    delayInMinutes,
    periodInMinutes: 7 * 24 * 60 // Repeat every 7 days
  });
}

// =============================================
// Alarms
// =============================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flushStats') {
    flushCurrentSession();
    checkSummaryNotification();
  }
  if (alarm.name === 'dailySummary') {
    sendEndOfDaySummary();
  }
  if (alarm.name === 'weeklySummary') {
    sendWeeklySummary();
  }
  if (alarm.name === 'pomodoroDone') {
    completePomodoro();
  }
  if (alarm.name === 'keepAlive') {
    updateBadge();
  }
  if (alarm.name.startsWith('tempFocus_')) {
    const domain = alarm.name.replace('tempFocus_', '');
    chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
      const passes = data.tempFocusPasses;
      if (passes[domain]) {
        delete passes[domain];
        chrome.storage.local.set({ tempFocusPasses: passes });
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '🛡️ Focus Pass Expired',
          message: `Your temp focus pass for ${domain} has ended. Time on this site now counts as distraction.`,
          priority: 2
        });
      }
    });
  }
});

// =============================================
// Temp Focus Pass
// =============================================
function startTempFocusPass(domain, minutes) {
  const expiresAt = Date.now() + (minutes * 60 * 1000);
  chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
    const passes = data.tempFocusPasses;
    passes[domain] = { expiresAt, minutes };
    chrome.storage.local.set({ tempFocusPasses: passes });
    chrome.alarms.create(`tempFocus_${domain}`, { delayInMinutes: Math.max(minutes, 1) });
  });
}

function cancelTempFocusPass(domain) {
  chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
    const passes = data.tempFocusPasses;
    delete passes[domain];
    chrome.storage.local.set({ tempFocusPasses: passes });
    chrome.alarms.clear(`tempFocus_${domain}`);
  });
}

// =============================================
// Message handling (from popup / content scripts)
// =============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startTempFocusPass') {
    startTempFocusPass(message.domain, message.minutes);
    sendResponse({ success: true });
  } else if (message.action === 'cancelTempFocusPass') {
    cancelTempFocusPass(message.domain);
    sendResponse({ success: true });
  } else if (message.action === 'getTempFocusStatus') {
    chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
      sendResponse({ passes: data.tempFocusPasses });
    });
    return true; // async response
  } else if (message.action === 'closeActiveTab') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) chrome.tabs.remove(tabId).catch(() => { });
    sendResponse({ success: true });
  } else if (message.action === 'pomodoroStart') {
    chrome.alarms.create('pomodoroDone', { when: message.endsAt });
    sendResponse({ success: true });
  } else if (message.action === 'pomodoroStop') {
    chrome.alarms.clear('pomodoroDone');
    sendResponse({ success: true });
  }
});

// Clicking any of our notifications should dismiss it.
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
});

// =============================================
// Migrations run via background/migrations.js
// =============================================
