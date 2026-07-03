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
  if (!isEnabled || !activeStartTime) {
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
  chrome.storage.local.get({ studyDomains: [], allowances: {}, dailyStats: {} }, (data) => {
    const isStudy = data.studyDomains.some(
      (allowedDomain) =>
        activeDomain === allowedDomain || activeDomain.endsWith(`.${allowedDomain}`)
    );

    chrome.action.setBadgeBackgroundColor({
      color: isStudy ? '#6abf9b' : '#fca5a5'
    });

    const minutes = Math.floor(durationSec / 60);

    // --- Allowance System Check (only for non-study sites) ---
    if (!isStudy) {
      checkAllowance(data.allowances, data.dailyStats, activeDomain, durationSec);
    }

    // Graduated distraction nudges every 10 minutes
    if (!isStudy && durationSec > 0 && minutes >= 10 && durationSec % 600 === 0) {
      sendGraduatedDistraction(activeTabId, activeDomain, minutes);
    }

    // Study encouragement at milestones: 30m, 1h, 1.5h, 2h, 3h
    if (isStudy && durationSec > 0) {
      const studyMilestones = [30, 60, 90, 120, 180];
      if (studyMilestones.includes(minutes) && durationSec % 60 === 0) {
        sendStudyEncouragement(activeTabId, activeDomain, minutes);
      }
    }
  });
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
  chrome.storage.session.remove('trackingState');
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
    chrome.storage.session.get('trackingState', (data) => {
      if (data.trackingState && data.trackingState.url === url) {
        // Same URL — restore the original start time (don't reset)
        activeTabId = tabId;
        activeStartTime = data.trackingState.startTime;
        activeDomain = data.trackingState.domain;
        activeUrl = data.trackingState.url;
        activeTitle = data.trackingState.title;
        if (!badgeTimerInterval) {
          badgeTimerInterval = setInterval(updateBadge, 1000);
        }
        updateBadge();
      } else {
        // Different URL — start fresh
        beginFreshTracking(tabId, url, title, domain);
      }
    });
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

  chrome.storage.session.set({
    trackingState: { tabId, startTime: activeStartTime, domain, url, title: activeTitle }
  });

  // Keep service worker alive while tracking
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

  if (!badgeTimerInterval) {
    badgeTimerInterval = setInterval(updateBadge, 1000);
  }
  updateBadge();
}

function saveStats(domain, url, title, duration) {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();
  chrome.storage.local.get({ dailyStats: {}, dailyUrlStats: {}, hourlyStats: {} }, (data) => {
    const stats = data.dailyStats;
    const urlStats = data.dailyUrlStats;
    const hourly = data.hourlyStats;

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

    // Update hourly stats
    if (!hourly[today]) hourly[today] = {};
    if (!hourly[today][hour]) hourly[today][hour] = { focus: 0, distraction: 0 };
    chrome.storage.local.get({ studyDomains: [] }, (sd) => {
      const isStudy = sd.studyDomains.some(d => domain === d || domain.endsWith('.' + d));
      if (isStudy) hourly[today][hour].focus += duration;
      else hourly[today][hour].distraction += duration;
      chrome.storage.local.set({ dailyStats: stats, dailyUrlStats: urlStats, hourlyStats: hourly });
    });
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

  chrome.storage.local.get({ customNudges: [] }, (data) => {
    const defaultMessages = [
      `You wandered onto ${currentDomain}. Your study notes miss you.`,
      `${currentDomain}? Really? Your textbook is crying.`,
      `Plot twist: ${currentDomain} won't help you pass that exam.`
    ];

    const allMessages = data.customNudges.length > 0
      ? [...data.customNudges, ...defaultMessages]
      : defaultMessages;
    const message = allMessages[Math.floor(Math.random() * allMessages.length)];

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🫣 Caught You!',
      message,
      priority: 1
    });

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'showFocusNudge',
        domain: currentDomain,
        customMessage: message
      }).catch(() => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        }).then(() => {
          chrome.tabs.sendMessage(tabId, {
            action: 'showFocusNudge',
            domain: currentDomain,
            customMessage: message
          });
        }).catch(() => {});
      });
    }
  });
}

