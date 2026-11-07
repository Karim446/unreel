import AVFoundation
import UIKit
import UserNotifications
import WebKit

/// Unreel's own DM notifications.
///
/// Why this design: real push notifications need a paid developer account plus a
/// server that logs in as you — not an option here. Instead Unreel stays running
/// in the background (by quietly "playing" silence, which iOS allows for audio
/// apps) and checks your inbox every 15 seconds using your existing Instagram
/// login. New messages become normal iPhone notifications that open the exact
/// chat when tapped, and they're cleared as soon as you read the chat in Unreel.
///
/// Limits: if you swipe Unreel away in the app switcher, or iOS ends it to free
/// memory, checking stops until you open it again. Keep the real Instagram app's
/// notifications on as a backup if you want to be sure never to miss one.
@MainActor
final class MessageNotifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = MessageNotifier()

    private var timer: Timer?
    private var keepAlive: AVAudioPlayer?
    private var enabled = false
    private var checking = false

    private let defaults = UserDefaults.standard
    private let lastSeenKey = "notifier.lastItemTimestamp"

    // MARK: Turning it on and off

    func setEnabled(_ on: Bool) {
        enabled = on
        if on {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
            startKeepAlive()
            startTimer()
        } else {
            timer?.invalidate()
            timer = nil
            keepAlive?.stop()
            keepAlive = nil
        }
    }

    func configure() {
        UNUserNotificationCenter.current().delegate = self
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in
            Task { @MainActor in await MessageNotifier.shared.checkInbox() }
        }
    }

    /// One second of silence on a loop keeps the app running in the background.
    /// It mixes with other audio, so your music isn't interrupted.
    private func startKeepAlive() {
        guard keepAlive == nil else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            let player = try AVAudioPlayer(data: Self.silentWAV())
            player.numberOfLoops = -1
            player.volume = 0
            player.play()
            keepAlive = player
        } catch {
            keepAlive = nil
        }
    }

    private static func silentWAV(seconds: Int = 1, sampleRate: Int = 8000) -> Data {
        let samples = seconds * sampleRate
        var data = Data()
        func append<T>(_ value: T) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + samples * 2).littleEndian)
        data.append(contentsOf: Array("WAVE".utf8)); data.append(contentsOf: Array("fmt ".utf8))
        append(UInt32(16).littleEndian); append(UInt16(1).littleEndian); append(UInt16(1).littleEndian)
        append(UInt32(sampleRate).littleEndian); append(UInt32(sampleRate * 2).littleEndian)
        append(UInt16(2).littleEndian); append(UInt16(16).littleEndian)
        data.append(contentsOf: Array("data".utf8)); append(UInt32(samples * 2).littleEndian)
        data.append(Data(count: samples * 2))
        return data
    }

    // MARK: Checking the inbox

    func checkInbox() async {
        guard enabled, !checking else { return }
        // While you're in the app, only keep track of what's arrived (you're seeing
        // it already); notify only while Unreel is in the background.
        let quiet = UIApplication.shared.applicationState == .active
        checking = true
        defer { checking = false }

        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { $0.domain.contains("instagram.com") }
        guard let csrf = cookies.first(where: { $0.name == "csrftoken" })?.value, !cookies.isEmpty else { return }

        var request = URLRequest(url: URL(string: "https://www.instagram.com/api/v1/direct_v2/inbox/?limit=20&persistentBadging=true")!)
        request.setValue(cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie")
        request.setValue(csrf, forHTTPHeaderField: "X-CSRFToken")
        request.setValue("936619743392459", forHTTPHeaderField: "X-IG-App-ID")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue(WebViewStore.safariUA, forHTTPHeaderField: "User-Agent")
        request.setValue("https://www.instagram.com/direct/inbox/", forHTTPHeaderField: "Referer")
        request.httpShouldHandleCookies = false

        guard let result = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: result.0) as? [String: Any],
              let inbox = json["inbox"] as? [String: Any],
              let threads = inbox["threads"] as? [[String: Any]] else { return }

        let viewerId = Self.string((json["viewer"] as? [String: Any])?["pk"])
        let lastSeen = defaults.object(forKey: lastSeenKey) as? Int64
        var newest = lastSeen ?? 0
        var unread = 0

        for thread in threads {
            guard let threadId = Self.string(thread["thread_id"]),
                  let item = (thread["items"] as? [[String: Any]])?.first,
                  let stamp = Int64(Self.string(item["timestamp"]) ?? "") else { continue }
            let fromMe = Self.string(item["user_id"]) == viewerId
            if (thread["read_state"] as? Int) == 1 { unread += 1 }
            newest = max(newest, stamp)

            // First run: just remember where we are, don't flood you with old messages.
            guard let lastSeen, stamp > lastSeen, !fromMe, !quiet else { continue }

            let users = thread["users"] as? [[String: Any]] ?? []
            let sender = users.first { Self.string($0["pk"]) == Self.string(item["user_id"]) }
            let title = (thread["thread_title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? (sender?["full_name"] as? String) ?? (sender?["username"] as? String) ?? "New message"
            let isGroup = users.count > 1
            let name = (sender?["full_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (sender?["username"] as? String)
            let body = Self.describe(item)

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = isGroup && name != nil ? "\(name!): \(body)" : body
            content.sound = .default
            content.threadIdentifier = threadId          // groups by chat; used to clear on read
            content.userInfo = ["threadId": threadId]
            let id = Self.string(item["item_id"]) ?? "\(threadId)-\(stamp)"
            try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }

        defaults.set(newest, forKey: lastSeenKey)
        if let count = inbox["unseen_count"] as? Int { unread = count }
        setAppBadge(unread)
    }

    private static func describe(_ item: [String: Any]) -> String {
        switch item["item_type"] as? String {
        case "text": return (item["text"] as? String) ?? "Sent a message"
        case "clip", "media_share", "xma_clip", "xma_media_share": return "Sent a reel"
        case "media", "raven_media", "visual_media": return "Sent a photo"
        case "voice_media": return "Sent a voice message"
        case "like": return "❤️"
        case "link": return ((item["link"] as? [String: Any])?["text"] as? String) ?? "Sent a link"
        case "animated_media": return "Sent a GIF"
        case "story_share", "reel_share": return "Replied to a story"
        default: return "Sent a message"
        }
    }

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }

    // MARK: Badges and clearing

    func setAppBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(max(0, count)) { _ in }
    }

    /// You opened this chat in Unreel: clear its notifications.
    func clearNotifications(forThread threadId: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let ids = delivered.filter { $0.request.content.threadIdentifier == threadId }.map { $0.request.identifier }
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    // MARK: Tapping a notification

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let threadId = response.notification.request.content.userInfo["threadId"] as? String
        Task { @MainActor in
            if let threadId { AppRouter.shared.pendingThread = threadId }
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])   // in the app you're already looking at Instagram
    }
}
