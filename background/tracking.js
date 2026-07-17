// Core tab time-tracking logic

import { getDomain, localDateStr, isNeutralDomain, isAllowedSiteSearch } from './utils.js';
import { sendGraduatedDistraction, sendStudyEncouragement } from './notifications.js';
import { checkAllowance } from './allowances.js';
import { saveStats } from './stats.js';
import { getDomainStatsByDate, getTempFocusLogByDate } from '../lib/stats-db.js';

// --- Module state ---
let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let activeUrl = null;
let activeTitle = null;

// Per-session guards so each milestone nudge fires once, even if the exact
// tick is missed while the MV3 service worker is asleep.
let lastDistractionNudgeMinute = -1;
let lastStudyMilestoneMinute = -1;

let isEnabled = true;

// Timer for badge updates
let badgeTimerInterval = null;

// --- Public accessors (for use by other modules / event handlers) ---
export function getActiveTabId() { return activeTabId; }
export function getActiveDomain() { return activeDomain; }
export function getActiveUrl() { return activeUrl; }
export function getActiveStartTime() { return activeStartTime; }
export function getActiveTitle() { return activeTitle; }
export function getIsEnabled() { return isEnabled; }

// --- Initialization ---
export function initTracking() {
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
        chrome.action.setBadgeText({ text: '' });
      } else {
        // Re-initialize tracking if we just enabled
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
        });
      }
    }
  });
}

// --- Badge ---
// Prevent overlapping badge updates (since it's now async with IDB reads)
let badgeUpdateInProgress = false;

export function updateBadge() {
  if (!isEnabled || !activeStartTime || !activeDomain) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  // Skip if a previous update is still running (avoids piling up IDB reads)
  if (badgeUpdateInProgress) return;
  badgeUpdateInProgress = true;

  updateBadgeAsync().finally(() => { badgeUpdateInProgress = false; });
}

async function updateBadgeAsync() {
  const durationSec = Math.floor((Date.now() - activeStartTime) / 1000);
  let badgeText = '';

  if (durationSec < 60) {
    badgeText = `${durationSec}s`;
  } else {
    const mins = Math.floor(durationSec / 60);
    badgeText = `${mins}m`;
  }

  chrome.action.setBadgeText({ text: badgeText });

  // Read settings from chrome.storage (fast — small data)
  const data = await new Promise(resolve =>
    chrome.storage.local.get({ studyDomains: [], allowances: {}, tempFocusPasses: {} }, resolve)
  );

  if (!activeDomain) return;

  let isStudy = data.studyDomains.some(
    (allowedDomain) =>
      activeDomain === allowedDomain || activeDomain.endsWith(`.${allowedDomain}`)
  );

  // Check if domain has an active temp focus pass
  let hasTempPass = false;
  if (!isStudy) {
    const matchedPass = Object.entries(data.tempFocusPasses).find(([d]) =>
      activeDomain === d || activeDomain.endsWith('.' + d)
    );
    if (matchedPass && matchedPass[1].expiresAt > Date.now()) {
      hasTempPass = true;
    }
  }

  // Check if domain has an active allowance that hasn't been exceeded
  let isWithinAllowance = false;
  if (!isStudy && !hasTempPass) {
    const matchedAllowanceDomain = Object.keys(data.allowances).find(d =>
      activeDomain === d || activeDomain.endsWith('.' + d)
    );
    if (matchedAllowanceDomain) {
      const { limitSeconds } = data.allowances[matchedAllowanceDomain];
      const today = localDateStr();
      // Read from IndexedDB
      const todayStats = await getDomainStatsByDate(today);
      const todayTempFocus = await getTempFocusLogByDate(today);
      let usedSeconds = 0;
      Object.entries(todayStats).forEach(([d, seconds]) => {
        if (d === matchedAllowanceDomain || d.endsWith('.' + matchedAllowanceDomain)) {
          const tempSec = todayTempFocus[d] || 0;
          usedSeconds += Math.max(0, seconds - tempSec);
        }
      });
      usedSeconds += durationSec;
      isWithinAllowance = usedSeconds <= limitSeconds;
    }
  }

  chrome.action.setBadgeBackgroundColor({
    color: (isStudy || hasTempPass) ? '#6abf9b' : (isWithinAllowance ? '#fbbf24' : '#fca5a5')
  });

  const minutes = Math.floor(durationSec / 60);

  // Sign-in/OAuth pages and searches for an allowed site are neutral
  const isNeutral = isNeutralDomain(activeDomain) || isAllowedSiteSearch(activeUrl, data.studyDomains);

  // --- Allowance System Check (only for non-study sites without temp pass) ---
  if (!isStudy && !hasTempPass && !isNeutral) {
    // Read today's stats from IndexedDB for allowance check
    const today = localDateStr();
    const dailyStats = await getDomainStatsByDate(today);
    checkAllowance(data.allowances, dailyStats, activeDomain, durationSec, activeTabId);
  }

  // Graduated distraction nudges at each 10-minute mark
  if (!isStudy && !hasTempPass && !isNeutral && !isWithinAllowance &&
      minutes >= 10 && minutes % 10 === 0 && minutes !== lastDistractionNudgeMinute) {
    lastDistractionNudgeMinute = minutes;
    sendGraduatedDistraction(activeTabId, activeDomain, minutes);
  }

  // Study encouragement at milestones: 30m, 1h, 1.5h, 2h, 3h
  if (isStudy) {
    const studyMilestones = [30, 60, 90, 120, 180];
    if (studyMilestones.includes(minutes) && minutes !== lastStudyMilestoneMinute) {
      lastStudyMilestoneMinute = minutes;
      sendStudyEncouragement(activeTabId, activeDomain, minutes);
    }
  }
}

