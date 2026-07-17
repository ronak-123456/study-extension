// Stats persistence — saving time-tracking data to chrome.storage

import { localDateStr, isNeutralDomain, isAllowedSiteSearch } from './utils.js';

// Serialize stat writes so overlapping tab-switch / flush-alarm events can't
// each read the old object and clobber one another's increments.
let statsWriteChain = Promise.resolve();

export function saveStats(domain, url, title, duration) {
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

/**
 * Send the daily summary notification (end-of-day at 9 PM).
 */
export function sendEndOfDaySummary() {
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

/**
 * Check if yesterday's summary should be shown (on startup).
 */
export function checkSummaryNotification() {
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
