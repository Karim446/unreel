import SwiftUI
import WebKit
import SafariServices

struct InstagramWebView: UIViewRepresentable {
    @EnvironmentObject var appState: AppState

    func makeCoordinator() -> Coordinator {
        Coordinator(appState: appState)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let contentController = WKUserContentController()

        if let jsURL = Bundle.main.url(forResource: "UnreelInjected", withExtension: "js"),
           let jsSource = try? String(contentsOf: jsURL, encoding: .utf8) {
            let userScript = WKUserScript(
                source: jsSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
            contentController.addUserScript(userScript)
        }

        let weakHandler = WeakScriptMessageHandler(delegate: context.coordinator)
        contentController.add(weakHandler, name: "unreel")
        config.userContentController = contentController

        if let rulesURL = Bundle.main.url(forResource: "ContentBlockerRules", withExtension: "json"),
           let rulesJSON = try? String(contentsOf: rulesURL, encoding: .utf8) {
            WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: "UnreelBlockerRules",
                encodedContentRuleList: rulesJSON
            ) { ruleList, _ in
                if let ruleList = ruleList {
                    contentController.add(ruleList)
                }
            }
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.decelerationRate = .normal

        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = .white
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.handlePullToRefresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refreshControl

        context.coordinator.webView = webView
        webView.load(URLRequest(url: URL(string: "https://www.instagram.com/")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let targetURL = appState.pendingNavigationURL {
            DispatchQueue.main.async {
                appState.pendingNavigationURL = nil
                webView.load(URLRequest(url: targetURL))
            }
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let appState: AppState
        private let lightHaptic = UIImpactFeedbackGenerator(style: .light)
        private var settingsObserver: NSObjectProtocol?

        init(appState: AppState) {
            self.appState = appState
            super.init()
            lightHaptic.prepare()

            settingsObserver = NotificationCenter.default.addObserver(
                forName: .unreelSettingsChanged,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.pushSettingsToJS()
            }
        }

        deinit {
            if let observer = settingsObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "unreel")
        }

        @objc func handlePullToRefresh(_ sender: UIRefreshControl) {
            lightHaptic.impactOccurred()
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                sender.endRefreshing()
            }
        }

        func pushSettingsToJS() {
            Task { @MainActor in
                let configJSON = """
                window.__UNREEL_APPLY_SETTINGS__ && window.__UNREEL_APPLY_SETTINGS__({
                    blockReels: \(appState.blockReels),
                    blockSponsoredPosts: \(appState.blockSponsoredPosts),
                    hideExploreGrid: \(appState.hideExploreGrid)
                });
                """
                webView?.evaluateJavaScript(configJSON, completionHandler: nil)
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "unreel",
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String else {
                return
            }

            switch type {
            case "haptic":
                lightHaptic.impactOccurred()

            case "unread_count_changed":
                let count = (body["count"] as? Int) ?? 0
                let increased = (body["increased"] as? Bool) ?? false
                Task { @MainActor in
                    appState.unreadCount = count
                }
                if increased {
                    Task {
                        await InstagramInboxService.shared.checkInboxNow(reason: "dom_badge_increase")
                    }
                }

            case "ws_dm_event":
                let itemID = (body["itemId"] as? String) ?? UUID().uuidString
                let threadID = body["threadId"] as? String
                let text = (body["text"] as? String) ?? "Sent you a message"
                NotificationManager.shared.notifyNewDM(
                    messageID: itemID,
                    threadID: threadID,
                    senderName: "Instagram Direct",
                    messageText: text
                )

            case "ws_sync_hint":
                Task {
                    await InstagramInboxService.shared.checkInboxNow(reason: "websocket_event")
                }

            default:
                break
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pushSettingsToJS()
            Task {
                await InstagramInboxService.shared.checkInboxNow(reason: "navigation_finished")
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            let host = url.host?.lowercased() ?? ""

            if url.scheme == "instagram" || host.contains("applink.instagram.com") {
                decisionHandler(.cancel)
                return
            }

            if navigationAction.navigationType == .linkActivated,
               !host.contains("instagram.com"),
               !host.contains("facebook.com"),
               (url.scheme == "http" || url.scheme == "https") {
                openInSafariViewController(url: url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        private func openInSafariViewController(url: URL) {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = scene.windows.first?.rootViewController else {
                UIApplication.shared.open(url)
                return
            }
            let safariVC = SFSafariViewController(url: url)
            safariVC.modalPresentationStyle = .pageSheet
            rootVC.present(safariVC, animated: true)
        }
    }
}
