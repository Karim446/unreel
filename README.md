# Unreel

Instagram for messaging, with browsing on a short leash. Unreel shows instagram.com in a native iOS app and changes it as it loads.

## Install with SideStore (recommended)

You don't need a Mac or a paid developer account. GitHub builds the app, and SideStore signs it on your iPhone with your own Apple ID. A computer is needed once, to put SideStore on the phone; after that everything happens on the iPhone.

### 1. Get the IPA

Every push to `main` builds `Unreel.ipa` on GitHub Actions (`.github/workflows/build.yml`). To start one by hand: Actions → Build IPA → Run workflow.

1. Open the repo's **Actions** tab, pick the latest green **Build IPA** run, and download **Unreel-ipa** under Artifacts. You have to be signed in to GitHub, and this works from Safari on the iPhone too.
2. The download is a zip. Open it in the Files app (or extract it on a computer) to get `Unreel.ipa`.
3. Put `Unreel.ipa` somewhere the iPhone can reach: Downloads in Files, iCloud Drive or AirDrop.

The run number on GitHub is the **Build** number shown at the bottom of Filters, so you can always check which version is installed.

### 2. Set up SideStore (one time)

Full official guide: [sidestore.io](https://sidestore.io). In short:

1. **iPhone:** install **LocalDevVPN** from the App Store, open it and tap Connect (allow the VPN configuration).
2. **Windows PC:** install iTunes from Apple's website (the Microsoft Store version can cause problems) so the PC can see the phone, then install **iloader** (`iloader-windows-x64.msi`) from [github.com/nab138/iloader/releases](https://github.com/nab138/iloader/releases). 64-bit Windows only.
3. Plug the iPhone in with a cable, tap **Trust** on the phone, open iloader, sign in with your Apple ID, and choose **Install SideStore (Stable)**.
4. **iPhone:** Settings → General → VPN & Device Management → trust your Apple ID's developer profile. On iOS 16 and later, also turn on Settings → Privacy & Security → **Developer Mode** (the phone restarts).
5. Open SideStore with LocalDevVPN connected, sign in with the same Apple ID, and allow local network access.

### 3. Install Unreel

1. Connect LocalDevVPN.
2. In SideStore, go to **My Apps**, tap **+**, and choose `Unreel.ipa`.
3. Open Unreel and log in to Instagram (see First launch below).

To **update**, download the new IPA and install it the same way. It replaces the old version, and your Instagram login and today's browsing numbers are kept.

### 4. Keep it running (7-day refresh)

Apps signed with a free Apple ID stop opening after 7 days unless they're refreshed.

- SideStore refreshes in the background while **LocalDevVPN stays connected**. Leave it on.
- To refresh by hand: connect LocalDevVPN, open SideStore → My Apps, and tap the days counter (or Refresh All).
- For extra safety, add a personal automation in Shortcuts (for example daily at a fixed time) that runs SideStore's **Refresh All Apps** action.
- If SideStore itself has expired and won't open, plug the phone in and reinstall it with iloader. Apps you installed through it stay.

Free Apple IDs are limited to **3 sideloaded apps at once** (SideStore counts as one) and 10 new app IDs per week, so avoid installing and deleting lots of apps. SideStore changes the bundle ID to match your account automatically; you don't need to edit `project.yml`.

### If something goes wrong

- **Install spins forever:** LocalDevVPN isn't connected, or the Wi-Fi blocks local VPN traffic. Reconnect LocalDevVPN and try again on a different network.
- **"Unable to verify app" / app won't open:** it expired. Refresh in SideStore.
- **New features don't show up:** check the Build number in Filters against the Actions run number. If it's older, the new IPA wasn't installed.

## Limits

Messages are always open and never counted. Everything else (feed, search, profiles, stories) is "browsing", and browsing only happens in a timed session you start on purpose.

- **Gate.** Leaving Messages shows a full screen with today's numbers, the last seven days, and a pause (5 s, longer with each session that day) before "Browse for 5 min" unlocks. The Messages button works immediately.
- **Sessions.** A thin bar at the top drains while a session runs and turns red for the last 30 seconds. When it ends the screen locks, with one "30 more seconds" to finish what you were typing.
- **Break.** A wait between sessions (10 min by default) with a countdown.
- **Daily time.** A total for the day (20 min by default). The last session is shortened to fit; after that only Messages work until 4 AM.
- **Quiet hours** and **Messages only** switch browsing off on a schedule or completely.
- **Free passes.** A post, reel or story a friend sends you opens from the chat without a session. Wandering off from it is browsing.
- **Fade color** (optional) drains the color from photos and videos through the second half of the daily time.
- **Strict mode** (optional) makes Filters wait 30 seconds before limits or filters can be changed.
- **Open to Messages** (optional) starts the app in your inbox instead of where you left off.

The day's numbers are kept both in the page and in the app, so Reset Cache or a reload can't hand time back.

## Filters

- The Reels tab is hidden, and visiting /reels/ redirects to your DMs.
- Reels (any video post) and ads are removed from the home feed; the feed ends with an "all caught up" card instead of scrolling through blank space.
- Home can show the Following feed (accounts you follow, newest first), looking exactly like the normal feed.
- Reels your friends send in DMs still play, one at a time. Swiping to another Reel sends you back to the chat.
- The Explore grid is hidden while search keeps working.
- Hide your online status and typing indicator. Peek: long-press a chat in the inbox to read it without sending "Seen".

## App feel

- Tab bar and header laid out like the app; haptics; double-tap to like posts and to heart shared posts and reels in chats.
- Comments open as a sheet over the playing reel, most-liked first.
- Save to Photos in the ⋯ menu of posts, reels and stories. Long-press for full-size profile pictures and Copy Text.
- No web-style bar above the keyboard, no white flashes, 120 Hz.
- Long-press the app icon for Messages, New Post, and Filters. Search box on your Story's viewer list.
- DM notifications come from a small relay on a separate server (Instagram → mautrix-meta bridge → private Matrix → Bark). Tapping one opens that chat in Unreel via `unreel://thread/<id>`. The app itself can't receive pushes on a free Apple ID.
- Filters → Extras: switch the app icon, and a Bio Fonts generator.

## App icon

Replace `Unreel/Assets.xcassets/AppIcon.appiconset/AppIcon.png` with any 1024×1024 PNG with no transparency, keeping the same file name. Push, then install the new IPA through SideStore. Your login is kept. (You can also switch between the built-in icons in Filters → Extras → App Icon.)

## Hidden settings

There is no on-screen bar. Open Filters by shaking the phone, or by long-pressing the app icon and choosing Filters. The same menu has Messages (jumps to your inbox) and New Post (opens Instagram's create menu).

## First launch

1. Log in to Instagram inside Unreel. The session persists between launches.
2. Follow the in-app redirect guide to set up the Shortcuts automation (Instagram "Is Opened" → Open URLs: `unreel://inbox` → Run Immediately). Tapping an Instagram notification then lands you in your DM inbox.
3. To hide the real app but keep its notifications, long-press it and choose Remove App → **Remove from Home Screen**. It stays in the App Library. Don't use Hide or a Screen Time limit: both silence notifications.

## Building on a Mac (alternative)

Only needed if you'd rather build and install with Xcode 15+ instead of GitHub Actions and SideStore.

```
brew install xcodegen
xcodegen generate
open Unreel.xcodeproj
```

In Signing & Capabilities, pick your team (a free Apple ID works) and change the bundle ID from `com.yourname.unreel` to your own. Select your iPhone as the run destination and press Run, then trust the developer profile on the phone (Settings → General → VPN & Device Management). Builds with a free Apple ID still expire after 7 days; a paid developer account ($99/yr) extends that to a year.

## How it works

| File | Role |
|---|---|
| `WebViewStore.swift` | Sets up the WKWebView: Safari user agent, persistent login, and script injection at document start (settings, then `limits.js`, then `filter.js`). It blocks `instagram://` handoffs and opens external links in Safari. |
| `Resources/limits.js` | The gate, sessions, breaks, daily time, quiet hours and the session timer. Decides from the page address whether you are in Messages (free) or browsing. |
| `Resources/filter.js` | Hooks Instagram's in-page navigation, hides Reels and ads, ends the feed, and adds the app-like tab bar, header, comments sheet, Peek and the rest. |
| `FilterSettings.swift` | Stores every setting and passes it to the scripts as `window.__UNREEL__`. |
| `UsageSummary.swift` | Keeps the app's copy of the day's browsing numbers and hands it back to `limits.js`. |
| `SettingsView.swift` / `SetupGuideView.swift` | The Filters screen and the Shortcuts setup guide. |

## Tests

```
cd tests
npm install
npx playwright install chromium
npm test
```

- `limits.test.js` runs `limits.js` (with `filter.js` loaded beside it) in Chromium against a mock page with a controllable clock: the gate, pause, sessions, breaks, daily time, the 4 AM rollover, quiet hours, free passes, saved numbers and merging.
- `filter.test.js` runs each script in `tests/filter/` (a mock Instagram page in jsdom exercising one behaviour of `filter.js`) and compares its output with the known-good output in `tests/filter/expected/`. After an intended change, run `node filter.test.js --update` and review the diff.

GitHub Actions runs both on every push (`.github/workflows/test.yml`). The tests use mock pages, so they catch broken logic, not changes Instagram makes to its site.

## Maintenance

Instagram changes its web markup regularly. The filter matches on URL patterns (`/reels/`, `/reel/<id>`) rather than class names, which holds up longer, but expect occasional fixes.

To debug, enable Settings → Apps → Safari → Advanced → Web Inspector on the phone. Then, on the Mac, use Safari's Develop menu → [your iPhone] → Unreel to inspect the page live. Debug builds are already inspectable.
