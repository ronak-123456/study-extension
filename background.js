// Import Firebase library and client.
// Chrome/Edge/Brave/Opera run this as a service worker, where importScripts is
// available. Firefox runs background as an event page (no importScripts) and
// loads these libraries via the "scripts" array in manifest.firefox.json, so we
// guard the call.
if (typeof importScripts === 'function') {
  importScripts('lib/firebase-bundle.js', 'firebase-config.js', 'firebase-client.js');
}

const REMINDER_INTERVAL_MINS = 15;
const NOTIFICATION_COOLDOWN_MS = REMINDER_INTERVAL_MINS * 60 * 1000;
// Per-domain timestamp of the last "off track" nudge, used to throttle spam.
let focusNudgeTimestamps = {};

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

function updateBadge() {
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

  // Update periodic reminder if on distraction
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

    // Sign-in/OAuth pages and searches for an allowed site are neutral — no
    // allowance or distraction nudges here.
    const isNeutral = isNeutralDomain(activeDomain) || isAllowedSiteSearch(activeUrl, data.studyDomains);

    // --- Allowance System Check (only for non-study sites without temp pass) ---
    if (!isStudy && !hasTempPass && !isNeutral) {
      checkAllowance(data.allowances, data.dailyStats, activeDomain, durationSec);
    }

    // Graduated distraction nudges at each 10-minute mark. Minute-based (not an
    // exact-second match) so a missed tick while the worker slept won't skip it.
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

// Local calendar date as YYYY-MM-DD. Used for all daily stat keys so they line
// up with the local clock (getHours) instead of drifting a day at UTC midnight.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

function startTracking(tabId, url, title) {
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

// Serialize stat writes so overlapping tab-switch / flush-alarm events can't
// each read the old object and clobber one another's increments.
let statsWriteChain = Promise.resolve();

function saveStats(domain, url, title, duration) {
  statsWriteChain = statsWriteChain
    .then(() => saveStatsInternal(domain, url, title, duration))
    .catch(() => { });
}

function saveStatsInternal(domain, url, title, duration) {
  return new Promise((resolve) => {
    const today = localDateStr();
    const hour = new Date().getHours();
    chrome.storage.local.get({
      dailyStats: {}, dailyUrlStats: {}, hourlyStats: {}, tempFocusLog: {},
      studyDomains: [], allowances: {}, tempFocusPasses: {}
    }, (data) => {
      // Don't record sign-in/OAuth pages or searches for an allowed site —
      // they're transit, not focus or distraction.
      if (isNeutralDomain(domain) || isAllowedSiteSearch(url, data.studyDomains)) {
        resolve();
        return;
      }

      const stats = data.dailyStats;
      const urlStats = data.dailyUrlStats;
      const hourly = data.hourlyStats;
      const tempFocusLog = data.tempFocusLog;

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
      urlStats[today][url].title = title || urlStats[today][url].title;

      // Update hourly stats
      if (!hourly[today]) hourly[today] = {};
      if (!hourly[today][hour]) hourly[today][hour] = { focus: 0, distraction: 0 };

      const isStudy = data.studyDomains.some(d => domain === d || domain.endsWith('.' + d));
      if (isStudy) {
        hourly[today][hour].focus += duration;
      } else {
        // Check if domain has an active temp focus pass
        const matchedPass = Object.entries(data.tempFocusPasses).find(([d]) =>
          domain === d || domain.endsWith('.' + d)
        );
        if (matchedPass && matchedPass[1].expiresAt > Date.now()) {
          // Temp focus pass active — count as focus
          hourly[today][hour].focus += duration;
          if (!tempFocusLog[today]) tempFocusLog[today] = {};
          if (!tempFocusLog[today][domain]) tempFocusLog[today][domain] = 0;
          tempFocusLog[today][domain] += duration;
        } else {
          // Check if this domain has an allowance
          const allowances = data.allowances || {};
          const matchedAllowanceDomain = Object.keys(allowances).find(d =>
            domain === d || domain.endsWith('.' + d)
          );

          if (matchedAllowanceDomain) {
            const { limitSeconds } = allowances[matchedAllowanceDomain];
            const todayStats = stats[today] || {};
            const todayTempFocusLog = tempFocusLog[today] || {};
            let usedSeconds = 0;
            Object.entries(todayStats).forEach(([d, seconds]) => {
              if (d === matchedAllowanceDomain || d.endsWith('.' + matchedAllowanceDomain)) {
                const tempSec = todayTempFocusLog[d] || 0;
                usedSeconds += Math.max(0, seconds - tempSec);
              }
            });

            if (usedSeconds > limitSeconds) {
              const excessBefore = Math.max(0, (usedSeconds - duration) - limitSeconds);
              const excessNow = usedSeconds - limitSeconds;
              const distractionPortion = excessNow - excessBefore;
              if (distractionPortion > 0) {
                hourly[today][hour].distraction += distractionPortion;
              }
            }
          } else {
            hourly[today][hour].distraction += duration;
          }
        }
      }
      chrome.storage.local.set({
        dailyStats: stats, dailyUrlStats: urlStats, hourlyStats: hourly, tempFocusLog: tempFocusLog
      }, () => resolve());
    });
  });
}

// Show an in-page overlay on the active tab. Only if the overlay can't be
// injected (e.g. a page where content scripts can't run) do we fall back to a
// system notification — this avoids alerting the user twice for one event.
function showOverlayOrNotify(tabId, overlayPayload, systemNotif) {
  if (!tabId) {
    chrome.notifications.create(systemNotif);
    return;
  }
  chrome.tabs.sendMessage(tabId, overlayPayload).catch(() => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      .then(() => chrome.tabs.sendMessage(tabId, overlayPayload)
        .catch(() => chrome.notifications.create(systemNotif)))
      .catch(() => chrome.notifications.create(systemNotif));
  });
}

function triggerFocusNotification(tabId, currentDomain) {
  chrome.storage.local.get({ customNudges: [] }, (data) => {
    const defaultMessages = [
      `You wandered onto ${currentDomain}. Your work notes miss you.`,
      `${currentDomain}? Really? Your tasks are crying.`,
      `Plot twist: ${currentDomain} won't help you finish that deadline.`
    ];

    const allMessages = data.customNudges.length > 0
      ? [...data.customNudges, ...defaultMessages]
      : defaultMessages;
    const message = allMessages[Math.floor(Math.random() * allMessages.length)];

    showOverlayOrNotify(
      tabId,
      { action: 'showFocusNudge', domain: currentDomain, customMessage: message },
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🫣 Caught You!',
        message,
        priority: 1
      }
    );
  });
}

