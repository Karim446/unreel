import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var settings: FilterSettings
    @StateObject private var store = WebViewStore()
    @ObservedObject private var router = AppRouter.shared
    @State private var didLoad = false
    @State private var showSetup = false
    @State private var pendingURL: URL?

    var body: some View {
        ZStack {
            // Matches Instagram's white/black background so there's no flash or seam.
            Color(.systemBackground).ignoresSafeArea()

            InstagramWebView(webView: store.webView)
                .opacity(store.hasLoaded ? 1 : 0)
                .animation(.easeOut(duration: 0.25), value: store.hasLoaded)
        }
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            QuickActions.install()
            store.apply(settings, reloadIfChanged: false)
            if let url = pendingURL { store.open(url) } else { store.loadHome() }
            if !settings.hasSeenSetup { showSetup = true }
        }
        .onOpenURL { url in
            if didLoad { store.open(url) } else { pendingURL = url }
        }
        .sheet(isPresented: $router.showSettings, onDismiss: {
            store.apply(settings, reloadIfChanged: true)
        }) {
            SettingsView()
        }
        .sheet(isPresented: $showSetup, onDismiss: { settings.hasSeenSetup = true }) {
            NavigationStack { SetupGuideView() }
        }
    }
}
