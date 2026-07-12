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

### 📊 Analysis Dashboard
- Daily, weekly, and monthly focus time breakdowns
- Focus vs. distraction ratio visualized as charts
- Per-domain time tracking with sortable tables
- Focus streaks and productivity scores
- Powered by ApexCharts for smooth, interactive graphs

### ⏱️ Pomodoro Timer
- Customizable focus/break intervals
- Visual countdown with session counter
- Start, pause, and reset controls
- Auto-switches between focus and break modes
- Tracks total completed sessions per day

### ✅ Task Manager
- Lightweight inline todo list in the popup
- Add, complete, and delete tasks
- Task completion counter (e.g., "3/5")
- Persists across popup open/close

### ⏳ Daily Allowances
- Set time limits for specific distraction sites
- Visual progress bar shows remaining time
- Notification when allowance is used up
- Resets daily at midnight

### 🌅 Custom New Tab
- Replaces Chrome's default new tab page
- Shows daily motivational quote
- Displays top visited focus sites
- Quick link to the full analysis dashboard
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

### 🎓 Onboarding
- Guided first-time setup flow
- Explains features step by step
- Helps add initial focus domains

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
│   ├── popup.html             # Main popup UI (domains, timer, tasks, sync)
│   └── popup.js               # Popup logic and event handlers
├── newtab.html / .js / .css   # Custom new tab override
├── onboarding.html / .js      # First-run onboarding flow
├── analysis/
│   ├── analysis.html / .css   # Full analytics dashboard page
│   ├── analysis.js            # Dashboard logic, chart rendering
│   └── apexcharts.min.js      # ApexCharts library (local)
├── firebase-config.js         # Firebase project credentials
├── firebase-client.js         # Auth helpers, Firestore CRUD, sync functions
├── lib/
│   └── firebase-bundle.js     # Bundled Firebase SDK (IIFE, ~1.3MB)
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
| `alarms` | Schedule periodic focus check-ins |
| `identity` | Google Sign-In for cloud sync |

---

## ☁️ Cloud Sync Setup

### For Users
1. Click the extension popup → scroll to bottom
2. Click **"Sign in with Google to Sync"**
3. First sign-in auto-backs up your data
4. Use ⬆️ Push / ⬇️ Pull buttons anytime for manual sync

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

## 🛠️ Tech Stack

| Technology | Role |
|-----------|------|
| Chrome Extension MV3 | Platform |
| Vanilla JavaScript | UI & logic — zero frameworks |
| Firebase Auth | Google Sign-In |
| Cloud Firestore | Cloud data storage & sync |
| ApexCharts | Interactive dashboard charts |
| esbuild | Bundle Firebase SDK for extension |

---

## 🧪 How It Works

1. **Background service worker** (`background.js`) listens for tab switches and tracks active time per domain
2. **Content script** (`content.js`) monitors page-level activity and idle state
3. **Popup** provides quick access to manage domains, run the Pomodoro timer, and manage tasks
4. **Alarms** fire periodically to check focus state and send nudge notifications
5. **Cloud sync** uses `chrome.identity` for OAuth → Firebase Auth → Firestore read/write

---

## 🤝 Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes and commit: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

### Ideas for Contributions
- Browser support for Firefox/Edge
- Weekly email summary reports
- Focus music integration
- Website blocking mode
- Import/export data as JSON

---

## 📄 License

ISC

---

Made with 💚 by [Arunima Agrawal](https://github.com/ArunimaAgrawal)
