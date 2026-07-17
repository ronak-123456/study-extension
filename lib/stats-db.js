/**
 * lib/stats-db.js — Shared IndexedDB module for time-tracking data.
 *
 * Works in both the background service worker and page contexts (popup,
 * newtab, analysis). All functions return Promises.
 *
 * Stores:
 *   domainStats  — key: [date, domain]        → { seconds }
 *   urlStats     — key: [date, url]           → { title, domain, duration }
 *   hourlyStats  — key: [date, hour]          → { focus, distraction }
 *   tempFocusLog — key: [date, domain]        → { seconds }
 *
 * Indexes allow efficient date-range queries (e.g. all stats for a week).
 */

const DB_NAME = 'HocusFocusStats';
const DB_VERSION = 1;

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
    const tx = db.transaction(['domainStats', 'urlStats', 'hourlyStats', 'tempFocusLog'], 'readwrite');
    tx.objectStore('domainStats').clear();
    tx.objectStore('urlStats').clear();
    tx.objectStore('hourlyStats').clear();
    tx.objectStore('tempFocusLog').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
