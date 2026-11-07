import AVFoundation
import UIKit
import WebKit

/// Owns the single WKWebView that shows instagram.com with filter.js injected.
@MainActor
final class WebViewStore: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let home = URL(string: "https://www.instagram.com/")!

    // Present as mobile Safari so Instagram serves its normal mobile site.
    static let safariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

    // Hosts that stay inside the app; anything else opens in Safari.
    private static let allowedHosts = ["instagram.com", "facebook.com", "fbcdn.net", "cdninstagram.com", "meta.com"]

    let webView: WKWebView
    @Published var hasLoaded = false
    /// Instagram's actual page background, used to color the status bar and home-indicator areas.
    @Published var pageColor: UIColor
    /// Current Instagram path, reported by filter.js.
    @Published var path = "/"

    var inChat: Bool { path.hasPrefix("/direct/t/") }

    private let filterSource: String
    private var appliedConfig: String?
    private let refreshControl = UIRefreshControl()
    private var urlObserver: NSKeyValueObservation?
    private var pageDataTimer: Timer?
    static weak var current: WebViewStore?
    private var jsAfterLoad: [String] = []

    override init() {
        // Play reel audio even when the ring/silent switch is on silent, like the real app.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // keeps you logged in
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.ignoresViewportScaleLimits = false     // respect no-zoom viewport
        webView = WKWebView(frame: .zero, configuration: config)

        filterSource = Bundle.main.url(forResource: "filter", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

        pageColor = Self.savedPageColor() ?? .systemBackground

        super.init()

        webView.configuration.userContentController.add(self, name: "theme")
        webView.configuration.userContentController.add(self, name: "haptic")
        webView.configuration.userContentController.add(self, name: "route")
        webView.configuration.userContentController.add(self, name: "unread")
        webView.hideKeyboardAccessoryBar()
        webView.customUserAgent = Self.safariUA
        // WebKit's built-in back swipe shows a snapshot of the previous page, and for
        // Instagram's in-page navigation that snapshot is often missing, leaving a
        // white page behind your finger. Use our own swipe instead (see handleEdgePan).
        webView.allowsBackForwardNavigationGestures = false
        let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgePan(_:)))
        edgePan.edges = .left
        webView.addGestureRecognizer(edgePan)
        webView.allowsLinkPreview = false                    // no Safari-style peek on long-press
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        // Blend with the page instead of flashing white.
        webView.isOpaque = false
        applyPageColor(pageColor)

        // Native pull-to-refresh.
        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        // Remember where you are so the next launch resumes there.
        urlObserver = webView.observe(\.url, options: [.new]) { wv, _ in
            Task { @MainActor in Self.rememberLocation(wv.url) }
        }

        // Unread count and who's online, fetched by the app (the page itself can't
        // reach the address that answers these) and handed to the page.
        pageDataTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { _ in
            Task { @MainActor in await WebViewStore.current?.pushPageData() }
        }
        WebViewStore.current = self
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            _ = await self.readClaim()
            await self.pushPageData()
        }

        // Never leave the screen blank if the first load stalls.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.hasLoaded = true }
    }

    /// Installs the filter script with current settings. Reloads only if settings changed.
    func apply(_ settings: FilterSettings, reloadIfChanged: Bool) {
        let config = settings.jsConfig
        guard config != appliedConfig else { return }
        appliedConfig = config

        // Last known Instagram background, so the page never starts out white.
        let bg = UserDefaults.standard.string(forKey: Self.pageColorKey(for: UITraitCollection.current))
            .map { "window.__UNREEL_BG__ = \"\($0)\";" } ?? ""

        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: config + "\n" + bg + "\n" + filterSource,
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true))
        if reloadIfChanged { webView.reload() }
    }

    func loadHome() { webView.load(URLRequest(url: Self.home)) }

    // MARK: Resume where you left off

    private static let resumeKey = "resumeURL"

    /// Loads the last page you were on, or the feed if there isn't one.
    func loadLastLocation() {
        let saved = UserDefaults.standard.url(forKey: Self.resumeKey)
        webView.load(URLRequest(url: saved ?? Self.home))
    }

    private static func rememberLocation(_ url: URL?) {
        guard let url, let host = url.host?.lowercased(), host.hasSuffix("instagram.com") else { return }
        let path = url.path
        // Don't resume into reels, login, or account-check screens.
        let skip = ["/reel", "/reels", "/accounts/", "/challenge", "/stories/"]
        guard !skip.contains(where: { path.hasPrefix($0) }) else { return }
        UserDefaults.standard.set(url, forKey: resumeKey)
    }

    // MARK: Notifications and maintenance

    func pushPageData() async {
        guard UIApplication.shared.applicationState == .active else { return }
        let data = await MessageNotifier.shared.fetchForPage()
        var js = ""
        if let unread = data.unread {
            js += "window.__unreel && window.__unreel.setUnread(\(unread));"
            MessageNotifier.shared.setAppBadge(unread)
        }
        if let presence = data.presence,
           let json = try? JSONSerialization.data(withJSONObject: presence),
           let text = String(data: json, encoding: .utf8) {
            js += "window.__unreel && window.__unreel.setPresence(\(text));"
        }
        if !js.isEmpty { _ = try? await webView.evaluateJavaScript(js) }
    }

    /// Reads Instagram's www-claim value the page captured, for background checks.
    func readClaim() async -> String? {
        let js = "sessionStorage.getItem('www-claim-v2') || localStorage.getItem('unreel-www-claim') || ''"
        let result = try? await webView.evaluateJavaScript(js)
        let claim = result as? String
        if let claim, !claim.isEmpty { MessageNotifier.shared.updateClaim(claim) }
        return claim
    }

    func openThread(_ id: String) {
        webView.load(URLRequest(url: URL(string: "direct/t/\(id)/", relativeTo: Self.home)!))
    }

    /// Clears cached pages, images and saved page data (not your login), then reloads.
    func resetCache() {
        let types: Set<String> = [
            WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache, WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage,
            WKWebsiteDataTypeIndexedDBDatabases, WKWebsiteDataTypeServiceWorkerRegistrations,
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) { [weak self] in
            Task { @MainActor in
                for key in ["pageColorCSS-dark", "pageColorCSS-light", "resumeURL"] {
                    UserDefaults.standard.removeObject(forKey: key)
                }
                self?.appliedConfig = nil
                self?.loadHome()
            }
        }
    }

    // MARK: Quick actions

    func perform(_ action: QuickAction) {
        switch action {
        case .filters:
            break   // handled by the router (opens the settings sheet)
        case .messages:
            webView.load(URLRequest(url: URL(string: "direct/inbox/", relativeTo: Self.home)!))
        case .newPost:
            // Go to the feed, then tap Instagram's own "New post" button once it has rendered.
            jsAfterLoad.append("window.__unreel && window.__unreel.newPost()")
            loadHome()
        }
    }

    /// Handles unreel:// links, e.g. unreel://inbox from the Shortcuts automation.
    func open(_ url: URL) {
        let target: String
        switch url.host?.lowercased() {
        case "thread", "chat":
            // unreel://thread/<id> opens that chat (used by notifications from elsewhere).
            let id = url.pathComponents.filter { $0 != "/" }.first ?? ""
            target = id.isEmpty ? "direct/inbox/" : "direct/t/\(id)/"
        case "inbox", "direct", "dm": target = "direct/inbox/"
        default: target = ""
        }
        webView.load(URLRequest(url: URL(string: target, relativeTo: Self.home)!))
    }

    @objc private func pullToRefresh() { webView.reload() }

    // MARK: Back swipe

    /// Swipe in from the left edge: the page follows your finger over Instagram's
    /// dark background, and going far enough (or flicking) goes back.
    @objc private func handleEdgePan(_ pan: UIScreenEdgePanGestureRecognizer) {
        guard webView.canGoBack else { return }
        let width = max(webView.bounds.width, 1)
        let dx = max(0, pan.translation(in: webView).x)

        switch pan.state {
        case .began:
            _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        case .changed:
            webView.transform = CGAffineTransform(translationX: dx, y: 0)
            webView.alpha = 1 - (dx / width) * 0.35
        case .ended:
            let flick = pan.velocity(in: webView).x > 700
            if dx > width * 0.35 || flick {
                Haptics.play("light")
                UIView.animate(withDuration: 0.18, delay: 0, options: .curveEaseOut) {
                    self.webView.transform = CGAffineTransform(translationX: width, y: 0)
                    self.webView.alpha = 0.5
                } completion: { _ in
                    self.webView.goBack()
                    self.webView.transform = .identity
                    self.webView.alpha = 0
                    UIView.animate(withDuration: 0.18, delay: 0.05, options: []) { self.webView.alpha = 1 }
                }
            } else {
                snapBack()
            }
        default:
            snapBack()
        }
    }

    private func snapBack() {
        UIView.animate(withDuration: 0.2, delay: 0, options: .curveEaseOut) {
            self.webView.transform = .identity
            self.webView.alpha = 1
        }
    }

    private func finishLoading() {
        refreshControl.endRefreshing()
        jsAfterLoad.forEach { webView.evaluateJavaScript($0) }
        jsAfterLoad.removeAll()
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        if !hasLoaded { hasLoaded = true }
    }

    private static func isAllowed(_ host: String) -> Bool {
        allowedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    // MARK: Page color

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "haptic", let style = message.body as? String {
            return Haptics.play(style)
        }
        if message.name == "unread", let count = message.body as? Int {
            MessageNotifier.shared.setAppBadge(count)
            return
        }
        if message.name == "route", let newPath = message.body as? String {
            if newPath != path {
                let wasInChat = inChat
                path = newPath
                // Reading a chat here clears its notifications.
                if let thread = newPath.split(separator: "/").dropFirst(2).first, newPath.hasPrefix("/direct/t/") {
                    MessageNotifier.shared.clearNotifications(forThread: String(thread))
                }
                webView.scrollView.isScrollEnabled = !inChat
                webView.scrollView.refreshControl = inChat ? nil : refreshControl
                if wasInChat && !inChat {
                    // Leaving a chat: close the keyboard instantly so the page doesn't
                    // re-layout through the whole keyboard animation.
                    UIView.performWithoutAnimation {
                        _ = UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
            }
            return
        }
        guard message.name == "theme", let css = message.body as? String,
              let color = Self.parseCSSColor(css) else { return }
        applyPageColor(color)
        UserDefaults.standard.set(css, forKey: Self.pageColorKey(for: webView.traitCollection))
    }

    private func applyPageColor(_ color: UIColor) {
        pageColor = color
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        webView.underPageBackgroundColor = color
    }

    /// Light and dark mode each remember their own page color.
    private static func pageColorKey(for traits: UITraitCollection) -> String {
        traits.userInterfaceStyle == .dark ? "pageColorCSS-dark" : "pageColorCSS-light"
    }

    private static func savedPageColor() -> UIColor? {
        UserDefaults.standard.string(forKey: pageColorKey(for: UITraitCollection.current)).flatMap(parseCSSColor)
            ?? (UITraitCollection.current.userInterfaceStyle == .dark
                ? UIColor(red: 12 / 255, green: 16 / 255, blue: 20 / 255, alpha: 1) : .white)
    }

    /// Parses "rgb(12, 16, 20)" / "rgba(12, 16, 20, 1)".
    private static func parseCSSColor(_ css: String) -> UIColor? {
        let nums = css.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard nums.count >= 3 else { return nil }
        let alpha = nums.count >= 4 ? nums[3] : 1
        guard alpha > 0.5 else { return nil }
        return UIColor(red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, alpha: 1)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else {
            return decisionHandler(.cancel)
        }
        if ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }

        // Never hand off to instagram:// — opening the real app would trigger the
        // Shortcuts automation and bounce straight back here in a loop.
        guard scheme == "http" || scheme == "https" else { return decisionHandler(.cancel) }

        let isMainFrame = action.targetFrame?.isMainFrame ?? true
        if isMainFrame, !Self.isAllowed(url.host?.lowercased() ?? "") {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishLoading() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishLoading() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finishLoading() }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: WKUIDelegate — open target=_blank links in the same view

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }
}
