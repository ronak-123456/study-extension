// Allowance system — countdown enforcement

import { localDateStr } from './utils.js';
import { sendAllowanceNotification } from './notifications.js';

let lastAllowanceWarning = 0;
const ALLOWANCE_WARNING_COOLDOWN = 60000; // 1 min between warnings

/**
 * Check if the current domain has exceeded or is nearing its daily allowance.
 * Called once per badge tick for non-study, non-temp-pass, non-neutral sites.
 */
export function checkAllowance(allowances, dailyStats, domain, currentSessionSeconds, activeTabId) {
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
        const tempSec = todayTempFocus[d] || 0;
        usedSeconds += Math.max(0, seconds - tempSec);
      }
    });
    usedSeconds += currentSessionSeconds;

    const remainingSeconds = limitSeconds - usedSeconds;
    const now = Date.now();

    // Warning thresholds
    if (remainingSeconds <= 0) {
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, 0, limitSeconds, 'exceeded');
      }
    } else if (remainingSeconds <= 60 && remainingSeconds > 0) {
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, remainingSeconds, limitSeconds, 'critical');
      }
    } else if (remainingSeconds <= 300 && currentSessionSeconds % 60 === 0) {
      if (now - lastAllowanceWarning > ALLOWANCE_WARNING_COOLDOWN) {
        lastAllowanceWarning = now;
        sendAllowanceNotification(activeTabId, matchedAllowanceDomain, remainingSeconds, limitSeconds, 'warning');
      }
    }
  });
}
