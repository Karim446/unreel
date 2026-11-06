# Unreel

Instagram without the Reels feed. Unreel shows instagram.com in a native iOS app and filters it as it loads:

- The Reels tab is hidden, and visiting /reels/ redirects to your DMs.
- Reels are removed from the home feed.
- Reels your friends send in DMs still play, one at a time. Swiping to another Reel sends you back to the chat.
- The Explore grid is hidden while search keeps working (toggle in Filters).
- Haptic taps when you like a post, double-tap a photo, switch tabs, or swipe a reel closed.
- No web-style arrows/"Done" bar above the keyboard.
- Reopens where you left off (except reels and login screens).
- Long-press the app icon for Messages, New Post, and Filters.
- Native message bar in chats (iOS text box with emoji suggestions, camera, photo picker). Mic, stickers, and + switch to Instagram's own box until you leave the chat. Toggle in Filters.

A Shortcuts automation sends taps on the real Instagram icon to Unreel.

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
| `WebViewStore.swift` | Sets up the WKWebView: Safari user agent, persistent login, and filter injection. It blocks `instagram://` handoffs, which would otherwise loop back through the automation, and opens external links in Safari. |
| `filter.js` | Hooks `history.pushState`, `replaceState` and `popstate` to catch Instagram's in-page navigation. Redirects blocked paths, hides Reels nav links and feed posts that link to `/reel/`, and tracks which single Reel was opened from a DM. |
| `FilterSettings.swift` | Stores the toggles and passes them to the script as `window.__UNREEL__`. |
| `SettingsView.swift` / `SetupGuideView.swift` | The Filters screen and the Shortcuts setup guide. |

## Maintenance

Instagram changes its web markup regularly. The filter matches on URL patterns (`/reels/`, `/reel/<id>`) rather than class names, which holds up longer, but expect occasional fixes.

To debug, enable Settings → Apps → Safari → Advanced → Web Inspector on the phone. Then, on the Mac, use Safari's Develop menu → [your iPhone] → Unreel to inspect the page live. Debug builds are already inspectable.
