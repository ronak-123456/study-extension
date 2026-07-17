// Core tab time-tracking logic

import { getDomain, localDateStr, isNeutralDomain, isAllowedSiteSearch } from './utils.js';
import { sendGraduatedDistraction, sendStudyEncouragement } from './notifications.js';
import { checkAllowance } from './allowances.js';
import { saveStats } from './stats.js';

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
export function updateBadge() {
  if (!isEnabled || !activeStartTime || !activeDomain) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const durationSec = Math.floor((Date.now() - activeStartTime) / 1000);
  let badgeText = '';

  if (durationSec < 60) {
    badgeText = `${durationSec}s`;
  } else {
    const mins = Math.floor(durationSec / 60);
    badgeText = `${mins}m`;
  }

  chrome.action.setBadgeText({ text: badgeText });

  chrome.storage.local.get({ studyDomains: [], allowances: {}, dailyStats: {}, tempFocusPasses: {}, tempFocusLog: {} }, (data) => {
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
        const todayStats = data.dailyStats[today] || {};
        const todayTempFocus = (data.tempFocusLog[today]) || {};
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
      checkAllowance(data.allowances, data.dailyStats, activeDomain, durationSec, activeTabId);
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
  });
}

// --- Tracking lifecycle ---
export function stopTracking() {
  if (activeStartTime && activeUrl) {
    const duration = Math.round((Date.now() - activeStartTime) / 1000);
    if (duration > 0) {
      saveStats(activeDomain, activeUrl, activeTitle, duration);
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

export function startTracking(tabId, url, title) {
  if (!isEnabled) return;
  const domain = getDomain(url);
  if (!domain) {
    stopTracking();
    return;
  }

  // If the URL is the same, just keep tracking
  if (url === activeUrl) return;

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
          // Prime milestone guards to the current minute so a worker restart
          // doesn't re-fire a nudge that already went out this minute.
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
      saveStats(activeDomain, activeUrl, activeTitle, duration);
      activeStartTime = Date.now(); // Reset start time after flushing
    }
  }
}
