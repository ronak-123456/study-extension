# 🎯 Hocus Focus

**Track focus domains and nudge you back when switching to distractions. Hocus Focus!**

A Chrome extension that helps you stay productive by monitoring your browsing habits, tracking time spent on focus vs. distraction sites, and gently reminding you to get back on track.

![Chrome Extension](https://img.shields.io/badge/Manifest-V3-blue) ![Version](https://img.shields.io/badge/version-3.0-green)

## ✨ Features

- **Focus Domain Tracking** — Add productive websites as your "focus domains" and track time spent on them
- **Distraction Nudges** — Get notifications when you switch to non-focus sites, reminding you to get back on track
- **Analysis Dashboard** — Visualize your browsing habits with detailed charts and statistics (powered by ApexCharts)
- **Pomodoro Timer** — Built-in focus/break timer with session tracking
- **Task Manager** — Simple todo list to keep track of what you need to accomplish
- **Daily Allowances** — Set time limits for distraction sites
- **Custom New Tab** — Motivational new tab page with top sites and focus stats
- **Dark Mode** — Easy on the eyes, toggle between light and dark themes
- **Cloud Sync** — Sign in with Google to backup and sync your data across devices (Firebase)
- **Onboarding Flow** — Guided setup for new users

## 🚀 Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/ArunimaAgrawal/study-extension.git
   ```

2. Install dependencies (needed to rebuild the Firebase bundle):
   ```bash
   npm install
   ```

3. Open Chrome and navigate to `chrome://extensions`

4. Enable **Developer mode** (top right toggle)

5. Click **Load unpacked** and select the project folder

6. The extension is now active! Click the icon in your toolbar to get started.

### Rebuilding Firebase Bundle

If you modify Firebase dependencies:
```bash
npx esbuild src/firebase-bundle-src.js --bundle --outfile=lib/firebase-bundle.js --format=iife --target=chrome100
```

## 📁 Project Structure

```
hocus-focus/
├── manifest.json            # Extension configuration (MV3)
├── background.js            # Service worker — tracking, alarms, notifications
├── content.js               # Content script — injected into all pages
├── popup/
│   ├── popup.html           # Extension popup UI
│   └── popup.js             # Popup logic (domains, timer, tasks, sync)
├── newtab.html/js/css       # Custom new tab page
├── onboarding.html/js       # First-time user onboarding
├── analysis/
│   ├── analysis.html/css/js # Full analytics dashboard
│   └── apexcharts.min.js    # Charting library
├── firebase-config.js       # Firebase project credentials
├── firebase-client.js       # Firebase auth & Firestore helpers
├── lib/
│   └── firebase-bundle.js   # Bundled Firebase SDK (IIFE)
├── src/
│   └── firebase-bundle-src.js  # Firebase bundle source (for rebuilding)
├── icons/                   # Extension icons (16, 32, 48, 128px)
└── package.json             # npm dependencies
```

## 🔑 Permissions

| Permission | Purpose |
|-----------|---------|
| `tabs` | Monitor active tab for focus tracking |
| `storage` | Persist focus domains, settings, and session data |
| `idle` | Detect when user is away from computer |
| `notifications` | Send distraction reminder notifications |
| `scripting` | Inject content scripts for page-level features |
| `alarms` | Schedule periodic focus check-ins |
| `identity` | Google Sign-In for cloud sync |

## ☁️ Cloud Sync Setup

The extension uses Firebase for cloud backup/sync:

1. Sign in with Google from the popup (bottom section)
2. On first sign-in, your local data is automatically backed up
3. Use **Push to Cloud** / **Pull from Cloud** buttons for manual sync
4. Data is stored in Firestore under `users/{uid}`

### Firebase Configuration

To use your own Firebase project:
1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Google provider
3. Enable **Cloud Firestore**
4. Create an OAuth 2.0 Client ID (type: **Chrome Extension**) in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
5. Set the Application ID to your extension's ID (from `chrome://extensions`)
6. Update `firebase-config.js` and the `oauth2.client_id` in `manifest.json`

## 🛠️ Tech Stack

- **Chrome Extension Manifest V3**
- **Vanilla JavaScript** — No framework, fast and lightweight
- **Firebase** — Auth (Google Sign-In) + Firestore (cloud sync)
- **ApexCharts** — Analytics visualizations
- **esbuild** — Bundling Firebase SDK for extension use

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## 📄 License

ISC

---

Made with 💚 by [Arunima Agrawal](https://github.com/ArunimaAgrawal)
