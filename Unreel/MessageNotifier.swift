import AVFoundation
import BackgroundTasks
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
final class MessageNotifier: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = MessageNotifier()

    /// Shown in Filters so you can see whether checking is working.
    @Published var status = "Not checked yet"

    private var timer: Timer?
    private var keepAlive: AVAudioPlayer?
    private var enabled = false
    private var checking = false

    private let defaults = UserDefaults.standard
    private let lastSeenKey = "notifier.lastItemTimestamp"
    // Static: it's read inside the static request helper below.
    private static var wwwClaim: String { UserDefaults.standard.string(forKey: "notifier.wwwClaim") ?? "0" }

    func updateClaim(_ value: String) { defaults.set(value, forKey: "notifier.wwwClaim") }

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

    static let refreshTaskId = "com.yourname.unreel.refresh"
    static let processingTaskId = "com.yourname.unreel.processing"

    func configure() {
        UNUserNotificationCenter.current().delegate = self
        // These run even if the keep-alive audio is stopped, as long as the app
        // wasn't force-quit. iOS decides when; they are a backstop, not a guarantee.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: nil) { task in
            Task { @MainActor in await MessageNotifier.shared.runBackgroundTask(task) }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingTaskId, using: nil) { task in
            Task { @MainActor in await MessageNotifier.shared.runBackgroundTask(task) }
        }

        let center = NotificationCenter.default
        // Other audio (a reel, a call, Siri) can stop the silent loop: start it again.
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { MessageNotifier.shared.ensureRunning() }
        }
        // Leaving the app: make sure the loop is playing and queue the backstop checks.
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                MessageNotifier.shared.ensureRunning()
                MessageNotifier.shared.scheduleBackgroundTasks()
            }
        }
    }

    /// Make sure the silent loop is playing and the timer is running.
    func ensureRunning() {
        guard enabled else { return }
        if keepAlive?.isPlaying != true {
            keepAlive?.stop()
            keepAlive = nil
            startKeepAlive()
        }
        if timer == nil { startTimer() }
    }

    /// Sends a notification in 5 seconds, so you can leave the app and see it arrive.
    func sendTest() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in
                guard granted else {
                    MessageNotifier.shared.status = "Notifications are off for Unreel in iPhone Settings"
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = "Unreel"
                content.body = "Test notification: notifications are working."
                content.sound = .default
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)
                do {
                    try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "unreel-test", content: content, trigger: trigger))
                    MessageNotifier.shared.status = "Test sent: it should appear in 3 seconds."
                } catch {
                    MessageNotifier.shared.status = "Couldn't send the test: " + error.localizedDescription
                }
            }
        }
    }

    func scheduleBackgroundTasks() {
        guard enabled else { return }
        let refresh = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 60)
        try? BGTaskScheduler.shared.submit(refresh)
        let processing = BGProcessingTaskRequest(identifier: Self.processingTaskId)
        processing.requiresNetworkConnectivity = true
        processing.earliestBeginDate = Date(timeIntervalSinceNow: 300)
        try? BGTaskScheduler.shared.submit(processing)
    }

    private func runBackgroundTask(_ task: BGTask) async {
        scheduleBackgroundTasks()   // always re-schedule the next one
        let work = Task {
            _ = await WebViewStore.current?.readClaim()
            await checkInbox()
        }
        task.expirationHandler = { work.cancel() }
        await work.value
        task.setTaskCompleted(success: true)
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
        guard let csrf = cookies.first(where: { $0.name == "csrftoken" })?.value,
              cookies.contains(where: { $0.name == "sessionid" }) else {
            status = "Not logged in to Instagram in Unreel"
            return
        }

        let cookieHeader = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        guard let result = await Self.instagramGET("/api/v1/direct_v2/inbox/?limit=20&persistentBadging=true",
                                                    cookie: cookieHeader, csrf: csrf) else {
            status = "Couldn't reach Instagram (" + Self.time(Date()) + ")"
            return
        }
        guard let json = try? JSONSerialization.jsonObject(with: result.0) as? [String: Any],
              let inbox = json["inbox"] as? [String: Any],
              let threads = inbox["threads"] as? [[String: Any]] else {
            let code = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            baseStatus = "Refused (" + Self.time(Date()) + "): " + Self.lastReport
            status = pageProbe.isEmpty ? baseStatus : baseStatus + "\nIn page: " + pageProbe
            return
        }

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
        let running = keepAlive?.isPlaying == true ? "running in background" : "background mode NOT running"
        status = "Working · \(unread) unread · checked " + Self.time(Date()) + " · " + running
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

    private static func time(_ date: Date) -> String {
        let f = DateFormatter()
        f.timeStyle = .medium
        return f.string(from: date)
    }

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }


    // MARK: Talking to Instagram

    /// Instagram answers these requests differently depending on how they're made,
    /// and which way works changes over time. We try several known ways, remember
    /// the one that works, and keep a short report of what each one answered
    /// (shown in Filters) so a failure can be pinned down.
    private static var workingVariant: Int?
    static var lastReport = ""
    /// What the same request answered from inside the page (see WebViewStore).
    var pageProbe = "" { didSet { if !status.hasPrefix("Working") { status = baseStatus + "\nIn page: " + pageProbe } } }
    private var baseStatus = "Not checked yet"

    private struct Variant {
        let name: String
        let base: String
        let userAgent: String
        let appId: String
        let webHeaders: Bool   // the extra headers the website sends with its own requests
    }

    private static let iosAppUA = "Instagram 360.0.0.30.109 (iPhone15,2; iOS 18_6; en_US; en-US; scale=3.00; 1179x2556; 672535977)"

    private static let variants: [Variant] = [
        Variant(name: "web", base: "https://www.instagram.com", userAgent: WebViewStore.safariUA, appId: "936619743392459", webHeaders: true),
        Variant(name: "app", base: "https://i.instagram.com", userAgent: iosAppUA, appId: "124024574287414", webHeaders: false),
        Variant(name: "web-alt", base: "https://i.instagram.com", userAgent: WebViewStore.safariUA, appId: "936619743392459", webHeaders: true),
    ]

    static func instagramGET(_ path: String, cookie: String, csrf: String) async -> (Data, URLResponse)? {
        let order = workingVariant.map { w in [w] + variants.indices.filter { $0 != w } } ?? Array(variants.indices)
        var last: (Data, URLResponse)?
        var report: [String] = []
        for i in order {
            let v = variants[i]
            guard let url = URL(string: v.base + path) else { continue }
            var request = URLRequest(url: url)
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
            request.setValue(csrf, forHTTPHeaderField: "X-CSRFToken")
            request.setValue(v.appId, forHTTPHeaderField: "X-IG-App-ID")
            request.setValue(v.userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            if v.webHeaders {
                request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
                request.setValue("https://www.instagram.com/direct/inbox/", forHTTPHeaderField: "Referer")
                request.setValue("https://www.instagram.com", forHTTPHeaderField: "Origin")
                request.setValue(Self.wwwClaim, forHTTPHeaderField: "X-IG-WWW-Claim")
                request.setValue("129477", forHTTPHeaderField: "X-ASBD-ID")
                request.setValue("same-origin", forHTTPHeaderField: "Sec-Fetch-Site")
            }
            request.httpShouldHandleCookies = false
            guard let result = try? await URLSession.shared.data(for: request) else {
                report.append("\(v.name): no connection")
                continue
            }
            last = result
            let code = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200, (try? JSONSerialization.jsonObject(with: result.0)) != nil {
                workingVariant = i
                lastReport = "\(v.name): OK"
                return result
            }
            report.append("\(v.name): \(code) \(reason(result.0))")
        }
        lastReport = report.joined(separator: " | ")
        return last
    }

    /// Instagram's own explanation for a refusal. It can be nested a few levels
    /// deep ({"content": {"status": "..."}}), so we look for the first message-like
    /// text anywhere in the answer.
    private static func reason(_ data: Data) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) {
            if let text = firstMessage(in: json, depth: 0) { return String(text.prefix(140)) }
        }
        let text = String(data: data.prefix(300), encoding: .utf8)?
            .replacingOccurrences(of: "\n", with: " ") ?? ""
        return text.contains("<html") ? "(web page)" : String(text.prefix(140))
    }

    private static func firstMessage(in value: Any, depth: Int) -> String? {
        guard depth < 4 else { return nil }
        if let dict = value as? [String: Any] {
            for key in ["message", "error_title", "error_body", "feedback_message", "status", "error_type"] {
                if let text = dict[key] as? String, !text.isEmpty, !["fail", "ok"].contains(text.lowercased()) {
                    return text
                }
            }
            for (_, nested) in dict {
                if let found = firstMessage(in: nested, depth: depth + 1) { return found }
            }
        }
        return nil
    }

    /// Who's online and the unread count, for the page (it can't ask the app
    /// address itself). Used while you're in the app.
    func fetchForPage() async -> (unread: Int?, presence: [String: Any]?) {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { $0.domain.contains("instagram.com") }
        guard let csrf = cookies.first(where: { $0.name == "csrftoken" })?.value else { return (nil, nil) }
        let cookieHeader = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        var unread: Int?
        var presence: [String: Any]?
        if let r = await Self.instagramGET("/api/v1/direct_v2/get_badge_count/?no_raven=1", cookie: cookieHeader, csrf: csrf),
           let json = try? JSONSerialization.jsonObject(with: r.0) as? [String: Any] {
            unread = json["badge_count"] as? Int
        }
        if let r = await Self.instagramGET("/api/v1/direct_v2/get_presence/", cookie: cookieHeader, csrf: csrf),
           let json = try? JSONSerialization.jsonObject(with: r.0) as? [String: Any] {
            presence = json["user_presence"] as? [String: Any]
        }
        return (unread, presence)
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
        // In the app you're already looking at Instagram, so message notifications
        // stay quiet here; the test one always shows so you can see it works.
        let isTest = notification.request.identifier == "unreel-test"
        completionHandler(isTest ? [.banner, .list, .sound] : [])
    }
}
