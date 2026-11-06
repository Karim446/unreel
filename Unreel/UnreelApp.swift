import SwiftUI
import UIKit

@main
struct UnreelApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var settings = FilterSettings()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
        }
    }
}

/// App-wide UI state that UIKit entry points (shake, quick actions) can reach.
@MainActor
final class AppRouter: ObservableObject {
    static let shared = AppRouter()
    @Published var showSettings = false
}

// MARK: - Home Screen quick action ("Filters" when you long-press the icon)

enum QuickActions {
    static let filtersType = "filters"

    @MainActor static func install() {
        UIApplication.shared.shortcutItems = [
            UIApplicationShortcutItem(type: filtersType,
                                      localizedTitle: "Filters",
                                      localizedSubtitle: nil,
                                      icon: UIApplicationShortcutIcon(systemImageName: "slider.horizontal.3"))
        ]
    }

    static func handle(_ item: UIApplicationShortcutItem) {
        guard item.type == filtersType else { return }
        Task { @MainActor in AppRouter.shared.showSettings = true }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { QuickActions.handle(item) }   // cold launch
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        QuickActions.handle(shortcutItem)                                  // app already running
        completionHandler(true)
    }
}

// MARK: - Shake to open settings

extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            Task { @MainActor in AppRouter.shared.showSettings = true }
        }
        super.motionEnded(motion, with: event)
    }
}