// Witty distraction messages — escalate with time
const DISTRACTION_MESSAGES = {
  10: [
    "10 minutes gone. That's a whole pomodoro warm-up wasted here",
    "You've been here 10 min. Your future self is side-eyeing you.",
    "10 minutes of pure procrastination. Impressive commitment, honestly.",
  ],
  20: [
    "20 minutes?! At this point, list it as a hobby on your resume.",
    "Still here after 20 min? This site should pay you rent.",
    "20 minutes. That's almost enough time to learn something useful. Almost.",
  ],
  30: [
    "30 minutes. Half an hour. Gone. Poof. Like your productivity.",
    "You've officially spent more time here than on actual work. Ouch.",
    "30 min! If procrastination was a sport, you'd be going pro.",
  ],
  40: [
    "40 minutes. At this rate, your to-do list is writing its resignation letter.",
    "Still going? Your tasks filed a missing person report.",
    "40 min of distraction. That's a whole episode of a show. You could've at least been entertained.",
  ],
  50: [
    "50 minutes. Genuinely asking — did you forget you had work?",
    "Almost an hour! Your focus goals called, they want a divorce.",
    "50 min deep. At this point I'm not judging, I'm worried.",
  ],
  60: [
    "ONE HOUR. This is an intervention. Please close this tab.",
    "60 minutes of distraction. That's it. I'm calling your mom.",
    "An entire hour gone. You could've learned a new skill by now. Just sayin'.",
  ]
};

