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
            // Fills the status-bar and home-indicator areas with Instagram's own background color.
            Color(uiColor: store.pageColor).ignoresSafeArea()

            InstagramWebView(webView: store.webView)
                .ignoresSafeArea(.keyboard)   // the container makes room for the keyboard itself
                .opacity(store.hasLoaded ? 1 : 0)
            .animation(.easeOut(duration: 0.25), value: store.hasLoaded)
        }
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            QuickActions.install()
            store.apply(settings, reloadIfChanged: false)
            if let url = pendingURL {
                store.open(url)
            } else if let action = router.pendingAction {
                router.pendingAction = nil
                store.perform(action)
            } else {
                store.loadLastLocation()
            }
            if !settings.hasSeenSetup { showSetup = true }
        }
        .onReceive(router.$pendingAction) { action in
            guard didLoad, let action else { return }
            router.pendingAction = nil
            store.perform(action)
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