// Witty distraction messages — escalate with time
const DISTRACTION_MESSAGES = {
  10: [
    "10 minutes gone. That's a whole pomodoro warm-up wasted here 🍅",
    "You've been here 10 min. Your future self is side-eyeing you.",
    "10 minutes of pure procrastination. Impressive commitment, honestly.",
  ],
  20: [
    "20 minutes?! At this point, list it as a hobby on your resume.",
    "Still here after 20 min? This site should pay you rent.",
    "20 minutes. That's almost enough time to learn something useful. Almost.",
  ],
  30: [
    "30 minutes. Half an hour. Gone. Poof. Like your productivity. 💨",
    "You've officially spent more time here than on actual work. Ouch.",
    "30 min! If procrastination was a sport, you'd be going pro.",
  ],
  40: [
    "40 minutes. At this rate, your to-do list is writing its resignation letter.",
    "Still going? Your textbooks filed a missing person report.",
    "40 min of distraction. That's a whole episode of a show. You could've at least been entertained.",
  ],
  50: [
    "50 minutes. Genuinely asking — did you forget you had work? 🤔",
    "Almost an hour! Your study goals called, they want a divorce.",
    "50 min deep. At this point I'm not judging, I'm worried.",
  ],
  60: [
    "ONE HOUR. 🚨 This is an intervention. Please close this tab.",
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

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: minutes >= 30 ? '🚨 Time Check!' : '⏰ Still Here?',
    message,
    priority: minutes >= 30 ? 2 : 1
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'showDistractionBlock',
      domain,
      minutes,
      message,
      severity
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'showDistractionBlock',
          domain,
          minutes,
          message,
          severity
        });
      }).catch(() => {});
    });
  }
}

// Study encouragement messages
const STUDY_MESSAGES = {
  30: [
    "30 minutes of focus! You're in the zone 🧠✨",
    "Half an hour of deep work — that's a full pomodoro! Keep going!",
    "30 min locked in. Your brain cells are doing a happy dance.",
  ],
  60: [
    "ONE HOUR of focus! 🎉 You're absolutely crushing it!",
    "60 minutes deep — you're built different. Seriously.",
    "A full hour of studying! Future you is so grateful right now.",
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
    "3 hours focused! Please drink water. Please. 💧",
  ]
};

function sendStudyEncouragement(tabId, domain, minutes) {
  const msgs = STUDY_MESSAGES[minutes] || STUDY_MESSAGES[60];
  const message = msgs[Math.floor(Math.random() * msgs.length)];

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '🌟 Great Work!',
    message,
    priority: 1
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'showStudyEncouragement',
      domain,
      minutes,
      message
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'showStudyEncouragement',
          domain,
          minutes,
          message
        });
      }).catch(() => {});
    });
  }
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
  const today = new Date().toISOString().split('T')[0];
  const todayStats = dailyStats[today] || {};

  // Calculate total used time today (saved + current session)
  let usedSeconds = 0;
  Object.entries(todayStats).forEach(([d, seconds]) => {
    if (d === matchedAllowanceDomain || d.endsWith('.' + matchedAllowanceDomain)) {
      usedSeconds += seconds;
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

  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: level === 'exceeded' ? 2 : 1
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'showAllowanceCountdown',
      domain,
      remainingSeconds,
      limitSeconds,
      level
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }).then(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'showAllowanceCountdown',
          domain,
          remainingSeconds,
          limitSeconds,
          level
        });
      }).catch(() => {});
    });
  }
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

chrome.runtime.onInstalled.addListener((details) => {
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
  const today = new Date().toISOString().split('T')[0];

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
  if (alarm.name === 'keepAlive') {
    // Just keeps the service worker alive — restart badge timer if needed
    if (activeStartTime && !badgeTimerInterval) {
      badgeTimerInterval = setInterval(updateBadge, 1000);
    }
    updateBadge();
  }
});
