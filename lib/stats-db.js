/**
 * lib/stats-db.js — Shared IndexedDB module for time-tracking data.
 *
 * Works in both the background service worker and page contexts (popup,
 * newtab, analysis). All functions return Promises.
 *
 * Stores:
 *   domainStats   — key: [date, domain]        → { seconds }
 *   urlStats      — key: [date, url]           → { title, domain, duration }
 *   hourlyStats   — key: [date, hour]          → { focus, distraction }
 *   tempFocusLog  — key: [date, domain]        → { seconds }
 *   focusSessions — key: auto-increment        → { date, domain, startTime, duration, isFocus }
 *
 * Indexes allow efficient date-range queries (e.g. all stats for a week).
 */

const DB_NAME = 'HocusFocusStats';
const DB_VERSION = 2;

let dbInstance = null;
let dbOpenPromise = null;

/**
 * Open (or reuse) the IndexedDB connection.
 */
export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // domainStats: keyed by [date, domain]
      if (!db.objectStoreNames.contains('domainStats')) {
        const store = db.createObjectStore('domainStats', { keyPath: ['date', 'domain'] });
        store.createIndex('byDate', 'date', { unique: false });
      }

      // urlStats: keyed by [date, url]
      if (!db.objectStoreNames.contains('urlStats')) {
        const store = db.createObjectStore('urlStats', { keyPath: ['date', 'url'] });
        store.createIndex('byDate', 'date', { unique: false });
        store.createIndex('byDomain', ['date', 'domain'], { unique: false });
      }

      // hourlyStats: keyed by [date, hour]
      if (!db.objectStoreNames.contains('hourlyStats')) {
        const store = db.createObjectStore('hourlyStats', { keyPath: ['date', 'hour'] });
        store.createIndex('byDate', 'date', { unique: false });
      }

      // tempFocusLog: keyed by [date, domain]
      if (!db.objectStoreNames.contains('tempFocusLog')) {
        const store = db.createObjectStore('tempFocusLog', { keyPath: ['date', 'domain'] });
        store.createIndex('byDate', 'date', { unique: false });
      }

      // focusSessions: individual browsing sessions for weighted scoring
      // Each record = one uninterrupted visit to a domain
      if (!db.objectStoreNames.contains('focusSessions')) {
        const store = db.createObjectStore('focusSessions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('byDate', 'date', { unique: false });
        store.createIndex('byDateAndType', ['date', 'isFocus'], { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      // Handle unexpected close (browser GC, version change)
      dbInstance.onclose = () => { dbInstance = null; dbOpenPromise = null; };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbOpenPromise = null;
      reject(event.target.error);
    };
  });

  return dbOpenPromise;
}

// =============================================
// domainStats CRUD
// =============================================

/**
 * Increment seconds for a domain on a given date.
 */
export async function addDomainSeconds(date, domain, seconds) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('domainStats', 'readwrite');
    const store = tx.objectStore('domainStats');
    const key = [date, domain];

    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = existing
        ? { date, domain, seconds: existing.seconds + seconds }
        : { date, domain, seconds };
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all domain stats for a specific date.
 * Returns an object: { domain: seconds, ... }
 */
export async function getDomainStatsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('domainStats', 'readonly');
    const store = tx.objectStore('domainStats');
    const index = store.index('byDate');
    const result = {};

    const request = index.openCursor(IDBKeyRange.only(date));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        result[cursor.value.domain] = cursor.value.seconds;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get domain stats for a date range (inclusive).
 * Returns: { date: { domain: seconds, ... }, ... }
 */
export async function getDomainStatsRange(startDate, endDate) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('domainStats', 'readonly');
    const store = tx.objectStore('domainStats');
    const index = store.index('byDate');
    const result = {};

    const range = IDBKeyRange.bound(startDate, endDate);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { date, domain, seconds } = cursor.value;
        if (!result[date]) result[date] = {};
        result[date][domain] = seconds;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get ALL domainStats as the legacy nested object: { date: { domain: seconds } }
 */
export async function getAllDomainStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('domainStats', 'readonly');
    const store = tx.objectStore('domainStats');
    const result = {};

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { date, domain, seconds } = cursor.value;
        if (!result[date]) result[date] = {};
        result[date][domain] = seconds;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// urlStats CRUD
// =============================================

/**
 * Increment duration for a URL on a given date, storing title and domain.
 */
export async function addUrlDuration(date, url, title, domain, duration) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('urlStats', 'readwrite');
    const store = tx.objectStore('urlStats');
    const key = [date, url];

    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = existing
        ? { date, url, title: title || existing.title, domain, duration: existing.duration + duration }
        : { date, url, title, domain, duration };
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all URL stats for a specific date.
 * Returns: { url: { title, domain, duration }, ... }
 */
export async function getUrlStatsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('urlStats', 'readonly');
    const store = tx.objectStore('urlStats');
    const index = store.index('byDate');
    const result = {};

    const request = index.openCursor(IDBKeyRange.only(date));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { url, title, domain, duration } = cursor.value;
        result[url] = { title, domain, duration };
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get ALL urlStats as the legacy nested object: { date: { url: {title, domain, duration} } }
 */
