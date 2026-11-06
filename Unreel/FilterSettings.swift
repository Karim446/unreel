import Foundation

/// User toggles, persisted in UserDefaults and handed to filter.js as window.__UNREEL__.
final class FilterSettings: ObservableObject {
    private let defaults = UserDefaults.standard

    @Published var blockReelsTab: Bool { didSet { defaults.set(blockReelsTab, forKey: "blockReelsTab") } }
    @Published var blockFeedReels: Bool { didSet { defaults.set(blockFeedReels, forKey: "blockFeedReels") } }
    @Published var allowDMReels: Bool { didSet { defaults.set(allowDMReels, forKey: "allowDMReels") } }
    @Published var hideExploreGrid: Bool { didSet { defaults.set(hideExploreGrid, forKey: "hideExploreGrid") } }
    @Published var nativeComposer: Bool { didSet { defaults.set(nativeComposer, forKey: "nativeComposer") } }
    @Published var hasSeenSetup: Bool { didSet { defaults.set(hasSeenSetup, forKey: "hasSeenSetup") } }

    init() {
        defaults.register(defaults: [
            "blockReelsTab": true,
            "blockFeedReels": true,
            "allowDMReels": true,
            "hideExploreGrid": true,
            "nativeComposer": true,
            "hasSeenSetup": false,
        ])
        blockReelsTab = defaults.bool(forKey: "blockReelsTab")
        blockFeedReels = defaults.bool(forKey: "blockFeedReels")
        allowDMReels = defaults.bool(forKey: "allowDMReels")
        hideExploreGrid = defaults.bool(forKey: "hideExploreGrid")
        nativeComposer = defaults.bool(forKey: "nativeComposer")
        hasSeenSetup = defaults.bool(forKey: "hasSeenSetup")
    }

    var jsConfig: String {
        "window.__UNREEL__ = {blockReelsTab: \(blockReelsTab), blockFeedReels: \(blockFeedReels), allowDMReels: \(allowDMReels), hideExploreGrid: \(hideExploreGrid), nativeComposer: \(nativeComposer)};"
    }
}
