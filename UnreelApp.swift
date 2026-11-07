import SwiftUI
import BackgroundTasks
import UserNotifications

@main
struct UnreelApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var appState = AppState.shared

    init() {
        NotificationManager.shared.configure()
        BackgroundKeepAliveManager.shared.registerBackgroundTasks()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .preferredColorScheme(appState.forceDarkMode ? .dark : nil)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        .onChange(of: scenePhase) { newPhase in
            switch newPhase {
            case .active:
                NotificationManager.shared.clearBadge()
                BackgroundKeepAliveManager.shared.handleAppDidBecomeActive()
            case .background:
                BackgroundKeepAliveManager.shared.handleAppDidEnterBackground()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
    }

    /// Handles `unreel://direct` or `unreel://thread/<id>` deep links from local or ntfy/Bark push notifications.
    private func handleDeepLink(_ url: URL) {
        guard url.scheme?.lowercased() == "unreel" else { return }
        let host = url.host?.lowercased() ?? ""
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        if host == "direct" || host == "inbox" {
            if !path.isEmpty {
                appState.navigateTo(url: URL(string: "https://www.instagram.com/direct/t/\(path)/")!)
            } else {
                appState.navigateTo(url: URL(string: "https://www.instagram.com/direct/inbox/")!)
            }
        } else if host == "thread", !path.isEmpty {
            appState.navigateTo(url: URL(string: "https://www.instagram.com/direct/t/\(path)/")!)
        }
    }
}

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var blockReels: Bool {
        didSet { UserDefaults.standard.set(blockReels, forKey: "unreel.blockReels"); syncSettingsToWebView() }
    }
    @Published var blockSponsoredPosts: Bool {
        didSet { UserDefaults.standard.set(blockSponsoredPosts, forKey: "unreel.blockSponsoredPosts"); syncSettingsToWebView() }
    }
    @Published var hideExploreGrid: Bool {
        didSet { UserDefaults.standard.set(hideExploreGrid, forKey: "unreel.hideExploreGrid"); syncSettingsToWebView() }
    }
    @Published var backgroundKeepAliveEnabled: Bool {
        didSet {
            UserDefaults.standard.set(backgroundKeepAliveEnabled, forKey: "unreel.backgroundKeepAlive")
            BackgroundKeepAliveManager.shared.setKeepAliveEnabled(backgroundKeepAliveEnabled)
        }
    }
    @Published var forceDarkMode: Bool {
        didSet { UserDefaults.standard.set(forceDarkMode, forKey: "unreel.forceDarkMode") }
    }
    @Published var unreadCount: Int = 0
    @Published var lastSyncStatus: String = "Idle"
    @Published var pendingNavigationURL: URL?

    private init() {
        let defaults = UserDefaults.standard
        defaults.register(defaults: [
            "unreel.blockReels": true,
            "unreel.blockSponsoredPosts": true,
            "unreel.hideExploreGrid": false,
            "unreel.backgroundKeepAlive": false,
            "unreel.forceDarkMode": true
        ])
        self.blockReels = defaults.bool(forKey: "unreel.blockReels")
        self.blockSponsoredPosts = defaults.bool(forKey: "unreel.blockSponsoredPosts")
        self.hideExploreGrid = defaults.bool(forKey: "unreel.hideExploreGrid")
        self.backgroundKeepAliveEnabled = defaults.bool(forKey: "unreel.backgroundKeepAlive")
        self.forceDarkMode = defaults.bool(forKey: "unreel.forceDarkMode")
    }

    func navigateTo(url: URL) {
        self.pendingNavigationURL = url
    }

    func syncSettingsToWebView() {
        NotificationCenter.default.post(name: .unreelSettingsChanged, object: nil)
    }
}

extension Notification.Name {
    static let unreelSettingsChanged = Notification.Name("unreelSettingsChanged")
}