function getDistractionMessage(minutes) {
  // Get the appropriate tier (round down to nearest 10)
  const tier = Math.min(Math.floor(minutes / 10) * 10, 60);
  const msgs = DISTRACTION_MESSAGES[tier] || DISTRACTION_MESSAGES[60];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

function sendGraduatedDistraction(tabId, domain, minutes) {
  const message = getDistractionMessage(minutes);
  const severity = minutes >= 30 ? 'high' : minutes >= 20 ? 'medium' : 'low';

  showOverlayOrNotify(
    tabId,
    { action: 'showDistractionBlock', domain, minutes, message, severity },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: minutes >= 30 ? '🚨 Time Check!' : '⏰ Still Here?',
      message,
      priority: minutes >= 30 ? 2 : 1
    }
  );
}

// Study encouragement messages
const STUDY_MESSAGES = {
  30: [
    "30 minutes of focus! You're in the zone!",
    "Half an hour of deep work — that's a full pomodoro! Keep going!",
    "30 min locked in. Your brain cells are doing a happy dance.",
  ],
  60: [
    "ONE HOUR of focus! 🎉 You're absolutely crushing it!",
    "60 minutes deep — you're built different. Seriously.",
    "A full hour of deep work! Future you is so grateful right now.",
  ],
  90: [
    "90 minutes! That's elite-level focus. Take a 5-min stretch? 🧘",
    "1.5 hours of pure productivity. You're on fire! 🔥",
    "90 min focused — you've outworked 90% of people today.",
  ],
  120: [
    "TWO HOURS! 🏆 You've entered scholar mode. Legend.",
    "120 minutes of focus. That's dedication. That's power.",
    "2 hours in! Maybe take a break? You've earned it, champ.",
  ],
  180: [
    "THREE HOURS?! 🤯 You're not human. Take a break, superhero!",
    "180 minutes. At this point you deserve a PhD just for sitting here.",
    "3 hours focused! Please drink water. Please.",
  ]
};

function sendStudyEncouragement(tabId, domain, minutes) {
  const msgs = STUDY_MESSAGES[minutes] || STUDY_MESSAGES[60];
  const message = msgs[Math.floor(Math.random() * msgs.length)];

  showOverlayOrNotify(
    tabId,
    { action: 'showStudyEncouragement', domain, minutes, message },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🌟 Great Work!',
      message,
      priority: 1
    }
  );
}

// =============================================
// Allowance System — Countdown Enforcement
// =============================================
let lastAllowanceWarning = 0;
const ALLOWANCE_WARNING_COOLDOWN = 60000; // 1 min between warnings

function checkAllowance(allowances, dailyStats, domain, currentSessionSeconds) {
  if (!domain || !allowances || Object.keys(allowances).length === 0) return;

  // Find matching allowance for this domain
  const matchedAllowanceDomain = Object.keys(allowances).find(d =>
    domain === d || domain.endsWith('.' + d)
  );

  if (!matchedAllowanceDomain) return;

  const { limitSeconds } = allowances[matchedAllowanceDomain];
  const today = localDateStr();
  const todayStats = dailyStats[today] || {};

  // Calculate total used time today (saved + current session), minus temp focus time
  chrome.storage.local.get({ tempFocusLog: {} }, (tfData) => {
    const todayTempFocus = (tfData.tempFocusLog || {})[today] || {};
    let usedSeconds = 0;
    Object.entries(todayStats).forEach(([d, seconds]) => {
      if (d === matchedAllowanceDomain || d.endsWith('.' + matchedAllowanceDomain)) {
        // Subtract temp focus time — it shouldn't count against allowance
        const tempSec = todayTempFocus[d] || 0;
        usedSeconds += Math.max(0, seconds - tempSec);
      }
    });
    usedSeconds += currentSessionSeconds;

    const remainingSeconds = limitSeconds - usedSeconds;
    const now = Date.now();

    // Warning thresholds
    if (remainingSeconds <= 0) {
      // Time's up — send block message
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, 0, limitSeconds, 'exceeded');
      }
    } else if (remainingSeconds <= 60 && remainingSeconds > 0) {
      // Less than 1 minute left
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, remainingSeconds, limitSeconds, 'critical');
      }
    } else if (remainingSeconds <= 300 && currentSessionSeconds % 60 === 0) {
      // Less than 5 minutes — countdown every minute
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, remainingSeconds, limitSeconds, 'warning');
      }
    }
  });
}

