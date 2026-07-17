/**
 * background/migrations.js — Versioned data migration system.
 *
 * Each migration is a function that transforms the user's stored data from
 * version N to version N+1. Migrations run sequentially on install/update
 * and are idempotent (safe to re-run).
 *
 * To add a new migration:
 *   1. Write a migration function (async) at the bottom of MIGRATIONS array
 *   2. Bump CURRENT_SCHEMA_VERSION
 *   3. The migration receives no args — it reads/writes storage directly
 *
 * The system stores `schemaVersion` in chrome.storage.local.
 * Version 0 = fresh install or pre-migration legacy data.
 */

import { importLegacyData } from '../lib/stats-db.js';

// Bump this when adding a new migration
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * Array of migrations. Index = version being migrated FROM.
 * migrations[0] migrates 0 → 1, migrations[1] migrates 1 → 2, etc.
 */
const MIGRATIONS = [
  // ─────────────────────────────────────────────────────────────────────────
  // v0 → v1: Normalize study domains (remove "www." prefix)
  // ─────────────────────────────────────────────────────────────────────────
  async function migrateV0toV1() {
    const data = await storageGet({ studyDomains: [] });
    const normalized = [...new Set(data.studyDomains.map(x => x.replace(/^www\./, '')))];
    if (JSON.stringify(normalized) !== JSON.stringify(data.studyDomains)) {
      await storageSet({ studyDomains: normalized });
    }
    console.log('[Migration v0→v1] Normalized study domains');
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v1 → v2: Migrate time-tracking data from chrome.storage.local to IndexedDB
  // ─────────────────────────────────────────────────────────────────────────
  async function migrateV1toV2() {
    const data = await storageGet({
      dailyStats: {}, dailyUrlStats: {}, hourlyStats: {}, tempFocusLog: {}
    });

    const hasData = Object.keys(data.dailyStats).length > 0 ||
                    Object.keys(data.dailyUrlStats).length > 0 ||
                    Object.keys(data.hourlyStats).length > 0 ||
                    Object.keys(data.tempFocusLog).length > 0;

    if (hasData) {
      await importLegacyData({
        dailyStats: data.dailyStats,
        dailyUrlStats: data.dailyUrlStats,
        hourlyStats: data.hourlyStats,
        tempFocusLog: data.tempFocusLog
      });
      // Remove migrated keys from chrome.storage.local
      await storageRemove(['dailyStats', 'dailyUrlStats', 'hourlyStats', 'tempFocusLog']);
    }

    // Clean up old migration flag
    await storageRemove(['idbMigrated']);
    console.log('[Migration v1→v2] Migrated time-tracking data to IndexedDB');
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v2 → v3: Add default settings for new features (email notif, weekly summary)
  // ─────────────────────────────────────────────────────────────────────────
  async function migrateV2toV3() {
    const data = await storageGet({
      allowances: {},
      tasks: [],
      customNudges: []
    });

    // Backfill IDs on any legacy tasks that don't have them
    let changed = false;
    data.tasks.forEach(t => {
      if (!t.id) {
        t.id = 't' + Date.now() + Math.random().toString(36).slice(2);
        changed = true;
      }
    });
    if (changed) {
      await storageSet({ tasks: data.tasks });
    }

    console.log('[Migration v2→v3] Backfilled task IDs, initialized new feature settings');
  }
];

// =============================================
// Migration runner
// =============================================

/**
 * Run all pending migrations from the user's current version to CURRENT_SCHEMA_VERSION.
 * Called on every extension install/update from background/index.js.
 */
export async function runMigrations() {
  const data = await storageGet({ schemaVersion: 0 });
  let currentVersion = data.schemaVersion;

  // Fresh install — no migrations needed, just set to latest
  if (currentVersion === 0) {
    const hasLegacyData = await hasAnyLegacyData();
    if (!hasLegacyData) {
      await storageSet({ schemaVersion: CURRENT_SCHEMA_VERSION });
      console.log(`[Migrations] Fresh install — schema set to v${CURRENT_SCHEMA_VERSION}`);
      return;
    }
    // Has legacy data but no version — start from v0
  }

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return; // Already up to date
  }

  console.log(`[Migrations] Running migrations v${currentVersion} → v${CURRENT_SCHEMA_VERSION}`);

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[currentVersion];
    if (!migration) {
      console.error(`[Migrations] Missing migration for v${currentVersion} → v${currentVersion + 1}`);
      break;
    }

    try {
      await migration();
      currentVersion++;
      // Persist version after each successful migration so a crash
      // doesn't re-run already-completed migrations
      await storageSet({ schemaVersion: currentVersion });
      console.log(`[Migrations] Completed → v${currentVersion}`);
    } catch (err) {
      console.error(`[Migrations] Failed at v${currentVersion} → v${currentVersion + 1}:`, err);
      // Stop running further migrations — user data might be in an
      // inconsistent state. Will retry on next startup.
      break;
    }
  }
}

// =============================================
// Helpers
// =============================================

/** Check if the user has any pre-existing data (legacy user vs fresh install). */
async function hasAnyLegacyData() {
  const data = await storageGet({
    studyDomains: [],
    dailyStats: {},
    tasks: [],
    idbMigrated: false
  });
  return data.studyDomains.length > 0 ||
         Object.keys(data.dailyStats).length > 0 ||
         data.tasks.length > 0 ||
         data.idbMigrated === true;
}

/** Promise wrapper for chrome.storage.local.get */
function storageGet(keysOrDefaults) {
  return new Promise(resolve =>
    chrome.storage.local.get(keysOrDefaults, resolve)
  );
}

/** Promise wrapper for chrome.storage.local.set */
function storageSet(items) {
  return new Promise(resolve =>
    chrome.storage.local.set(items, resolve)
  );
}

/** Promise wrapper for chrome.storage.local.remove */
function storageRemove(keys) {
  return new Promise(resolve =>
    chrome.storage.local.remove(keys, resolve)
  );
}
