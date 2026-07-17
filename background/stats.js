// Stats persistence — saving time-tracking data to IndexedDB

import { localDateStr, isNeutralDomain, isAllowedSiteSearch } from './utils.js';
import {
  addDomainSeconds,
  addUrlDuration,
  addHourlySeconds,
  addTempFocusSeconds,
  getDomainStatsByDate,
  getTempFocusLogByDate,
  addFocusSession
} from '../lib/stats-db.js';

// Serialize stat writes so overlapping tab-switch / flush-alarm events can't
// produce race conditions during the read-modify-write of hourly categorization.
let statsWriteChain = Promise.resolve();

export function saveStats(domain, url, title, duration, startTime = Date.now() - duration * 1000) {
  statsWriteChain = statsWriteChain
    .then(() => saveStatsInternal(domain, url, title, duration, startTime))
    .catch(() => { });
}

function saveStatsInternal(domain, url, title, duration, startTime) {
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
        let isFocusSession = isStudy;

        if (isStudy) {
          await addHourlySeconds(today, hour, duration, 0);
        } else {
          // Check if domain has an active temp focus pass
          const matchedPass = Object.entries(data.tempFocusPasses).find(([d]) =>
            domain === d || domain.endsWith('.' + d)
          );
          if (matchedPass && matchedPass[1].expiresAt > Date.now()) {
            // Temp focus pass active — count as focus
            isFocusSession = true;
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

        // Log the individual session for weighted focus scoring
        await addFocusSession(today, domain, startTime, duration, isFocusSession);

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

/**
 * Send a weekly focus summary notification every Sunday at 8 PM.
 * Compares this week vs last week and shows percentage change.
 */
export async function sendWeeklySummary() {
  const today = localDateStr();
  const dayOfWeek = new Date().getDay(); // 0 = Sunday

  // Only fire on Sunday (belt-and-suspenders check alongside the alarm)
  if (dayOfWeek !== 0) return;

  const localData = await new Promise(resolve =>
    chrome.storage.local.get(['lastWeeklySummaryDate', 'studyDomains'], resolve)
  );

  if (localData.lastWeeklySummaryDate === today) return;

  const studyDomains = localData.studyDomains || [];

  // This week: last 7 days (Mon–Sun)
  const thisWeekDates = [];
  const lastWeekDates = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    thisWeekDates.push(localDateStr(d));

    const ld = new Date(now);
    ld.setDate(ld.getDate() - i - 7);
    lastWeekDates.push(localDateStr(ld));
  }

  // Read stats for both weeks from IndexedDB
  const { getDomainStatsByDate } = await import('../lib/stats-db.js');

  let thisWeekFocus = 0;
  let thisWeekDistraction = 0;
  let lastWeekFocus = 0;
  let lastWeekDistraction = 0;
  const topDomains = {};

  for (const date of thisWeekDates) {
    const dayStats = await getDomainStatsByDate(date);
    Object.entries(dayStats).forEach(([domain, seconds]) => {
      const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
      if (isStudy) {
        thisWeekFocus += seconds;
        topDomains[domain] = (topDomains[domain] || 0) + seconds;
      } else {
        thisWeekDistraction += seconds;
      }
    });
  }

  for (const date of lastWeekDates) {
    const dayStats = await getDomainStatsByDate(date);
    Object.entries(dayStats).forEach(([domain, seconds]) => {
      const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
      if (isStudy) lastWeekFocus += seconds;
      else lastWeekDistraction += seconds;
    });
  }

  const thisWeekTotal = thisWeekFocus + thisWeekDistraction;
  if (thisWeekTotal === 0) {
    chrome.storage.local.set({ lastWeeklySummaryDate: today });
    return;
  }

  // Format focus time
  const focusHours = Math.floor(thisWeekFocus / 3600);
  const focusMins = Math.floor((thisWeekFocus % 3600) / 60);
  const focusStr = focusHours > 0 ? `${focusHours}h ${focusMins}m` : `${focusMins}m`;

  // Calculate percentage change
  let changeStr = '';
  if (lastWeekFocus > 0) {
    const pctChange = Math.round(((thisWeekFocus - lastWeekFocus) / lastWeekFocus) * 100);
    if (pctChange > 0) {
      changeStr = `, up ${pctChange}% from last week 📈`;
    } else if (pctChange < 0) {
      changeStr = `, down ${Math.abs(pctChange)}% from last week 📉`;
    } else {
      changeStr = ', same as last week';
    }
  } else {
    changeStr = ' (no data from last week to compare)';
  }

  // Focus score
  const score = Math.round((thisWeekFocus / thisWeekTotal) * 100);

  // Top focus site
  const topSite = Object.entries(topDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([d]) => d.replace('www.', ''))[0] || '';

  const topSiteStr = topSite ? ` | Top site: ${topSite}` : '';

  const emoji = score >= 80 ? '🔥' : score >= 60 ? '💪' : score >= 40 ? '👍' : '⚠️';
  const message = `${emoji} You spent ${focusStr} focused this week${changeStr}. Score: ${score}%${topSiteStr}`;

  // On-screen notification
  chrome.notifications.create('weekly-summary-' + today, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '📊 Weekly Focus Summary',
    message,
    priority: 2
  });

  // Email notification (if user has configured an email address)
  const emailData = await new Promise(resolve =>
    chrome.storage.local.get({ emailNotifAddress: '', emailjsConfig: null }, resolve)
  );
  if (emailData.emailNotifAddress && emailData.emailjsConfig) {
    sendWeeklyEmail(emailData.emailNotifAddress, emailData.emailjsConfig, {
      focusStr, changeStr, score, topSite,
      thisWeekFocus, thisWeekDistraction, lastWeekFocus
    });
  }

  chrome.storage.local.set({ lastWeeklySummaryDate: today });
}

/**
 * Send the weekly summary email via EmailJS REST API.
 * No server required — EmailJS free tier allows 200 emails/month.
 *
 * To configure, the user (developer) sets emailjsConfig in chrome.storage.local:
 * { serviceId: "...", templateId: "...", publicKey: "..." }
 *
 * Template variables available:
 *   {{to_email}}, {{focus_time}}, {{change}}, {{score}}, {{top_site}},
 *   {{focus_seconds}}, {{distraction_seconds}}, {{prev_focus_seconds}}
 */
async function sendWeeklyEmail(toEmail, config, data) {
  try {
    const templateParams = {
      to_email: toEmail,
      focus_time: data.focusStr,
      change: data.changeStr.replace(/^, /, ''),
      score: `${data.score}%`,
      top_site: data.topSite || 'N/A',
      focus_seconds: data.thisWeekFocus,
      distraction_seconds: data.thisWeekDistraction,
      prev_focus_seconds: data.lastWeekFocus
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        template_params: templateParams
      })
    });

    if (response.ok) {
      console.log('[Hocus Focus] Weekly email sent to', toEmail);
    } else {
      console.warn('[Hocus Focus] Email send failed:', response.status, await response.text());
    }
  } catch (err) {
    console.warn('[Hocus Focus] Email send error:', err);
  }
}