function sendAllowanceNotification(tabId, domain, remainingSeconds, limitSeconds, level) {
  const limitStr = formatTimeShort(limitSeconds);
  let title, message;

  if (level === 'exceeded') {
    const overMessages = [
      `Your ${limitStr} allowance for ${domain} is used up! Time to leave.`,
      `That's it — ${limitStr} of ${domain} used today. Willpower time! 💪`,
      `${domain} time: OVER. Your future self thanks you for closing this.`
    ];
    title = '🚫 Allowance Exceeded!';
    message = overMessages[Math.floor(Math.random() * overMessages.length)];
  } else if (level === 'critical') {
    title = '⏰ Less Than 1 Minute Left!';
    message = `${remainingSeconds}s remaining on ${domain}. Wrap up now!`;
  } else {
    const mins = Math.ceil(remainingSeconds / 60);
    title = '⏱️ Allowance Running Low';
    message = `${mins} minute${mins > 1 ? 's' : ''} left of your daily ${limitStr} on ${domain}.`;
  }

  showOverlayOrNotify(
    tabId,
    { action: 'showAllowanceCountdown', domain, remainingSeconds, limitSeconds, level },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: level === 'exceeded' ? 2 : 1
    }
  );
}

function formatTimeShort(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
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

// Sign-in / OAuth / system domains. These are never treated as distractions:
// no nudges, no allowance countdowns, and no stat tracking (e.g. Google sign-in).
const NEUTRAL_DOMAINS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'oauth2.googleapis.com',
  'content.googleapis.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'auth.openai.com'
];

function isNeutralDomain(domain) {
  if (!domain) return false;
  return NEUTRAL_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

// Search engines are NOT neutral by default — searching random things is a
// distraction. But searching *for one of your allowed sites* (to open it) is
// just a transit step, so we suppress the nudge only in that case.
const SEARCH_ENGINE_HOSTS = [
  'google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com',
  'ecosia.org', 'startpage.com', 'search.yahoo.com', 'yandex.com'
];

// The query string typed into a search engine, or null if the URL isn't a
// search-results page.
function getSearchQuery(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isSearch = SEARCH_ENGINE_HOSTS.some(d => host === d || host.endsWith('.' + d));
    if (!isSearch) return null;
    const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('p');
    return q ? q.toLowerCase().trim() : null;
  } catch (e) {
    return null;
  }
}

// The distinctive label of a domain, e.g. "wikipedia" from "en.wikipedia.org".
function domainKeyword(domain) {
  const parts = domain.replace(/^www\./, '').split('.');
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

// True when the URL is a search for one of the user's allowed study sites —
// i.e. the user is searching to *reach* an allowed site, not to get distracted.
function isAllowedSiteSearch(url, studyDomains) {
  const q = getSearchQuery(url);
  if (!q || !studyDomains || studyDomains.length === 0) return false;
  return studyDomains.some(d => {
    const keyword = domainKeyword(d);
    return q.includes(d) || (keyword.length >= 3 && q.includes(keyword));
  });
}

function evaluateTab(tab) {
  if (!tab || !isEnabled) return;
  const domain = getDomain(tab.url);
  if (!domain) return;
  // Never nudge on sign-in / OAuth pages (e.g. Google sign-in during Cloud Sync)
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

    // Searching a search engine for one of your allowed sites is transit, not a
    // distraction — don't nudge. (Searching for anything else still nudges.)
    if (isAllowedSiteSearch(tab.url, allowedStudyDomains)) return;

    if (!isStudyTab && !hasTempPass && allowedStudyDomains.length > 0) {
      // Throttle: at most one "off track" nudge per domain per cooldown window.
      const now = Date.now();
      if (now - (focusNudgeTimestamps[domain] || 0) < NOTIFICATION_COOLDOWN_MS) return;
      focusNudgeTimestamps[domain] = now;
      triggerFocusNotification(tab.id, domain);
    }
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    startTracking(activeInfo.tabId, tab.url, tab.title);
    evaluateTab(tab);
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
  if (tabId === activeTabId) {
    stopTracking();
  }
});

// The popup opens a port while it's on screen. Opening the action popup makes
// Chrome briefly report "no focused window", which would otherwise stop (and
// reset) tracking. We use this flag to ignore that self-inflicted blur.
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
    // Debounce: opening our own popup reports WINDOW_ID_NONE. Wait briefly, and
    // only stop if it wasn't our popup and focus really is still gone.
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

