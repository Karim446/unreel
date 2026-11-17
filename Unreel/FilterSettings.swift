import Foundation

/// Everything you can change in Filters, saved in UserDefaults and handed to
/// the page scripts (filter.js and limits.js) as window.__UNREEL__.
final class FilterSettings: ObservableObject {
    private let defaults = UserDefaults.standard

    // Filters
    @Published var blockReelsTab: Bool { didSet { defaults.set(blockReelsTab, forKey: "blockReelsTab") } }
    @Published var blockFeedReels: Bool { didSet { defaults.set(blockFeedReels, forKey: "blockFeedReels") } }
    @Published var allowDMReels: Bool { didSet { defaults.set(allowDMReels, forKey: "allowDMReels") } }
    @Published var hideExploreGrid: Bool { didSet { defaults.set(hideExploreGrid, forKey: "hideExploreGrid") } }
    @Published var hideAds: Bool { didSet { defaults.set(hideAds, forKey: "hideAds") } }
    @Published var hideOnline: Bool { didSet { defaults.set(hideOnline, forKey: "hideOnline") } }
    @Published var hideTyping: Bool { didSet { defaults.set(hideTyping, forKey: "hideTyping") } }
    @Published var followingFeed: Bool { didSet { defaults.set(followingFeed, forKey: "followingFeed") } }
    @Published var hasSeenSetup: Bool { didSet { defaults.set(hasSeenSetup, forKey: "hasSeenSetup") } }

    // Limits (see limits.js)
    @Published var limitsOn: Bool { didSet { defaults.set(limitsOn, forKey: "limitsOn") } }
    @Published var dailyMinutes: Int { didSet { defaults.set(dailyMinutes, forKey: "dailyMinutes") } }
    @Published var sessionMinutes: Int { didSet { defaults.set(sessionMinutes, forKey: "sessionMinutes") } }
    @Published var breakMinutes: Int { didSet { defaults.set(breakMinutes, forKey: "breakMinutes") } }
    @Published var pauseSeconds: Int { didSet { defaults.set(pauseSeconds, forKey: "pauseSeconds") } }
    @Published var quietHours: Bool { didSet { defaults.set(quietHours, forKey: "quietHours") } }
    @Published var quietFrom: Int { didSet { defaults.set(quietFrom, forKey: "quietFrom") } }
    @Published var quietTo: Int { didSet { defaults.set(quietTo, forKey: "quietTo") } }
    @Published var messagesOnly: Bool { didSet { defaults.set(messagesOnly, forKey: "messagesOnly") } }
    @Published var fadeColor: Bool { didSet { defaults.set(fadeColor, forKey: "fadeColor") } }
    @Published var timerBar: Bool { didSet { defaults.set(timerBar, forKey: "timerBar") } }
    @Published var strictMode: Bool { didSet { defaults.set(strictMode, forKey: "strictMode") } }
    @Published var startInMessages: Bool { didSet { defaults.set(startInMessages, forKey: "startInMessages") } }

    // The choices offered in Filters. 0 means "off" / "no cap".
    static let dailyChoices = [0, 5, 10, 15, 20, 30, 45, 60]
    static let sessionChoices = [1, 2, 3, 5, 10, 15]
    static let breakChoices = [0, 5, 10, 15, 30, 60]
    static let pauseChoices = [0, 3, 5, 10, 20]

    init() {
        defaults.register(defaults: [
            "blockReelsTab": true,
            "blockFeedReels": true,
            "allowDMReels": true,
            "hideExploreGrid": true,
            "hideAds": true,
            "hideOnline": true,
            "hideTyping": true,
            "followingFeed": true,
            "hasSeenSetup": false,
            "limitsOn": true,
            "dailyMinutes": 20,
            "sessionMinutes": 5,
            "breakMinutes": 10,
            "pauseSeconds": 5,
            "quietHours": false,
            "quietFrom": 23,
            "quietTo": 7,
            "messagesOnly": false,
            "fadeColor": false,
            "timerBar": true,
            "strictMode": false,
            "startInMessages": false,
        ])
        blockReelsTab = defaults.bool(forKey: "blockReelsTab")
        blockFeedReels = defaults.bool(forKey: "blockFeedReels")
        allowDMReels = defaults.bool(forKey: "allowDMReels")
        hideExploreGrid = defaults.bool(forKey: "hideExploreGrid")
        hideAds = defaults.bool(forKey: "hideAds")
        hideOnline = defaults.bool(forKey: "hideOnline")
        hideTyping = defaults.bool(forKey: "hideTyping")
        followingFeed = defaults.bool(forKey: "followingFeed")
        hasSeenSetup = defaults.bool(forKey: "hasSeenSetup")
        limitsOn = defaults.bool(forKey: "limitsOn")
        dailyMinutes = defaults.integer(forKey: "dailyMinutes")
        sessionMinutes = defaults.integer(forKey: "sessionMinutes")
        breakMinutes = defaults.integer(forKey: "breakMinutes")
        pauseSeconds = defaults.integer(forKey: "pauseSeconds")
        quietHours = defaults.bool(forKey: "quietHours")
        quietFrom = defaults.integer(forKey: "quietFrom")
        quietTo = defaults.integer(forKey: "quietTo")
        messagesOnly = defaults.bool(forKey: "messagesOnly")
        fadeColor = defaults.bool(forKey: "fadeColor")
        timerBar = defaults.bool(forKey: "timerBar")
        strictMode = defaults.bool(forKey: "strictMode")
        startInMessages = defaults.bool(forKey: "startInMessages")
    }

    /// "11 PM", "7 AM" for the quiet-hours pickers.
    static func hourLabel(_ hour: Int) -> String {
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve) \(hour < 12 ? "AM" : "PM")"
    }

    private var limitsConfig: String {
        "{on: \(limitsOn), dailyMin: \(dailyMinutes), sessionMin: \(max(1, sessionMinutes)), breakMin: \(breakMinutes), pauseSec: \(pauseSeconds), quiet: \(quietHours), quietFrom: \(quietFrom), quietTo: \(quietTo), messagesOnly: \(messagesOnly), fade: \(fadeColor), timerBar: \(timerBar)}"
    }

    var jsConfig: String {
        "window.__UNREEL__ = {blockReelsTab: \(blockReelsTab), blockFeedReels: \(blockFeedReels), allowDMReels: \(allowDMReels), hideExploreGrid: \(hideExploreGrid), hideAds: \(hideAds), hideOnline: \(hideOnline), hideTyping: \(hideTyping), followingFeed: \(followingFeed), limits: \(limitsConfig)};"
    }
}
