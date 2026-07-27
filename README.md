# 🎯 Hocus Focus

**Track focus domains and nudge you back when switching to distractions. Hocus Focus!**

A Chrome extension that helps you stay productive by monitoring your browsing habits, tracking time spent on focus vs. distraction sites, and gently nudging you back on track with smart notifications.

![Chrome Extension](https://img.shields.io/badge/Manifest-V3-blue) ![Version](https://img.shields.io/badge/version-3.0-green) ![License](https://img.shields.io/badge/license-ISC-yellow)

---

## ✨ Features

### 🔍 Focus Domain Tracking
- Add productive websites (e.g., `github.com`, `khanacademy.org`) as focus domains
- One-click "Add Current Website" button in the popup
- Manual domain entry with validation
- Tracks time spent on each focus domain in real-time
- Pauses tracking when idle or browser is minimized

### 🔔 Distraction Nudges
- Automatic notifications when you switch to a non-focus site
- Configurable cooldown (default 15 min) to avoid notification spam
- Toggle nudges on/off with one click
- Smart detection — only nudges during active browsing
- Graduated escalation — messages get firmer at 10, 20, 30+ minute marks

### 📊 Analysis Dashboard
- Daily, weekly, and monthly focus time breakdowns
- Focus vs. distraction ratio visualized as charts
- Per-domain time tracking with sortable tables
- Focus streaks and productivity scores
- Trend comparison (this week vs. last week)
- Powered by ApexCharts for smooth, interactive graphs

### ⏱️ Pomodoro Timer
- Customizable focus/break intervals
- Visual countdown with session counter
- Start, pause, and reset controls
- Auto-switches between focus and break modes
- Tracks total completed sessions per day
- Works even when popup is closed (background alarm)

### ✅ Task Manager
- Lightweight inline todo list in the popup
- Add, complete, and delete tasks
- Task completion counter (e.g., "3/5")
- Persists across popup open/close

### ⏳ Daily Allowances
- Set time limits for specific distraction sites
- Visual progress bar shows remaining time
- Countdown warnings at 5 min, 1 min, and 0 remaining
- Notification when allowance is used up
- Resets daily at midnight

### 🛡️ Temp Focus Pass
- Mark a distraction site as "focused" temporarily (15, 30, 60 min)
- Custom duration option
- Time under a pass counts as deep work, not distraction
- Visual countdown in the popup

### 📬 Weekly Summary Notifications
- Automatic on-screen notification every Sunday at 8 PM
- Shows total focus time, % change vs. last week, and focus score
- Optional email summaries (configure your email in the popup)

### 🌅 Custom New Tab
- Replaces Chrome's default new tab page
- Shows daily motivational quote
- Displays today's focus score with circular progress ring
- Top visited focus sites and streak counter
- Clean, minimal design matching extension theme

### 🌙 Dark Mode
- Toggle between light and dark themes
- Consistent dark theme across popup, new tab, and dashboard
- Remembers your preference

### ☁️ Cloud Sync
- Google Sign-In via Chrome Identity API
- Auto-backup on first sign-in
- Manual "Push to Cloud" / "Pull from Cloud" buttons
- Syncs focus domains, stats, tasks, and settings
- Data stored securely in Firebase Firestore

### 📧 Email Summaries
- Add your email in the popup to receive weekly focus reports
- Powered by EmailJS (no server required)
- Includes focus time, score, % change, and top site

### 🎓 Onboarding
- Guided first-time setup flow with color-coded feature cards
- Explains features step by step
- Helps add initial focus domains
- Pin extension tip included

---

## 🚀 Installation

### From Source (Developer Mode)

1. **Clone** the repo:
   ```bash
   git clone https://github.com/ArunimaAgrawal/study-extension.git
   cd study-extension
   ```
2. **Install** dependencies:
   ```bash
   npm install
   ```
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the project folder
6. Pin the extension icon in your toolbar — done!

### Running the tests

```bash
npm test
```

This loads the unpacked extension into a headless browser and drives the real
service worker, popup and pages over the DevTools protocol — no mocks. It covers
time tracking across service-worker restarts, the nudge overlay, popup actions,
and the weekly summary.

> Chrome 137+ ignores the `--load-extension` switch, so the suite looks for
> **Microsoft Edge** or **Chromium**. With only stock Chrome installed it skips
> rather than reporting a false pass.

### Rebuilding Firebase Bundle

Only needed if you modify `src/firebase-bundle-src.js`:
```bash
npx esbuild src/firebase-bundle-src.js --bundle --outfile=lib/firebase-bundle.js --format=iife --target=chrome100
```

---

## 📁 Project Structure

```
study-extension/
├── manifest.json              # MV3 config, permissions, OAuth2
├── background.js              # Service worker: time tracking, alarms, notifications
├── content.js                 # Injected into pages: idle detection, page context
├── popup/
│   ├── popup.html             # Main popup UI (domains, timer, tasks, sync, email)
│   └── popup.js               # Popup logic and event handlers
├── background/                # Modular background code (ES modules, future use)
│   ├── index.js               # Entry point
│   ├── tracking.js            # Tab time-tracking logic
│   ├── notifications.js       # Overlay/notification display
│   ├── stats.js               # Data persistence & summaries
│   ├── allowances.js          # Time limit enforcement
│   ├── pomodoro.js            # Timer completion
│   ├── migrations.js          # Versioned data migration system
│   └── utils.js               # Shared utilities
├── popup/modules/             # Modular popup code (ES modules, future use)
│   ├── domains.js             # Focus domain management
│   ├── allowances.js          # Allowance UI
│   ├── pomodoro.js            # Timer UI
│   ├── tasks.js               # Todo list
│   ├── temp-focus.js          # Temp focus pass
│   ├── sync.js                # Cloud sync (lazy-loads Firebase)
│   ├── email-notif.js         # Email notification settings
│   ├── settings.js            # Toggle & theme
│   └── utils.js               # Shared utilities
├── newtab.html / .js / .css   # Custom new tab override
├── onboarding.html / .js      # First-run onboarding flow
├── analysis/
│   ├── analysis.html / .css   # Full analytics dashboard page
│   ├── analysis.js            # Dashboard logic, chart rendering
│   └── apexcharts.min.js      # ApexCharts library (local)
├── firebase-config.js         # Firebase project credentials
├── firebase-client.js         # Auth helpers, Firestore CRUD, sync functions
├── email-config.js            # EmailJS setup instructions
├── lib/
│   ├── firebase-bundle.js     # Bundled Firebase SDK (IIFE, ~1.3MB)
│   ├── stats-db.js            # IndexedDB module (schema, CRUD, scoring)
│   └── stats-db-loader.js     # Compatibility bridge for non-module scripts
├── src/
│   └── firebase-bundle-src.js # Source for Firebase bundle (edit & rebuild)
├── icons/                     # Extension icons: 16, 32, 48, 128px
├── package.json               # npm config and dependencies
└── README.md                  # You are here
```

---

## 🔑 Permissions

| Permission | Why it's needed |
|-----------|-----------------|
| `tabs` | Track which website is active for focus monitoring |
| `storage` | Save domains, stats, tasks, settings locally |
| `idle` | Pause tracking when user is away |
| `notifications` | Send "get back on track" reminders |
| `scripting` | Inject content scripts into web pages |
| `alarms` | Schedule periodic focus check-ins & weekly summaries |
| `identity` | Google Sign-In for cloud sync |

---

## ☁️ Cloud Sync Setup

### Browser Compatibility

| Browser | Sign-In Support |
|---------|----------------|
| Chrome | Works out of the box |
| Edge | Works out of the box |
| Brave | Works, but you need to enable Google Sign-In in `brave://settings/extensions` |
| Firefox | Not supported |
| Safari | Not supported |

> **Note:** Google Sign-In uses the `chrome.identity` API which is only available in Chromium-based browsers.

### For Users
1. Click the extension popup → scroll to bottom
2. Click **"Sign in with Google to Sync"**
3. First sign-in auto-backs up your data
4. Use Push / Pull buttons anytime for manual sync

### For Developers (Your Own Firebase)
1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Google sign-in provider
3. Enable **Cloud Firestore** → start in test mode
4. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
5. Create OAuth 2.0 Client ID → type: **Chrome Extension**
6. Set Application ID = your extension ID (from `chrome://extensions`)
7. Update:
   - `firebase-config.js` → your Firebase project config
   - `manifest.json` → `oauth2.client_id` field

---

## 📧 Email Summaries Setup

### For Users
1. Open the popup → scroll to "Email Summaries"
2. Enter your email → click Save
3. You'll receive weekly focus reports every Sunday evening

### For Developers (EmailJS Config)
1. Create a free account at [emailjs.com](https://www.emailjs.com) (200 emails/month free)
2. Add an email service (Gmail, Outlook, etc.)
3. Create a template with variables: `{{to_email}}`, `{{focus_time}}`, `{{change}}`, `{{score}}`, `{{top_site}}`
4. Run in the extension's background console:
   ```js
   chrome.storage.local.set({ emailjsConfig: {
     serviceId: 'your_service_id',
     templateId: 'your_template_id',
     publicKey: 'your_public_key'
   }});
   ```

---

## 🛠️ Tech Stack

| Technology | Role |
|-----------|------|
| Chrome Extension MV3 | Platform |
| Vanilla JavaScript | UI & logic — zero frameworks |
| Firebase Auth | Google Sign-In |
| Cloud Firestore | Cloud data storage & sync |
| IndexedDB | High-performance local time-tracking storage |
| ApexCharts | Interactive dashboard charts |
| EmailJS | Serverless email notifications |
| esbuild | Bundle Firebase SDK for extension |

---

## 🧪 How It Works

1. **Background service worker** (`background.js`) listens for tab switches and tracks active time per domain
2. **Content script** (`content.js`) monitors page-level activity and idle state
3. **Popup** provides quick access to manage domains, run the Pomodoro timer, manage tasks, and configure sync/email
4. **Alarms** fire periodically to check focus state, send nudge notifications, and trigger weekly summaries
5. **Cloud sync** uses `chrome.identity` for OAuth → Firebase Auth → Firestore read/write
6. **Data migration system** (`background/migrations.js`) versions the storage schema to safely upgrade user data across updates

---

## 🏗️ Architecture Notes

The codebase includes a **modular ES module version** of the background worker and popup (`background/` and `popup/modules/` directories). These are prepared for a future migration to fully modular architecture but are not active in the current build — the extension runs on the monolithic `background.js` and `popup/popup.js` for maximum compatibility.

Key architectural components available for future use:
- **IndexedDB layer** (`lib/stats-db.js`) — structured storage with compound indexes for efficient date-range queries
- **Versioned migrations** (`background/migrations.js`) — sequential, idempotent data migrations
- **Lazy Firebase loading** (`popup/modules/sync.js`) — loads 1.3MB Firebase bundle only when user triggers sync
- **Weighted focus scoring** (`lib/stats-db.js`) — rewards uninterrupted deep work over fragmented sessions

---

## 🤝 Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes and commit: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

### Ideas for Contributions
- Activate the ES module architecture (needs Chrome 116+)
- Browser support for Firefox/Edge
- Focus music integration
- Website blocking mode (soft/hard)
- Import/export data as JSON
- Focus mode scheduling (auto-enable during work hours)
- Keyboard shortcuts

---

## 📄 License

ISC

---

Made with 💚 by [Arunima Agrawal](https://github.com/ArunimaAgrawal)
