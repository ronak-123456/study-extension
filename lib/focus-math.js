// Shared focus/distraction accounting.
//
// This calculation used to be copy-pasted into both newtab.js and
// analysis/analysis.js. Keeping one copy means the new tab and the dashboard
// can't drift apart and report different numbers for the same day.
//
// Loaded as a classic script (no modules) so plain <script> pages can use it.

(function (root) {
  'use strict';

  function matchesDomain(candidate, base) {
    return candidate === base || candidate.endsWith('.' + base);
  }

  // Seconds of `domain` that a temp focus pass should count as deep work.
  function tempFocusSecondsFor(domain, seconds, isStudy, dayTempFocus, tempFocusPasses) {
    const logged = dayTempFocus[domain] || 0;
    if (isStudy || logged > 0) return logged;

    // Legacy fallback: time recorded before tempFocusLog existed has no entry,
    // so an active pass credits the whole of that domain's time for the day.
    const hasActivePass = Object.entries(tempFocusPasses).find(([d, p]) =>
      matchesDomain(domain, d) && p.expiresAt > Date.now()
    );
    return hasActivePass ? seconds : 0;
  }

  // Distraction seconds for time not covered by focus or a pass. An allowance
  // makes time free up to its limit; only the excess counts against you.
  function distractionSecondsFor(domain, seconds, allowances) {
    if (seconds <= 0) return 0;
    const matched = Object.keys(allowances).find(d => matchesDomain(domain, d));
    if (!matched) return seconds;
    const limitSeconds = allowances[matched].limitSeconds || 0;
    return seconds > limitSeconds ? seconds - limitSeconds : 0;
  }

  /**
   * Aggregate focus/distraction across one or more days.
   *
   * @param {string[]} dates      Day keys (YYYY-MM-DD) to include.
   * @param {object}   opts       { dailyStats, studyDomains, allowances,
   *                                tempFocusLog, tempFocusPasses }
   * @returns {{focusSeconds:number, distractionSeconds:number,
   *            sites:Set<string>, domains:Array}}
   *          `domains` is one entry per domain: { domain, seconds, isStudy }.
   */
  function computeFocusBreakdown(dates, opts) {
    const dailyStats = opts.dailyStats || {};
    const studyDomains = opts.studyDomains || [];
    const allowances = opts.allowances || {};
    const tempFocusLog = opts.tempFocusLog || {};
    const tempFocusPasses = opts.tempFocusPasses || {};

    let focusSeconds = 0;
    let distractionSeconds = 0;
    const sites = new Set();
    const totals = {};

    dates.forEach((date) => {
      const dayStats = dailyStats[date] || {};
      const dayTempFocus = tempFocusLog[date] || {};

      Object.entries(dayStats).forEach(([domain, seconds]) => {
        const isStudy = studyDomains.some(d => matchesDomain(domain, d));
        const tempSeconds = tempFocusSecondsFor(
          domain, seconds, isStudy, dayTempFocus, tempFocusPasses
        );

        if (isStudy) {
          focusSeconds += seconds;
        } else if (tempSeconds > 0) {
          const credited = Math.min(tempSeconds, seconds);
          focusSeconds += credited;
          distractionSeconds += distractionSecondsFor(domain, seconds - credited, allowances);
        } else {
          distractionSeconds += distractionSecondsFor(domain, seconds, allowances);
        }

        sites.add(domain);
        if (!totals[domain]) {
          totals[domain] = { domain, seconds: 0, isStudy: isStudy || tempSeconds > 0 };
        }
        totals[domain].seconds += seconds;
      });
    });

    return {
      focusSeconds,
      distractionSeconds,
      sites,
      domains: Object.values(totals)
    };
  }

  // Percentage of tracked time that was deep work, 0 when nothing is tracked.
  function focusScore(focusSeconds, distractionSeconds) {
    const total = focusSeconds + distractionSeconds;
    return total > 0 ? Math.round((focusSeconds / total) * 100) : 0;
  }

  root.HocusFocusMath = { computeFocusBreakdown, focusScore, matchesDomain };
})(typeof self !== 'undefined' ? self : this);