chrome.runtime.onInstalled.addListener((details) => {
  // Migrate legacy study domains stored with a "www." prefix so subdomain
  // matching works (e.g. an allowed "www.example.com" now covers "example.com").
  chrome.storage.local.get({ studyDomains: [] }, (d) => {
    const normalized = [...new Set(d.studyDomains.map(x => x.replace(/^www\./, '')))];
    if (JSON.stringify(normalized) !== JSON.stringify(d.studyDomains)) {
      chrome.storage.local.set({ studyDomains: normalized });
    }
  });

  chrome.alarms.create('flushStats', { periodInMinutes: 30 });
  scheduleDailySummaryAlarm();
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
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) startTracking(tabs[0].id, tabs[0].url, tabs[0].title);
  });
  scheduleDailySummaryAlarm();
  checkSummaryNotification();
});

// Schedule a daily alarm at 9 PM for end-of-day summary
function scheduleDailySummaryAlarm() {
  const now = new Date();
  let target = new Date();
  target.setHours(21, 0, 0, 0); // 9:00 PM

  // If it's already past 9 PM today, schedule for tomorrow
  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  const delayInMinutes = (target.getTime() - now.getTime()) / 60000;
  chrome.alarms.create('dailySummary', {
    delayInMinutes,
    periodInMinutes: 24 * 60 // Repeat every 24 hours
  });
}

function checkSummaryNotification() {
  const today = localDateStr();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateStr(yesterdayDate);

  chrome.storage.local.get(['lastSummaryNotifiedDate', 'dailyStats', 'studyDomains'], (data) => {
    if (data.lastSummaryNotifiedDate === today) return;

    const stats = data.dailyStats || {};
    const yesterdayStats = stats[yesterday];
    const studyDomains = data.studyDomains || [];

    if (yesterdayStats) {
      let focusSeconds = 0;
      let distractionSeconds = 0;
      const distractions = {};

      Object.entries(yesterdayStats).forEach(([domain, seconds]) => {
        const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
        if (isStudy) focusSeconds += seconds;
        else {
          distractionSeconds += seconds;
          distractions[domain] = (distractions[domain] || 0) + seconds;
        }
      });

      const total = focusSeconds + distractionSeconds;
      if (total > 0) {
        const score = Math.round((focusSeconds / total) * 100);
        const h = Math.floor(focusSeconds / 3600);
        const m = Math.floor((focusSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        const topDistractions = Object.entries(distractions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([d]) => d.replace('www.', ''))
          .join(', ');
        const message = topDistractions
          ? `Focus: ${timeStr} | Score: ${score}%. Top distractions: ${topDistractions}`
          : `Focus: ${timeStr} | Score: ${score}%. No distractions!`;

        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: '📊 Yesterday\'s Focus Summary',
          message,
          priority: 2
        });
      }
    }
    chrome.storage.local.set({ lastSummaryNotifiedDate: today });
  });
}