// --- Tracking lifecycle ---

export function stopTracking() {
  cancelPendingSwitch();
  if (activeStartTime && activeUrl) {
    const duration = Math.round((Date.now() - activeStartTime) / 1000);
    if (duration > 0) {
      saveStats(activeDomain, activeUrl, activeTitle, duration, activeStartTime);
    }
  }
  if (badgeTimerInterval) {
    clearInterval(badgeTimerInterval);
    badgeTimerInterval = null;
  }
  chrome.alarms.clear('keepAlive');
  chrome.action.setBadgeText({ text: '' });
  if (chrome.storage.session) {
    chrome.storage.session.remove('trackingState');
  }
  activeTabId = null;
  activeStartTime = null;
  activeDomain = null;
  activeUrl = null;
  activeTitle = null;
}

// Debounce rapid tab switches — only commit to tracking a new tab after it
// stays active for DEBOUNCE_MS. This prevents logging 10 separate 0-second
// events when the user ctrl+tabs through multiple tabs quickly.
const TAB_SWITCH_DEBOUNCE_MS = 300;
let pendingSwitch = null; // { tabId, url, title, timer }

/**
 * Schedule a tab switch. If another switch comes in before the debounce
 * window expires, the previous one is discarded without saving stats.
 */
export function startTracking(tabId, url, title) {
  if (!isEnabled) return;
  const domain = getDomain(url);
  if (!domain) {
    cancelPendingSwitch();
    stopTracking();
    return;
  }

  // If the URL is the same as what we're already tracking, ignore
  if (url === activeUrl) {
    cancelPendingSwitch();
    return;
  }

  // If there's already a pending switch, cancel it (the user moved on)
  cancelPendingSwitch();

  // If we're currently tracking a very short session (< debounce window),
  // and a new switch comes in, just replace immediately without saving.
  // For longer sessions, use the debounce to avoid losing time.
  const sessionDuration = activeStartTime ? (Date.now() - activeStartTime) : 0;

  if (sessionDuration < TAB_SWITCH_DEBOUNCE_MS) {
    // Very brief visit — don't bother saving it, just switch immediately
    commitSwitch(tabId, url, title, domain);
  } else {
    // Normal case: wait for debounce, then commit
    pendingSwitch = {
      tabId, url, title, domain,
      timer: setTimeout(() => {
        pendingSwitch = null;
        commitSwitch(tabId, url, title, domain);
      }, TAB_SWITCH_DEBOUNCE_MS)
    };
  }
}

function cancelPendingSwitch() {
  if (pendingSwitch) {
    clearTimeout(pendingSwitch.timer);
    pendingSwitch = null;
  }
}

function commitSwitch(tabId, url, title, domain) {
  // If no active state (service worker restarted), try to restore
  if (!activeUrl && !activeStartTime) {
    if (chrome.storage.session) {
      chrome.storage.session.get('trackingState', (data) => {
        if (chrome.runtime.lastError) {
          beginFreshTracking(tabId, url, title, domain);
          return;
        }
        if (data.trackingState && data.trackingState.url === url) {
          activeTabId = tabId;
          activeStartTime = data.trackingState.startTime;
          activeDomain = data.trackingState.domain;
          activeUrl = data.trackingState.url;
          activeTitle = data.trackingState.title;
          const restoredMin = Math.floor((Date.now() - activeStartTime) / 60000);
          lastDistractionNudgeMinute = restoredMin;
          lastStudyMilestoneMinute = restoredMin;
          if (!badgeTimerInterval) {
            badgeTimerInterval = setInterval(updateBadge, 1000);
          }
          updateBadge();
        } else {
          beginFreshTracking(tabId, url, title, domain);
        }
      });
    } else {
      beginFreshTracking(tabId, url, title, domain);
    }
    return;
  }

  stopTracking();
  beginFreshTracking(tabId, url, title, domain);
}

function beginFreshTracking(tabId, url, title, domain) {
  activeTabId = tabId;
  activeStartTime = Date.now();
  activeDomain = domain;
  activeUrl = url;
  activeTitle = title || 'Untitled Tab';
  lastDistractionNudgeMinute = -1;
  lastStudyMilestoneMinute = -1;

  if (chrome.storage.session) {
    chrome.storage.session.set({
      trackingState: { tabId, startTime: activeStartTime, domain, url, title: activeTitle }
    });
  }

  // Keep service worker alive while tracking
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

  if (!badgeTimerInterval) {
    badgeTimerInterval = setInterval(updateBadge, 1000);
  }
  updateBadge();
}

/**
 * Flush current session stats to storage (used by the periodic flushStats alarm).
 */
export function flushCurrentSession() {
  if (activeTabId && activeStartTime && activeUrl) {
    const duration = Math.round((Date.now() - activeStartTime) / 1000);
    if (duration > 0) {
      saveStats(activeDomain, activeUrl, activeTitle, duration, activeStartTime);
      activeStartTime = Date.now(); // Reset start time after flushing
    }
  }
}
