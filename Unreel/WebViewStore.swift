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
    @Published var canGoBack = false

    private let filterSource: String
    private var appliedConfig: String?
    private var backObserver: NSKeyValueObservation?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // keeps you logged in
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: config)

        filterSource = Bundle.main.url(forResource: "filter", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

        super.init()

        webView.customUserAgent = Self.safariUA
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        backObserver = webView.observe(\.canGoBack, options: [.new]) { [weak self] wv, _ in
            Task { @MainActor in self?.canGoBack = wv.canGoBack }
        }
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

    func goBack() { if webView.canGoBack { webView.goBack() } }

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
