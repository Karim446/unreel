import SwiftUI

@main
struct UnreelApp: App {
    @StateObject private var settings = FilterSettings()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
        }
    }
}
