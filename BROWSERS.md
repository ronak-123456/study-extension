# Browser Support

Hocus Focus is built as a Manifest V3 extension. Here's exactly what works
where, and how to load it on each browser.

| Browser | Core features (tracking, nudges, Pomodoro, tasks) | Google sign-in / cloud sync | Notes |
|---|---|---|---|
| Chrome | ✅ | ✅ | Primary target |
| Edge | ✅ | ✅ | Tested |
| Brave | ✅ | ✅* | *Enable one Brave setting (below) |
| Opera / Vivaldi | ✅ | ✅ | Same build as Chrome |
| Firefox | ✅ | ⚠️ per-install setup | Uses `manifest.firefox.json` (below) |
| Tor Browser | ❌ | ❌ | Unsupported (below) |
| Safari | ⚠️ requires conversion | untested | Needs Xcode conversion (below) |

---

## Chromium family — Chrome, Edge, Brave, Opera, Vivaldi

All of these run the extension **as-is** with the same folder:

1. Go to the extensions page (`chrome://extensions`, `edge://extensions`,
   `brave://extensions`, `opera://extensions`, `vivaldi://extensions`).
2. Enable **Developer mode** → **Load unpacked** → select this folder.
3. Confirm the extension ID reads `ffnbfmcfccmgegeohffklhodfnmdjlpe` — it's
   pinned by the `key` in `manifest.json`, so Google sign-in works with the
   already-registered redirect URI on every Chromium browser.

**Brave only:** for Google sign-in to work, enable
`brave://settings/extensions` → **"Allow Google login for extensions"**.
Brave Shields can also block the in-page nudge overlays on some sites; the
system-notification fallback still fires.

## Firefox

Firefox can't read the Chromium manifest's `service_worker`/`key` fields, so a
Firefox-specific manifest is provided: **`manifest.firefox.json`**.

**Load it (temporary, for development):**

1. Copy the extension folder, and in the copy rename:
   `manifest.json` → `manifest.chrome.json`, then
   `manifest.firefox.json` → `manifest.json`.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
   pick any file in the folder.
3. Firefox MV3 treats site access as opt-in: go to `about:addons` → Hocus Focus
   → **Permissions** → enable **"Access your data for all websites"**, or the
   tracker/nudges won't see your tabs.

Temporary add-ons unload when Firefox closes. For a permanent install the
extension must be signed by Mozilla (submit to https://addons.mozilla.org,
self-distribution/unlisted is fine).

**Google sign-in on Firefox — the caveat:**
Firefox generates a **random per-install** OAuth redirect URL
(`https://<random-id>.extensions.allizom.org/`) instead of Chromium's stable
`chromiumapp.org` one. That means sign-in works only after that install's URL
is registered on the Google Cloud OAuth client:

1. In the extension popup, open DevTools console and run
   `chrome.identity.getRedirectURL()` — copy the URL it prints
   (the sign-in code also logs it on every attempt).
2. Google Cloud Console → project `jerry-95215` → APIs & Services →
   Credentials → the "Web client" → **Authorized redirect URIs** → add it →
   Save.

Everything else (tracking, nudges, Pomodoro, tasks, stats, dashboard) works on
Firefox without this step — only cloud sync needs it. If you distribute to many
Firefox users, plan to route sign-in through a hosted web page instead
(future work), since registering every user's random URL doesn't scale.

## Tor Browser — unsupported

Tor is Firefox-based, so the extension can technically be loaded the same way,
but we don't support it:

- Tor's threat model discourages extensions (they make you fingerprintable),
  and it disables persistent storage between sessions in its default mode, so
  stats/streaks would be wiped constantly.
- Google routinely blocks OAuth sign-ins arriving over Tor exit nodes, so
  cloud sync would fail even with a perfect port.

## Safari — conversion required

Safari doesn't load WebExtensions directly; Apple requires wrapping the
extension in a native app via Xcode (macOS only):

```bash
xcrun safari-web-extension-converter "path/to/study extension" --macos-only
```

Then build/run the generated Xcode project and enable the extension in
Safari → Settings → Extensions (enable "Allow unsigned extensions" in the
Develop menu during development). Distribution requires an Apple Developer
account. `chrome.identity.launchWebAuthFlow` is not available in Safari, so
sign-in/sync would need a different auth flow — core features should convert,
but this path is untested.

---

## Maintenance note

`manifest.json` (Chromium) and `manifest.firefox.json` must be kept in sync
when you add permissions, scripts, or resources. The only intentional
differences are:

- Firefox has `browser_specific_settings.gecko` (add-on ID); Chromium has `key`
  (stable extension ID) — each is ignored/invalid on the other side.
- `background`: Chromium uses `service_worker: background.js` (which
  `importScripts` the Firebase libs); Firefox uses a `scripts` array that loads
  the libs first and `background.js` last (its `importScripts` call is guarded
  and skipped there).
