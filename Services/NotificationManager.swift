import Foundation
import UserNotifications
import UIKit

final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    private let notifiedItemIDsKey = "unreel.notifiedMessageIDs"
    private let maxStoredIDs = 250
    private var notifiedIDs: [String] = []
    private let lock = NSLock()

    private override init() {
        super.init()
        if let saved = UserDefaults.standard.stringArray(forKey: notifiedItemIDsKey) {
            self.notifiedIDs = saved
        }
    }

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                print("[Unreel] Notification permission error: \(error.localizedDescription)")
            } else {
                print("[Unreel] Notification permission granted: \(granted)")
            }
        }
    }

    /// Deduplicates by message/event ID and schedules an immediate local notification.
    func notifyNewDM(
        messageID: String,
        threadID: String?,
        senderName: String,
        messageText: String,
        badgeCount: Int? = nil
    ) {
        lock.lock()
        if notifiedIDs.contains(messageID) {
            lock.unlock()
            return
        }
        notifiedIDs.append(messageID)
        if notifiedIDs.count > maxStoredIDs {
            notifiedIDs.removeFirst(notifiedIDs.count - maxStoredIDs)
        }
        UserDefaults.standard.set(notifiedIDs, forKey: notifiedItemIDsKey)
        lock.unlock()

        DispatchQueue.main.async {
            let isActive = UIApplication.shared.applicationState == .active
            let content = UNMutableNotificationContent()
            content.title = senderName.isEmpty ? "Instagram Direct" : senderName
            content.body = messageText.isEmpty ? "Sent you a message" : messageText
            content.sound = .default
            if let badge = badgeCount {
                content.badge = NSNumber(value: badge)
            }
            if let threadID = threadID, !threadID.isEmpty {
                content.userInfo = ["deepLink": "unreel://thread/\(threadID)"]
                content.threadIdentifier = threadID
            } else {
                content.userInfo = ["deepLink": "unreel://direct"]
            }

            let identifier = "unreel.dm.\(messageID)"
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { error in
                if let error = error {
                    print("[Unreel] Failed to schedule notification: \(error.localizedDescription)")
                } else if !isActive {
                    print("[Unreel] Scheduled DM notification: \(identifier)")
                }
            }
        }
    }

    func clearBadge() {
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let deepLink = response.notification.request.content.userInfo["deepLink"] as? String,
           let url = URL(string: deepLink) {
            Task { @MainActor in
                if url.host == "thread" {
                    let threadID = url.lastPathComponent
                    AppState.shared.navigateTo(url: URL(string: "https://www.instagram.com/direct/t/\(threadID)/")!)
                } else {
                    AppState.shared.navigateTo(url: URL(string: "https://www.instagram.com/direct/inbox/")!)
                }
            }
        }
        completionHandler()
    }
}
