import Foundation
import WebKit

/// Handles direct HTTP inbox checks for background tasks or fallback verification.
actor InstagramInboxService {
    static let shared = InstagramInboxService()

    // Coherent Native iOS Instagram App Identity (passes "Prompt has contribution" version checks)
    private let mobileAppUserAgent = "Instagram 358.0.0.34.93 (iPhone16,1; iOS 18_1; en_US; en; scale=3.00; 1179x2556; 665129812)"
    private let mobileAppID = "567067343352427"
    private let mobileCapabilities = "3brTv10="

    // Coherent Desktop Web Identity (fallback for www.instagram.com)
    private let desktopWebUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
    private let desktopWebAppID = "936619743392459"

    private let urlSession: URLSession
    private var consecutiveFailures: Int = 0
    private var backoffUntil: Date = .distantPast
    private let hasInitializedBaselineKey = "unreel.inboxBaselineInitialized"
    private let knownThreadTimestampsKey = "unreel.knownThreadTimestamps"

    private init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.httpShouldSetCookies = false
        self.urlSession = URLSession(configuration: config)
    }

    private func fetchInstagramCookies() async -> [String: String] {
        let cookies = await MainActor.run {
            WKWebsiteDataStore.default().httpCookieStore
        }
        return await withCheckedContinuation { continuation in
            cookies.getAllCookies { allCookies in
                var dict: [String: String] = [:]
                for cookie in allCookies where cookie.domain.contains("instagram.com") {
                    dict[cookie.name] = cookie.value
                }
                continuation.resume(returning: dict)
            }
        }
    }

    @discardableResult
    func checkInboxNow(reason: String = "scheduled") async -> Bool {
        if Date() < backoffUntil {
            let remaining = Int(backoffUntil.timeIntervalSinceNow)
            await updateStatus("Backed off (\(remaining)s)")
            return false
        }

        let cookieMap = await fetchInstagramCookies()
        guard let sessionID = cookieMap["sessionid"], !sessionID.isEmpty,
              let currentUserID = cookieMap["ds_user_id"], !currentUserID.isEmpty else {
            await updateStatus("Not logged in")
            return false
        }

        let csrfToken = cookieMap["csrftoken"] ?? ""
        let cookieHeader = cookieMap
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "; ")

        // Strategy 1: i.instagram.com with Native Mobile App headers
        do {
            if let data = try await fetchMobileInbox(cookieHeader: cookieHeader, csrfToken: csrfToken) {
                try await parseAndNotify(jsonData: data, currentUserID: currentUserID)
                consecutiveFailures = 0
                await updateStatus("Synced via Mobile API (\(formattedTime()))")
                return true
            }
        } catch {
            print("[Unreel] Mobile inbox request failed (\(error.localizedDescription)), trying Desktop Web fallback...")
        }

        // Strategy 2: www.instagram.com with Desktop Web headers
        do {
            if let data = try await fetchDesktopWebInbox(cookieHeader: cookieHeader, csrfToken: csrfToken) {
                try await parseAndNotify(jsonData: data, currentUserID: currentUserID)
                consecutiveFailures = 0
                await updateStatus("Synced via Web API (\(formattedTime()))")
                return true
            }
        } catch {
            consecutiveFailures += 1
            let backoffSeconds = min(900.0, pow(2.0, Double(consecutiveFailures)) * 30.0)
            backoffUntil = Date().addingTimeInterval(backoffSeconds)
            await updateStatus("Error (retry in \(Int(backoffSeconds))s)")
            print("[Unreel] Desktop fallback also failed: \(error.localizedDescription)")
        }

        return false
    }

    private func fetchMobileInbox(cookieHeader: String, csrfToken: String) async throws -> Data? {
        var components = URLComponents(string: "https://i.instagram.com/api/v1/direct_v2/inbox/")!
        components.queryItems = [
            URLQueryItem(name: "persistentBadging", value: "true"),
            URLQueryItem(name: "limit", value: "10"),
            URLQueryItem(name: "thread_message_limit", value: "5")
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue(mobileAppUserAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(mobileAppID, forHTTPHeaderField: "X-IG-App-ID")
        request.setValue(mobileCapabilities, forHTTPHeaderField: "X-IG-Capabilities")
        request.setValue("WIFI", forHTTPHeaderField: "X-IG-Connection-Type")
        request.setValue("en_US", forHTTPHeaderField: "Accept-Language")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        if !csrfToken.isEmpty {
            request.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        }
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { return nil }

        if http.statusCode == 429 {
            consecutiveFailures += 2
            backoffUntil = Date().addingTimeInterval(600)
            throw NSError(domain: "UnreelInbox", code: 429, userInfo: [NSLocalizedDescriptionKey: "Rate limited (429)"])
        }

        guard (200...299).contains(http.statusCode) else {
            let bodyPreview = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw NSError(
                domain: "UnreelInbox",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(bodyPreview)"]
            )
        }
        return data
    }

    private func fetchDesktopWebInbox(cookieHeader: String, csrfToken: String) async throws -> Data? {
        var components = URLComponents(string: "https://www.instagram.com/api/v1/direct_v2/inbox/")!
        components.queryItems = [
            URLQueryItem(name: "persistentBadging", value: "true"),
            URLQueryItem(name: "folder", value: ""),
            URLQueryItem(name: "limit", value: "10"),
            URLQueryItem(name: "thread_message_limit", value: "5")
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue(desktopWebUserAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(desktopWebAppID, forHTTPHeaderField: "X-IG-App-ID")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue("https://www.instagram.com/direct/inbox/", forHTTPHeaderField: "Referer")
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        if !csrfToken.isEmpty {
            request.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        }
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "UnreelInbox", code: code, userInfo: [NSLocalizedDescriptionKey: "Desktop fallback HTTP \(code)"])
        }
        return data
    }

    private func parseAndNotify(jsonData: Data, currentUserID: String) async throws {
        guard let root = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let inbox = root["inbox"] as? [String: Any],
              let threads = inbox["threads"] as? [[String: Any]] else {
            return
        }

        let unseenCount = (inbox["unseen_count"] as? Int) ?? 0
        await MainActor.run {
            AppState.shared.unreadCount = unseenCount
        }

        let defaults = UserDefaults.standard
        let isInitialized = defaults.bool(forKey: hasInitializedBaselineKey)
        var knownTimestamps = (defaults.dictionary(forKey: knownThreadTimestampsKey) as? [String: Double]) ?? [:]

        for thread in threads {
            guard let threadID = thread["thread_id"] as? String else { continue }
            let threadTitle = (thread["thread_title"] as? String) ?? "Instagram User"

            var userMap: [String: String] = [:]
            if let users = thread["users"] as? [[String: Any]] {
                for u in users {
                    let uid: String
                    if let pkStr = u["pk_id"] as? String {
                        uid = pkStr
                    } else if let pkNum = u["pk"] as? NSNumber {
                        uid = pkNum.stringValue
                    } else {
                        continue
                    }
                    let name = (u["full_name"] as? String).flatMap({ $0.isEmpty ? nil : $0 })
                        ?? (u["username"] as? String)
                        ?? threadTitle
                    userMap[uid] = name
                }
            }

            guard let lastItem = (thread["last_permanent_item"] as? [String: Any])
                    ?? (thread["items"] as? [[String: Any]])?.first else {
                continue
            }

            let itemID = (lastItem["item_id"] as? String) ?? UUID().uuidString
            let senderID: String
            if let uidNum = lastItem["user_id"] as? NSNumber {
                senderID = uidNum.stringValue
            } else if let uidStr = lastItem["user_id"] as? String {
                senderID = uidStr
            } else {
                senderID = ""
            }

            let itemTimestamp: Double
            if let tsStr = lastItem["timestamp"] as? String, let val = Double(tsStr) {
                itemTimestamp = val
            } else if let tsNum = lastItem["timestamp"] as? NSNumber {
                itemTimestamp = tsNum.doubleValue
            } else {
                itemTimestamp = 0
            }

            let previousTimestamp = knownTimestamps[threadID] ?? 0
            if itemTimestamp > previousTimestamp {
                knownTimestamps[threadID] = itemTimestamp

                if isInitialized && !senderID.isEmpty && senderID != currentUserID {
                    let senderName = userMap[senderID] ?? threadTitle
                    let bodyText = extractMessagePreview(from: lastItem)
                    NotificationManager.shared.notifyNewDM(
                        messageID: itemID,
                        threadID: threadID,
                        senderName: senderName,
                        messageText: bodyText,
                        badgeCount: max(1, unseenCount)
                    )
                }
            }
        }

        defaults.set(knownTimestamps, forKey: knownThreadTimestampsKey)
        if !isInitialized {
            defaults.set(true, forKey: hasInitializedBaselineKey)
        }
    }

    private func extractMessagePreview(from item: [String: Any]) -> String {
        let itemType = (item["item_type"] as? String) ?? "text"
        if let text = item["text"] as? String, !text.isEmpty {
            return text
        }
        switch itemType {
        case "media", "raven_media", "visual_media":
            return "Sent a photo or video"
        case "voice_media":
            return "Sent a voice message"
        case "clip", "FelixShare":
            return "Shared a video"
        case "media_share":
            return "Shared a post"
        case "story_share", "reel_share":
            return "Shared a story"
        case "like":
            return "Liked a message ❤️"
        case "link":
            return "Sent a link"
        default:
            return "Sent a message"
        }
    }

    private func formattedTime() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date())
    }

    private func updateStatus(_ status: String) async {
        await MainActor.run {
            AppState.shared.lastSyncStatus = status
        }
    }
}
