// Popup main entry point (ES module)

import { initDomains } from './modules/domains.js';
import { initAllowances } from './modules/allowances.js';
import { initPomodoro } from './modules/pomodoro.js';
import { initTasks } from './modules/tasks.js';
import { initTempFocus } from './modules/temp-focus.js';
import { initSync } from './modules/sync.js';
import { initSettings } from './modules/settings.js';
import { initEmailNotif } from './modules/email-notif.js';
import {
  getAllDomainStats,
  getAllUrlStats,
  getAllHourlyStats,
  getAllTempFocusLog,
  clearAllStores,
  importLegacyData
} from '../lib/stats-db.js';

// Expose IDB functions globally so firebase-client.js (loaded as a classic
// script for sync) can include IndexedDB data in push/pull operations.
window._statsDB = {
  getAllDomainStats,
  getAllUrlStats,
  getAllHourlyStats,
  getAllTempFocusLog,
  clearAllStores,
  importLegacyData
};

// Let the background worker know the popup is open, so it won't treat the
// focus-loss from opening this popup as "left the browser" and reset tracking.
try { chrome.runtime.connect({ name: 'hocus-popup' }); } catch (e) { }

document.addEventListener('DOMContentLoaded', () => {
  initSettings();
  initDomains();
  initAllowances();
  initPomodoro();
  initTempFocus();
  initTasks();
  initEmailNotif();
  initSync();
});
