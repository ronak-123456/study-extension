// Local calendar date as YYYY-MM-DD (matches the keys written by background.js).
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const today = localDateStr();

// Greeting based on time of day
function setGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else greeting = 'Good evening';
  document.getElementById('greeting').textContent = greeting;
}

// Format time
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Calculate streak
function calculateStreak(stats, studyDomains) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const dayStats = stats[dateStr] || {};
    let focusSec = 0;
    Object.entries(dayStats).forEach(([domain, seconds]) => {
      if (studyDomains.some(sd => domain === sd || domain.endsWith('.' + sd))) {
        focusSec += seconds;
      }
    });
    if (focusSec >= 600) streak++;
    else break;
  }
  return streak;
}

// Load and display stats
chrome.storage.local.get(['dailyStats', 'studyDomains', 'customNudges', 'allowances', 'tempFocusLog', 'tempFocusPasses'], (data) => {
  const stats = data.dailyStats || {};
  const studyDomains = data.studyDomains || [];
  const allowances = data.allowances || {};
  const tempFocusLog = data.tempFocusLog || {};
  const tempFocusPasses = data.tempFocusPasses || {};
  const todayStats = stats[today] || {};
  const todayTempFocus = tempFocusLog[today] || {};

  let focusSeconds = 0;
  let distractionSeconds = 0;
  let sites = new Set();
  const domainTimes = [];

  Object.entries(todayStats).forEach(([domain, seconds]) => {
    const isStudy = studyDomains.some(d => domain === d || domain.endsWith('.' + d));
    let tempFocusSeconds = todayTempFocus[domain] || 0;

    // Check if there's a currently active pass for this domain
    if (!isStudy && tempFocusSeconds === 0) {
      const hasActivePass = Object.entries(tempFocusPasses).find(([d, p]) =>
        (domain === d || domain.endsWith('.' + d)) && p.expiresAt > Date.now()
      );
      if (hasActivePass) {
        tempFocusSeconds = seconds;
      }
    }

    if (isStudy) {
      focusSeconds += seconds;
    } else if (tempFocusSeconds > 0) {
      focusSeconds += Math.min(tempFocusSeconds, seconds);
      const remaining = seconds - Math.min(tempFocusSeconds, seconds);
      if (remaining > 0) {
        const matchedAllowance = Object.keys(allowances).find(d =>
          domain === d || domain.endsWith('.' + d)
        );
        if (matchedAllowance) {
          const limitSeconds = allowances[matchedAllowance].limitSeconds || 0;
          if (remaining > limitSeconds) {
            distractionSeconds += (remaining - limitSeconds);
          }
        } else {
          distractionSeconds += remaining;
        }
      }
    } else {
      const matchedAllowance = Object.keys(allowances).find(d =>
        domain === d || domain.endsWith('.' + d)
      );
      if (matchedAllowance) {
        const limitSeconds = allowances[matchedAllowance].limitSeconds || 0;
        if (seconds > limitSeconds) {
          distractionSeconds += (seconds - limitSeconds);
        }
      } else {
        distractionSeconds += seconds;
      }
    }
    sites.add(domain);
    domainTimes.push({ domain, seconds, isStudy: isStudy || tempFocusSeconds > 0 });
  });

  const total = focusSeconds + distractionSeconds;
  const score = total > 0 ? Math.round((focusSeconds / total) * 100) : 0;

  // Score
  document.getElementById('scoreValue').textContent = score;
  const circumference = 2 * Math.PI * 52; // 326.73
  const offset = circumference - (score / 100) * circumference;
  document.getElementById('scoreFill').style.strokeDashoffset = offset;

  // Color the score based on value
  const fill = document.getElementById('scoreFill');
  if (score >= 70) fill.style.stroke = '#2dd4bf';
  else if (score >= 40) fill.style.stroke = '#fbbf24';
  else fill.style.stroke = '#f87171';

  // Stats
  document.getElementById('focusTime').textContent = formatTime(focusSeconds);
  document.getElementById('distractTime').textContent = formatTime(distractionSeconds);
  document.getElementById('sitesCount').textContent = sites.size;

  // Streak
  const streak = calculateStreak(stats, studyDomains);
  document.getElementById('streakCount').textContent = streak;

  // Top sites (top 3)
  const topSitesEl = document.getElementById('topSites');
  const sorted = domainTimes.sort((a, b) => b.seconds - a.seconds).slice(0, 3);
  if (sorted.length > 0) {
    sorted.forEach(({ domain, seconds, isStudy }) => {
      const item = document.createElement('div');
      item.className = `newtab-site-item ${!isStudy ? 'newtab-site-distract' : ''}`;
      item.innerHTML = `
        <span class="newtab-site-name">${domain.replace('www.', '')}</span>
        <span class="newtab-site-time">${formatTime(seconds)}</span>
      `;
      topSitesEl.appendChild(item);
    });
  }

  // Motivation quote
  const defaultQuotes = [
    'Stay focused. Stay sharp.',
    'Small progress is still progress.',
    'Your future self will thank you.',
    'One task at a time.',
    'Discipline is choosing what you want most over what you want now.'
  ];
  const customNudges = data.customNudges || [];
  const allQuotes = customNudges.length > 0 ? [...customNudges, ...defaultQuotes] : defaultQuotes;
  const quote = allQuotes[Math.floor(Math.random() * allQuotes.length)];
  document.getElementById('motivationQuote').textContent = `"${quote}"`;
});

// Dashboard link
document.getElementById('dashboardLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.update({ url: chrome.runtime.getURL('analysis/analysis.html') });
});

setGreeting();