export async function getAllUrlStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('urlStats', 'readonly');
    const store = tx.objectStore('urlStats');
    const result = {};

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { date, url, title, domain, duration } = cursor.value;
        if (!result[date]) result[date] = {};
        result[date][url] = { title, domain, duration };
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// hourlyStats CRUD
// =============================================

/**
 * Add focus or distraction seconds to a specific date and hour.
 */
export async function addHourlySeconds(date, hour, focusDelta, distractionDelta) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('hourlyStats', 'readwrite');
    const store = tx.objectStore('hourlyStats');
    const key = [date, hour];

    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = existing
        ? { date, hour, focus: existing.focus + focusDelta, distraction: existing.distraction + distractionDelta }
        : { date, hour, focus: focusDelta, distraction: distractionDelta };
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all hourly stats for a specific date.
 * Returns: { hour: { focus, distraction }, ... }
 */
export async function getHourlyStatsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('hourlyStats', 'readonly');
    const store = tx.objectStore('hourlyStats');
    const index = store.index('byDate');
    const result = {};

    const request = index.openCursor(IDBKeyRange.only(date));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        result[cursor.value.hour] = { focus: cursor.value.focus, distraction: cursor.value.distraction };
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get ALL hourlyStats as the legacy nested object: { date: { hour: {focus, distraction} } }
 */
export async function getAllHourlyStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('hourlyStats', 'readonly');
    const store = tx.objectStore('hourlyStats');
    const result = {};

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { date, hour, focus, distraction } = cursor.value;
        if (!result[date]) result[date] = {};
        result[date][hour] = { focus, distraction };
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// tempFocusLog CRUD
// =============================================

/**
 * Increment temp focus seconds for a domain on a given date.
 */
export async function addTempFocusSeconds(date, domain, seconds) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tempFocusLog', 'readwrite');
    const store = tx.objectStore('tempFocusLog');
    const key = [date, domain];

    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const record = existing
        ? { date, domain, seconds: existing.seconds + seconds }
        : { date, domain, seconds };
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all temp focus log entries for a specific date.
 * Returns: { domain: seconds, ... }
 */
export async function getTempFocusLogByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tempFocusLog', 'readonly');
    const store = tx.objectStore('tempFocusLog');
    const index = store.index('byDate');
    const result = {};

    const request = index.openCursor(IDBKeyRange.only(date));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        result[cursor.value.domain] = cursor.value.seconds;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get ALL tempFocusLog as the legacy nested object: { date: { domain: seconds } }
 */
export async function getAllTempFocusLog() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tempFocusLog', 'readonly');
    const store = tx.objectStore('tempFocusLog');
    const result = {};

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { date, domain, seconds } = cursor.value;
        if (!result[date]) result[date] = {};
        result[date][domain] = seconds;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// Batch write (for migration & cloud pull)
// =============================================

/**
 * Import legacy nested objects into IndexedDB.
 * Expects the same shape as the old chrome.storage.local data:
 *   dailyStats:   { date: { domain: seconds } }
 *   dailyUrlStats: { date: { url: { title, domain, duration } } }
 *   hourlyStats:  { date: { hour: { focus, distraction } } }
 *   tempFocusLog: { date: { domain: seconds } }
 */
