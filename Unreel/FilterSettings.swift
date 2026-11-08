import Foundation

/// User toggles, persisted in UserDefaults and handed to filter.js as window.__UNREEL__.
final class FilterSettings: ObservableObject {
    private let defaults = UserDefaults.standard

    @Published var blockReelsTab: Bool { didSet { defaults.set(blockReelsTab, forKey: "blockReelsTab") } }
    @Published var blockFeedReels: Bool { didSet { defaults.set(blockFeedReels, forKey: "blockFeedReels") } }
    @Published var allowDMReels: Bool { didSet { defaults.set(allowDMReels, forKey: "allowDMReels") } }
    @Published var hideExploreGrid: Bool { didSet { defaults.set(hideExploreGrid, forKey: "hideExploreGrid") } }
    @Published var hideAds: Bool { didSet { defaults.set(hideAds, forKey: "hideAds") } }
    @Published var hideOnline: Bool { didSet { defaults.set(hideOnline, forKey: "hideOnline") } }
    @Published var hideTyping: Bool { didSet { defaults.set(hideTyping, forKey: "hideTyping") } }
    @Published var followingFeed: Bool { didSet { defaults.set(followingFeed, forKey: "followingFeed") } }
    @Published var notifications: Bool { didSet { defaults.set(notifications, forKey: "notifications") } }
    @Published var hasSeenSetup: Bool { didSet { defaults.set(hasSeenSetup, forKey: "hasSeenSetup") } }

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
            "notifications": true,
            "hasSeenSetup": false,
        ])
        blockReelsTab = defaults.bool(forKey: "blockReelsTab")
        blockFeedReels = defaults.bool(forKey: "blockFeedReels")
        allowDMReels = defaults.bool(forKey: "allowDMReels")
        hideExploreGrid = defaults.bool(forKey: "hideExploreGrid")
        hideAds = defaults.bool(forKey: "hideAds")
        hideOnline = defaults.bool(forKey: "hideOnline")
        hideTyping = defaults.bool(forKey: "hideTyping")
        followingFeed = defaults.bool(forKey: "followingFeed")
        notifications = defaults.bool(forKey: "notifications")
        hasSeenSetup = defaults.bool(forKey: "hasSeenSetup")
    }

    var jsConfig: String {
        "window.__UNREEL__ = {blockReelsTab: \(blockReelsTab), blockFeedReels: \(blockFeedReels), allowDMReels: \(allowDMReels), hideExploreGrid: \(hideExploreGrid), hideAds: \(hideAds), hideOnline: \(hideOnline), hideTyping: \(hideTyping), followingFeed: \(followingFeed)};"
    }
}
