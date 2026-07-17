// Popup main entry point (ES module)

import { initDomains } from './modules/domains.js';
import { initAllowances } from './modules/allowances.js';
import { initPomodoro } from './modules/pomodoro.js';
import { initTasks } from './modules/tasks.js';
import { initTempFocus } from './modules/temp-focus.js';
import { initSync } from './modules/sync.js';
import { initSettings } from './modules/settings.js';

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
  initSync();
});