export async function importLegacyData({ dailyStats, dailyUrlStats, hourlyStats, tempFocusLog }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['domainStats', 'urlStats', 'hourlyStats', 'tempFocusLog'], 'readwrite');

    if (dailyStats) {
      const store = tx.objectStore('domainStats');
      Object.entries(dailyStats).forEach(([date, domains]) => {
        Object.entries(domains).forEach(([domain, seconds]) => {
          store.put({ date, domain, seconds });
        });
      });
    }

    if (dailyUrlStats) {
      const store = tx.objectStore('urlStats');
      Object.entries(dailyUrlStats).forEach(([date, urls]) => {
        Object.entries(urls).forEach(([url, data]) => {
          store.put({ date, url, title: data.title, domain: data.domain, duration: data.duration });
        });
      });
    }

    if (hourlyStats) {
      const store = tx.objectStore('hourlyStats');
      Object.entries(hourlyStats).forEach(([date, hours]) => {
        Object.entries(hours).forEach(([hour, data]) => {
          store.put({ date, hour: Number(hour), focus: data.focus || 0, distraction: data.distraction || 0 });
        });
      });
    }

    if (tempFocusLog) {
      const store = tx.objectStore('tempFocusLog');
      Object.entries(tempFocusLog).forEach(([date, domains]) => {
        Object.entries(domains).forEach(([domain, seconds]) => {
          store.put({ date, domain, seconds });
        });
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Export all IndexedDB data back to the legacy nested format (for cloud sync).
 */
export async function exportAllData() {
  const [dailyStats, dailyUrlStats, hourlyStats, tempFocusLog] = await Promise.all([
    getAllDomainStats(),
    getAllUrlStats(),
    getAllHourlyStats(),
    getAllTempFocusLog()
  ]);
  return { dailyStats, dailyUrlStats, hourlyStats, tempFocusLog };
}

/**
 * Clear all stores (used before importing fresh cloud data).
 */
export async function clearAllStores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['domainStats', 'urlStats', 'hourlyStats', 'tempFocusLog', 'focusSessions'], 'readwrite');
    tx.objectStore('domainStats').clear();
    tx.objectStore('urlStats').clear();
    tx.objectStore('hourlyStats').clear();
    tx.objectStore('tempFocusLog').clear();
    tx.objectStore('focusSessions').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// =============================================
// focusSessions CRUD
// =============================================

/**
 * Log a completed browsing session.
 * @param {string} date - YYYY-MM-DD
 * @param {string} domain
 * @param {number} startTime - Unix timestamp (ms) when this session started
 * @param {number} duration - seconds spent on this domain
 * @param {boolean} isFocus - true if this was a focus domain
 */
export async function addFocusSession(date, domain, startTime, duration, isFocus) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('focusSessions', 'readwrite');
    const store = tx.objectStore('focusSessions');
    store.add({ date, domain, startTime, duration, isFocus });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all focus sessions for a specific date.
 * Returns an array of { id, date, domain, startTime, duration, isFocus }
 */
export async function getSessionsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('focusSessions', 'readonly');
    const store = tx.objectStore('focusSessions');
    const index = store.index('byDate');
    const results = [];

    const request = index.openCursor(IDBKeyRange.only(date));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get focus sessions for a date range (inclusive).
 */
export async function getSessionsRange(startDate, endDate) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('focusSessions', 'readonly');
    const store = tx.objectStore('focusSessions');
    const index = store.index('byDate');
    const results = [];

    const range = IDBKeyRange.bound(startDate, endDate);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// Weighted Focus Score Algorithm
// =============================================

/**
 * Calculate a weighted focus score that rewards uninterrupted deep work.
 *
 * Algorithm:
 *   Each focus session contributes a weighted value based on its duration:
 *     - First 15 min: 1x multiplier (warming up)
 *     - 15–30 min:    1.25x (getting into flow)
 *     - 30–60 min:    1.5x  (deep work zone)
 *     - 60–90 min:    1.75x (sustained focus)
 *     - 90+ min:      2.0x  (peak deep work)
 *
 *   Example: A 60-min uninterrupted session earns:
 *     15×1.0 + 15×1.25 + 30×1.5 = 15 + 18.75 + 45 = 78.75 weighted minutes
 *     vs 4×15-min chunks: 4 × (15×1.0) = 60 weighted minutes
 *
 *   Score = weightedFocusSeconds / (weightedFocusSeconds + rawDistractionSeconds) × 100
 *
 * @param {Array} sessions - Array of { duration, isFocus } objects
 * @returns {{ score: number, weightedFocus: number, rawFocus: number, rawDistraction: number, longestStreak: number }}
 */
export function calculateWeightedScore(sessions) {
  let weightedFocus = 0;
  let rawFocus = 0;
  let rawDistraction = 0;
  let longestStreak = 0;

  for (const session of sessions) {
    if (session.isFocus) {
      rawFocus += session.duration;
      weightedFocus += getWeightedDuration(session.duration);
      if (session.duration > longestStreak) {
        longestStreak = session.duration;
      }
    } else {
      rawDistraction += session.duration;
    }
  }

  const total = weightedFocus + rawDistraction;
  const score = total > 0 ? Math.round((weightedFocus / total) * 100) : 0;

  return { score, weightedFocus, rawFocus, rawDistraction, longestStreak };
}

/**
 * Apply progressive multiplier to a session duration.
 * Longer uninterrupted sessions earn more weight per minute.
 *
 * Tiers:
 *   0–15 min   → 1.0x
 *   15–30 min  → 1.25x
 *   30–60 min  → 1.5x
 *   60–90 min  → 1.75x
 *   90+ min    → 2.0x
 */
function getWeightedDuration(durationSeconds) {
  const tiers = [
    { upTo: 15 * 60, multiplier: 1.0 },
    { upTo: 30 * 60, multiplier: 1.25 },
    { upTo: 60 * 60, multiplier: 1.5 },
    { upTo: 90 * 60, multiplier: 1.75 },
    { upTo: Infinity, multiplier: 2.0 }
  ];

  let remaining = durationSeconds;
  let weighted = 0;
  let prev = 0;

  for (const tier of tiers) {
    const tierSize = tier.upTo - prev;
    const inThisTier = Math.min(remaining, tierSize);
    weighted += inThisTier * tier.multiplier;
    remaining -= inThisTier;
    prev = tier.upTo;
    if (remaining <= 0) break;
  }

  return weighted;
}

/**
 * Simple focus score (fallback when no session data is available).
 * Used for backward compatibility.
 */
export function calculateSimpleScore(focusSeconds, distractionSeconds) {
  const total = focusSeconds + distractionSeconds;
  return total > 0 ? Math.round((focusSeconds / total) * 100) : 0;
}
