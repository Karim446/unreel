# Unreel

Instagram for messaging, with browsing on a short leash. Unreel shows instagram.com in a native iOS app and changes it as it loads.

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

## Build without a Mac (GitHub Actions)

Push this folder to a GitHub repo on the `main` branch. The workflow in `.github/workflows/build.yml` builds an unsigned `Unreel.ipa` on a macOS runner. Download it from Actions → latest run → Artifacts (it arrives zipped), then install it with SideStore, which signs it with your Apple ID. You can also start a build manually from Actions → Build IPA → Run workflow.

## Build on a Mac (Xcode 15+)

### Option A: XcodeGen

```
brew install xcodegen
cd Unreel
xcodegen generate
open Unreel.xcodeproj
```

### Option B: manual

1. In Xcode, choose New Project → iOS App, name it "Unreel", select SwiftUI, and use Swift 5 language mode.
2. Delete the generated ContentView.swift and UnreelApp.swift.
3. Drag everything in `Unreel/` into the project, and make sure `filter.js` is checked for the Unreel target.

### Install on your iPhone

1. In Signing & Capabilities, pick your team. A free Apple ID works.
2. Change the bundle ID from `com.yourname.unreel` to your own.
3. Plug in your phone, select it as the run destination, and press Run.
4. On the phone, go to Settings → General → VPN & Device Management and trust your developer profile.

Builds signed with a free Apple ID expire after 7 days, so you re-run from Xcode to renew. A paid developer account ($99/yr) extends that to a year and allows TestFlight.

## App icon

Replace `Unreel/Assets.xcassets/AppIcon.appiconset/AppIcon.png` with any 1024×1024 PNG with no transparency, keeping the same file name. Push, download the new IPA, and reinstall it through SideStore. Your login is kept.

## Hidden settings

There is no on-screen bar. Open Filters by shaking the phone, or by long-pressing the app icon and choosing Filters. The same menu has Messages (jumps to your inbox) and New Post (opens Instagram's create menu).

## First launch

1. Log in to Instagram inside Unreel. The session persists between launches.
2. Follow the in-app redirect guide to set up the Shortcuts automation (Instagram "Is Opened" → Open URLs: `unreel://inbox` → Run Immediately). Tapping an Instagram notification then lands you in your DM inbox.
3. To hide the real app but keep its notifications, long-press it and choose Remove App → **Remove from Home Screen**. It stays in the App Library. Don't use Hide or a Screen Time limit: both silence notifications.

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
