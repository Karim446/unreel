import Foundation

/// The day's browsing numbers. limits.js keeps them and sends a copy to the
/// app each time they change, so that clearing the page's storage (Reset
/// Cache) can't wipe them.
enum UsageSummary {
    static let storageKey = "limitsState"

    /// Saves the page's numbers (a small piece of JSON text).
    static func store(_ json: String) {
        guard json.utf8.count < 20_000 else { return }
        UserDefaults.standard.set(json, forKey: storageKey)
    }

    private static func saved() -> [String: Any]? {
        guard let text = UserDefaults.standard.string(forKey: storageKey),
              let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A line of script that hands the saved numbers back to limits.js.
    static func script() -> String {
        guard let object = saved(),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else { return "" }
        return "window.__UNREEL_LIMITS_STATE__ = \(json);"
    }

    /// limits.js starts a new day at 4 AM; this matches it.
    private static func todayKey() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date().addingTimeInterval(-4 * 3600))
    }

    /// "12 min · 3 sessions · 7 opens" for the Filters screen.
    static func today() -> String {
        guard let object = saved(), (object["day"] as? String) == todayKey() else {
            return "Nothing yet today"
        }
        let used = (object["used"] as? NSNumber)?.doubleValue ?? 0
        let sessions = (object["sessions"] as? NSNumber)?.intValue ?? 0
        let opens = (object["opens"] as? NSNumber)?.intValue ?? 0
        let minutes = Int((used / 60).rounded())
        return "\(minutes) min · \(sessions) sessions · \(opens) opens"
    }
}
