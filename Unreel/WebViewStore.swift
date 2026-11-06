import UIKit
import WebKit

/// Owns the single WKWebView that shows instagram.com with filter.js injected.
@MainActor
final class WebViewStore: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    static let home = URL(string: "https://www.instagram.com/")!

    // Present as mobile Safari so Instagram serves its normal mobile site.
    static let safariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

    // Hosts that stay inside the app; anything else opens in Safari.
    private static let allowedHosts = ["instagram.com", "facebook.com", "fbcdn.net", "cdninstagram.com", "meta.com"]

    let webView: WKWebView
    @Published var hasLoaded = false

    private let filterSource: String
    private var appliedConfig: String?
    private let refreshControl = UIRefreshControl()

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // keeps you logged in
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.ignoresViewportScaleLimits = false     // respect no-zoom viewport
        webView = WKWebView(frame: .zero, configuration: config)

        filterSource = Bundle.main.url(forResource: "filter", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

        super.init()

        webView.customUserAgent = Self.safariUA
        webView.allowsBackForwardNavigationGestures = true   // edge swipe = back
        webView.allowsLinkPreview = false                    // no Safari-style peek on long-press
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        // Blend with the page instead of flashing white.
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.underPageBackgroundColor = .systemBackground

        // Native pull-to-refresh.
        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        // Never leave the screen blank if the first load stalls.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.hasLoaded = true }
    }

    /// Installs the filter script with current settings. Reloads only if settings changed.
    func apply(_ settings: FilterSettings, reloadIfChanged: Bool) {
        let config = settings.jsConfig
        guard config != appliedConfig else { return }
        appliedConfig = config

        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: config + "\n" + filterSource,
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true))
        if reloadIfChanged { webView.reload() }
    }

    func loadHome() { webView.load(URLRequest(url: Self.home)) }

    /// Handles unreel:// links, e.g. unreel://inbox from the Shortcuts automation.
    func open(_ url: URL) {
        let target: String
        switch url.host?.lowercased() {
        case "inbox", "direct", "dm": target = "direct/inbox/"
        default: target = ""
        }
        webView.load(URLRequest(url: URL(string: target, relativeTo: Self.home)!))
    }

    @objc private func pullToRefresh() { webView.reload() }

    private func finishLoading() {
        refreshControl.endRefreshing()
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        if !hasLoaded { hasLoaded = true }
    }

    private static func isAllowed(_ host: String) -> Bool {
        allowedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
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