// End-of-day summary — triggered at 9 PM with today's stats
function sendEndOfDaySummary() {
  const today = localDateStr();

  chrome.storage.local.get(['lastEODSummaryDate', 'dailyStats', 'studyDomains'], (data) => {
    if (data.lastEODSummaryDate === today) return;

    const stats = data.dailyStats || {};
    const todayStats = stats[today];
    const studyDomains = data.studyDomains || [];

    if (!todayStats) {
      chrome.notifications.create('eod-summary-' + today, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '📊 Daily Focus Summary',
        message: 'No browsing activity tracked today. Take a break! 🌙',
        priority: 1
      });
      chrome.storage.local.set({ lastEODSummaryDate: today });
      return;
    }

    let focusSeconds = 0;
    let distractionSeconds = 0;
    const distractions = {};

    Object.entries(todayStats).forEach(([domain, seconds]) => {
      const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
      if (isStudy) focusSeconds += seconds;
      else {
        distractionSeconds += seconds;
        distractions[domain] = (distractions[domain] || 0) + seconds;
      }
    });

    const total = focusSeconds + distractionSeconds;
    if (total === 0) {
      chrome.storage.local.set({ lastEODSummaryDate: today });
      return;
    }

    const score = Math.round((focusSeconds / total) * 100);
    const h = Math.floor(focusSeconds / 3600);
    const m = Math.floor((focusSeconds % 3600) / 60);
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

    const topDistractions = Object.entries(distractions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d.replace('www.', ''))
      .join(', ');

    let emoji = score >= 80 ? '🔥' : score >= 50 ? '👍' : '⚠️';
    let message = `${emoji} Focus: ${timeStr} | Score: ${score}%`;
    if (topDistractions) {
      message += `\nTop distractions: ${topDistractions}`;
    } else {
      message += `\nZero distractions today! Amazing! 🎉`;
    }

    chrome.notifications.create('eod-summary-' + today, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '📊 Daily Focus Summary',
      message,
      priority: 2
    });

    chrome.storage.local.set({ lastEODSummaryDate: today });
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
  if (alarm.name === 'dailySummary') {
    sendEndOfDaySummary();
  }
  if (alarm.name === 'pomodoroDone') {
    completePomodoro();
  }
  if (alarm.name === 'keepAlive') {
    // Just keeps the service worker alive — restart badge timer if needed
    if (activeStartTime && !badgeTimerInterval) {
      badgeTimerInterval = setInterval(updateBadge, 1000);
    }
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

// Start a temp focus pass for a domain
function startTempFocusPass(domain, minutes) {
  const expiresAt = Date.now() + (minutes * 60 * 1000);
  chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
    const passes = data.tempFocusPasses;
    passes[domain] = { expiresAt, minutes };
    chrome.storage.local.set({ tempFocusPasses: passes });

    // Create an alarm to expire this pass (min 1 min — Chrome ignores shorter).
    chrome.alarms.create(`tempFocus_${domain}`, { delayInMinutes: Math.max(minutes, 1) });
  });
}

// Cancel a temp focus pass
function cancelTempFocusPass(domain) {
  chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
    const passes = data.tempFocusPasses;
    delete passes[domain];
    chrome.storage.local.set({ tempFocusPasses: passes });
    chrome.alarms.clear(`tempFocus_${domain}`);
  });
}

// Check if a domain has an active temp focus pass
function hasTempFocusPass(domain, callback) {
  chrome.storage.local.get({ tempFocusPasses: {} }, (data) => {
    const passes = data.tempFocusPasses;
    const pass = Object.entries(passes).find(([d]) =>
      domain === d || domain.endsWith('.' + d)
    );
    if (pass && pass[1].expiresAt > Date.now()) {
      callback(true);
    } else {
      // Clean up expired pass
      if (pass) {
        delete passes[pass[0]];
        chrome.storage.local.set({ tempFocusPasses: passes });
      }
      callback(false);
    }
  });
}

// Listen for messages from popup
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
    // Content script asks us to close its tab (window.close() is a no-op on
    // normal tabs, so "Exit This Site" couldn't close them by itself).
    const tabId = sender.tab && sender.tab.id;
    if (tabId) chrome.tabs.remove(tabId).catch(() => { });
    sendResponse({ success: true });
  } else if (message.action === 'pomodoroStart') {
    // Schedule completion in the background so it fires even if the popup is
    // closed. `endsAt` is an absolute timestamp.
    chrome.alarms.create('pomodoroDone', { when: message.endsAt });
    sendResponse({ success: true });
  } else if (message.action === 'pomodoroStop') {
    chrome.alarms.clear('pomodoroDone');
    sendResponse({ success: true });
  }
});

// Fire the Pomodoro completion (session count + notification) from the
// background so it happens on time regardless of whether the popup is open.
function completePomodoro() {
  chrome.storage.local.get({ pomoState: null, pomoSessions: 0 }, (data) => {
    const mode = data.pomoState ? data.pomoState.mode : 'focus';
    chrome.storage.local.set({ pomoState: null });
    if (mode === 'focus') {
      chrome.storage.local.set({ pomoSessions: data.pomoSessions + 1 });
      chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Pomodoro Complete!', message: 'Great work! Take a break.', priority: 2
      });
    } else {
      chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Break Over!', message: 'Time to focus again.', priority: 2
      });
    }
  });
}

// Clicking any of our notifications should dismiss it.
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
});
