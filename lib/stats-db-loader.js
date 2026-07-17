/**
 * lib/stats-db-loader.js
 *
 * Bridge for non-module scripts (analysis.js, newtab.js) that need IndexedDB
 * time-tracking data. Loads all data and attaches it to window._statsDB so
 * consuming scripts can read it synchronously after this script runs.
 *
 * Also patches chrome.storage.local.get to transparently serve IDB data for
 * time-tracking keys, so existing code works without modification.
 *
 * Usage in HTML (must come BEFORE the consuming script):
 *   <script type="module" src="../lib/stats-db-loader.js"></script>
 */

import {
  getAllDomainStats,
  getAllUrlStats,
  getAllHourlyStats,
  getAllTempFocusLog,
  getDomainStatsByDate,
  getUrlStatsByDate,
  getHourlyStatsByDate,
  getTempFocusLogByDate,
  getDomainStatsRange,
  getSessionsByDate,
  getSessionsRange,
  calculateWeightedScore,
  calculateSimpleScore
} from './stats-db.js';

// Keys that have been migrated to IndexedDB
const IDB_KEYS = ['dailyStats', 'dailyUrlStats', 'hourlyStats', 'tempFocusLog'];

// Load all data and expose it globally
const dataPromise = (async () => {
  const [dailyStats, dailyUrlStats, hourlyStats, tempFocusLog] = await Promise.all([
    getAllDomainStats(),
    getAllUrlStats(),
    getAllHourlyStats(),
    getAllTempFocusLog()
  ]);
  return { dailyStats, dailyUrlStats, hourlyStats, tempFocusLog };
})();

// Expose the IDB functions globally for scripts that need them
window._statsDB = {
  ready: dataPromise,
  getDomainStatsByDate,
  getUrlStatsByDate,
  getHourlyStatsByDate,
  getTempFocusLogByDate,
  getDomainStatsRange,
  getAllDomainStats,
  getAllUrlStats,
  getAllHourlyStats,
  getAllTempFocusLog,
  getSessionsByDate,
  getSessionsRange,
  calculateWeightedScore,
  calculateSimpleScore
};

// Patch chrome.storage.local.get to transparently inject IDB data for
// time-tracking keys. This allows existing scripts (analysis.js, newtab.js,
// popup/modules/allowances.js) to work without rewriting their callbacks.
const originalGet = chrome.storage.local.get.bind(chrome.storage.local);

chrome.storage.local.get = function(keysOrDefaults, callback) {
  // Determine which IDB keys are being requested
  let requestedKeys = [];
  let defaults = {};

  if (Array.isArray(keysOrDefaults)) {
    requestedKeys = keysOrDefaults;
  } else if (typeof keysOrDefaults === 'object' && keysOrDefaults !== null) {
    requestedKeys = Object.keys(keysOrDefaults);
    defaults = keysOrDefaults;
  } else if (typeof keysOrDefaults === 'string') {
    requestedKeys = [keysOrDefaults];
  } else {
    // get(null) = get everything — still need to include IDB data
    requestedKeys = IDB_KEYS;
  }

  const idbKeysNeeded = requestedKeys.filter(k => IDB_KEYS.includes(k));
  const chromeKeysNeeded = requestedKeys.filter(k => !IDB_KEYS.includes(k));

  if (idbKeysNeeded.length === 0) {
    // No IDB keys requested — pass through to original
    return originalGet(keysOrDefaults, callback);
  }

  // Fetch IDB data + chrome.storage data in parallel
  const chromeGet = chromeKeysNeeded.length > 0
    ? new Promise(resolve => {
        const chromeDefaults = {};
        chromeKeysNeeded.forEach(k => { if (k in defaults) chromeDefaults[k] = defaults[k]; });
        originalGet(Object.keys(chromeDefaults).length > 0 ? chromeDefaults : chromeKeysNeeded, resolve);
      })
    : Promise.resolve({});

  Promise.all([dataPromise, chromeGet]).then(([idbData, chromeData]) => {
    const result = { ...chromeData };

    // Inject IDB data for requested keys
    idbKeysNeeded.forEach(key => {
      if (key === 'dailyStats') result.dailyStats = idbData.dailyStats;
      else if (key === 'dailyUrlStats') result.dailyUrlStats = idbData.dailyUrlStats;
      else if (key === 'hourlyStats') result.hourlyStats = idbData.hourlyStats;
      else if (key === 'tempFocusLog') result.tempFocusLog = idbData.tempFocusLog;
    });

    // Apply defaults for any missing keys
    Object.entries(defaults).forEach(([k, v]) => {
      if (!(k in result) || result[k] === undefined) result[k] = v;
    });

    if (callback) callback(result);
  });
};
