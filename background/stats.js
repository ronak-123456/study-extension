// Stats persistence — saving time-tracking data to IndexedDB

import { localDateStr, isNeutralDomain, isAllowedSiteSearch } from './utils.js';
import {
  addDomainSeconds,
  addUrlDuration,
  addHourlySeconds,
  addTempFocusSeconds,
  getDomainStatsByDate,
  getTempFocusLogByDate
} from '../lib/stats-db.js';

// Serialize stat writes so overlapping tab-switch / flush-alarm events can't
// produce race conditions during the read-modify-write of hourly categorization.
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

    // We still need studyDomains, allowances, and tempFocusPasses from chrome.storage
    // (those stay there — they're settings, not time-tracking data)
    chrome.storage.local.get({
      studyDomains: [], allowances: {}, tempFocusPasses: {}
    }, async (data) => {
      try {
        // Don't record sign-in/OAuth pages or searches for an allowed site
        if (isNeutralDomain(domain) || isAllowedSiteSearch(url, data.studyDomains)) {
          resolve();
          return;
        }

        // Write domain stats and URL stats (always, regardless of category)
        await addDomainSeconds(today, domain, duration);
        await addUrlDuration(today, url, title, domain, duration);

        // Categorize into focus vs distraction for hourly stats
        const isStudy = data.studyDomains.some(d => domain === d || domain.endsWith('.' + d));
        if (isStudy) {
          await addHourlySeconds(today, hour, duration, 0);
        } else {
          // Check if domain has an active temp focus pass
          const matchedPass = Object.entries(data.tempFocusPasses).find(([d]) =>
            domain === d || domain.endsWith('.' + d)
          );
          if (matchedPass && matchedPass[1].expiresAt > Date.now()) {
            // Temp focus pass active — count as focus
            await addHourlySeconds(today, hour, duration, 0);
            await addTempFocusSeconds(today, domain, duration);
          } else {
            // Check if this domain has an allowance
            const allowances = data.allowances || {};
            const matchedAllowanceDomain = Object.keys(allowances).find(d =>
              domain === d || domain.endsWith('.' + d)
            );

            if (matchedAllowanceDomain) {
              const { limitSeconds } = allowances[matchedAllowanceDomain];
              // Read today's stats from IndexedDB to check allowance usage
              const todayStats = await getDomainStatsByDate(today);
              const todayTempFocusLog = await getTempFocusLogByDate(today);
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
                  await addHourlySeconds(today, hour, 0, distractionPortion);
                }
              }
            } else {
              await addHourlySeconds(today, hour, 0, duration);
            }
          }
        }

        resolve();
      } catch (err) {
        console.error('[stats] Error saving to IndexedDB:', err);
        resolve(); // Don't break the chain
      }
    });
  });
}

/**
 * Send the daily summary notification (end-of-day at 9 PM).
 */
export async function sendEndOfDaySummary() {
  const today = localDateStr();

  const localData = await new Promise(resolve =>
    chrome.storage.local.get(['lastEODSummaryDate', 'studyDomains'], resolve)
  );

  if (localData.lastEODSummaryDate === today) return;

  const studyDomains = localData.studyDomains || [];
  const todayStats = await getDomainStatsByDate(today);

  if (!todayStats || Object.keys(todayStats).length === 0) {
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
}

/**
 * Check if yesterday's summary should be shown (on startup).
 */
export async function checkSummaryNotification() {
  const today = localDateStr();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateStr(yesterdayDate);

  const localData = await new Promise(resolve =>
    chrome.storage.local.get(['lastSummaryNotifiedDate', 'studyDomains'], resolve)
  );

  if (localData.lastSummaryNotifiedDate === today) return;

  const studyDomains = localData.studyDomains || [];
  const yesterdayStats = await getDomainStatsByDate(yesterday);

  if (yesterdayStats && Object.keys(yesterdayStats).length > 0) {
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
}
