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
    /// A quick action waiting to be carried out by ContentView.
    @Published var pendingAction: QuickAction?
}

enum QuickAction: String {
    case filters, messages, newPost
}

// MARK: - Home Screen quick action ("Filters" when you long-press the icon)

enum QuickActions {
    @MainActor static func install() {
        func item(_ action: QuickAction, _ title: String, _ symbol: String) -> UIApplicationShortcutItem {
            UIApplicationShortcutItem(type: action.rawValue, localizedTitle: title, localizedSubtitle: nil,
                                      icon: UIApplicationShortcutIcon(systemImageName: symbol))
        }
        // Shown top to bottom when you long-press the app icon.
        UIApplication.shared.shortcutItems = [
            item(.messages, "Messages", "paperplane"),
            item(.newPost, "New Post", "plus.app"),
            item(.filters, "Filters", "slider.horizontal.3"),
        ]
    }

    static func handle(_ item: UIApplicationShortcutItem) {
        guard let action = QuickAction(rawValue: item.type) else { return }
        Task { @MainActor in
            if action == .filters {
                AppRouter.shared.showSettings = true
            } else {
                AppRouter.shared.pendingAction = action
            }
        }
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
