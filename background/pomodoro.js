// Pomodoro timer — background completion logic

/**
 * Fire the Pomodoro completion (session count + notification) from the
 * background so it happens on time regardless of whether the popup is open.
 */
export function completePomodoro() {
  chrome.storage.local.get({ pomoState: null, pomoSessions: 0 }, (data) => {
    const mode = data.pomoState ? data.pomoState.mode : 'focus';
    chrome.storage.local.set({ pomoState: null });
    if (mode === 'focus') {
      chrome.storage.local.set({ pomoSessions: data.pomoSessions + 1 });
      chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Pomodoro Complete!', message: 'Great work! Take a break.', priority: 2
      });
    } else {
      chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Break Over!', message: 'Time to focus again.', priority: 2
      });
    }
  });
}
