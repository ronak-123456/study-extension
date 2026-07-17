// Notification and overlay display logic

import { formatTimeShort } from './utils.js';

/**
 * Show an in-page overlay on the active tab. Only if the overlay can't be
 * injected (e.g. a page where content scripts can't run) do we fall back to a
 * system notification — this avoids alerting the user twice for one event.
 */
export function showOverlayOrNotify(tabId, overlayPayload, systemNotif) {
  if (!tabId) {
    chrome.notifications.create(systemNotif);
    return;
  }
  chrome.tabs.sendMessage(tabId, overlayPayload).catch(() => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      .then(() => chrome.tabs.sendMessage(tabId, overlayPayload)
        .catch(() => chrome.notifications.create(systemNotif)))
      .catch(() => chrome.notifications.create(systemNotif));
  });
}

export function triggerFocusNotification(tabId, currentDomain) {
  chrome.storage.local.get({ customNudges: [] }, (data) => {
    const defaultMessages = [
      `You wandered onto ${currentDomain}. Your work notes miss you.`,
      `${currentDomain}? Really? Your tasks are crying.`,
      `Plot twist: ${currentDomain} won't help you finish that deadline.`
    ];

    const allMessages = data.customNudges.length > 0
      ? [...data.customNudges, ...defaultMessages]
      : defaultMessages;
    const message = allMessages[Math.floor(Math.random() * allMessages.length)];

    showOverlayOrNotify(
      tabId,
      { action: 'showFocusNudge', domain: currentDomain, customMessage: message },
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🫣 Caught You!',
        message,
        priority: 1
      }
    );
  });
}

// Witty distraction messages — escalate with time
const DISTRACTION_MESSAGES = {
  10: [
    "10 minutes gone. That's a whole pomodoro warm-up wasted here",
    "You've been here 10 min. Your future self is side-eyeing you.",
    "10 minutes of pure procrastination. Impressive commitment, honestly.",
  ],
  20: [
    "20 minutes?! At this point, list it as a hobby on your resume.",
    "Still here after 20 min? This site should pay you rent.",
    "20 minutes. That's almost enough time to learn something useful. Almost.",
  ],
  30: [
    "30 minutes. Half an hour. Gone. Poof. Like your productivity.",
    "You've officially spent more time here than on actual work. Ouch.",
    "30 min! If procrastination was a sport, you'd be going pro.",
  ],
  40: [
    "40 minutes. At this rate, your to-do list is writing its resignation letter.",
    "Still going? Your tasks filed a missing person report.",
    "40 min of distraction. That's a whole episode of a show. You could've at least been entertained.",
  ],
  50: [
    "50 minutes. Genuinely asking — did you forget you had work?",
    "Almost an hour! Your focus goals called, they want a divorce.",
    "50 min deep. At this point I'm not judging, I'm worried.",
  ],
  60: [
    "ONE HOUR. This is an intervention. Please close this tab.",
    "60 minutes of distraction. That's it. I'm calling your mom.",
    "An entire hour gone. You could've learned a new skill by now. Just sayin'.",
  ]
};

function getDistractionMessage(minutes) {
  const tier = Math.min(Math.floor(minutes / 10) * 10, 60);
  const msgs = DISTRACTION_MESSAGES[tier] || DISTRACTION_MESSAGES[60];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

export function sendGraduatedDistraction(tabId, domain, minutes) {
  const message = getDistractionMessage(minutes);
  const severity = minutes >= 30 ? 'high' : minutes >= 20 ? 'medium' : 'low';

  showOverlayOrNotify(
    tabId,
    { action: 'showDistractionBlock', domain, minutes, message, severity },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: minutes >= 30 ? '🚨 Time Check!' : '⏰ Still Here?',
      message,
      priority: minutes >= 30 ? 2 : 1
    }
  );
}

// Study encouragement messages
const STUDY_MESSAGES = {
  30: [
    "30 minutes of focus! You're in the zone!",
    "Half an hour of deep work — that's a full pomodoro! Keep going!",
    "30 min locked in. Your brain cells are doing a happy dance.",
  ],
  60: [
    "ONE HOUR of focus! 🎉 You're absolutely crushing it!",
    "60 minutes deep — you're built different. Seriously.",
    "A full hour of deep work! Future you is so grateful right now.",
  ],
  90: [
    "90 minutes! That's elite-level focus. Take a 5-min stretch? 🧘",
    "1.5 hours of pure productivity. You're on fire! 🔥",
    "90 min focused — you've outworked 90% of people today.",
  ],
  120: [
    "TWO HOURS! 🏆 You've entered scholar mode. Legend.",
    "120 minutes of focus. That's dedication. That's power.",
    "2 hours in! Maybe take a break? You've earned it, champ.",
  ],
  180: [
    "THREE HOURS?! 🤯 You're not human. Take a break, superhero!",
    "180 minutes. At this point you deserve a PhD just for sitting here.",
    "3 hours focused! Please drink water. Please.",
  ]
};

export function sendStudyEncouragement(tabId, domain, minutes) {
  const msgs = STUDY_MESSAGES[minutes] || STUDY_MESSAGES[60];
  const message = msgs[Math.floor(Math.random() * msgs.length)];

  showOverlayOrNotify(
    tabId,
    { action: 'showStudyEncouragement', domain, minutes, message },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: '🌟 Great Work!',
      message,
      priority: 1
    }
  );
}

export function sendAllowanceNotification(tabId, domain, remainingSeconds, limitSeconds, level) {
  const limitStr = formatTimeShort(limitSeconds);
  let title, message;

  if (level === 'exceeded') {
    const overMessages = [
      `Your ${limitStr} allowance for ${domain} is used up! Time to leave.`,
      `That's it — ${limitStr} of ${domain} used today. Willpower time! 💪`,
      `${domain} time: OVER. Your future self thanks you for closing this.`
    ];
    title = '🚫 Allowance Exceeded!';
    message = overMessages[Math.floor(Math.random() * overMessages.length)];
  } else if (level === 'critical') {
    title = '⏰ Less Than 1 Minute Left!';
    message = `${remainingSeconds}s remaining on ${domain}. Wrap up now!`;
  } else {
    const mins = Math.ceil(remainingSeconds / 60);
    title = '⏱️ Allowance Running Low';
    message = `${mins} minute${mins > 1 ? 's' : ''} left of your daily ${limitStr} on ${domain}.`;
  }

  showOverlayOrNotify(
    tabId,
    { action: 'showAllowanceCountdown', domain, remainingSeconds, limitSeconds, level },
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: level === 'exceeded' ? 2 : 1
    }
  );
}
