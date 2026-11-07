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
                .opacity(store.hasLoaded ? 1 : 0)
            .animation(.easeOut(duration: 0.25), value: store.hasLoaded)
        }
        // The whole screen ignores the keyboard; WebContainerView makes room for it
        // itself in one instant step. (Ignoring it on the web view alone still let
        // SwiftUI slide the screen around during the keyboard animation.)
        .ignoresSafeArea(.keyboard)
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            QuickActions.install()
            store.apply(settings, reloadIfChanged: false)
            MessageNotifier.shared.setEnabled(settings.notifications)
            if let thread = router.pendingThread {
                router.pendingThread = nil
                store.openThread(thread)
            } else if let url = pendingURL {
                store.open(url)
            } else if let action = router.pendingAction {
                router.pendingAction = nil
                store.perform(action)
            } else {
                store.loadLastLocation()
            }
            if !settings.hasSeenSetup { showSetup = true }
        }
        .onReceive(router.$pendingThread) { thread in
            guard didLoad, let thread else { return }
            router.pendingThread = nil
            store.openThread(thread)
        }
        .onChange(of: settings.notifications) { _, on in
            MessageNotifier.shared.setEnabled(on)
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
            SettingsView(openEditProfile: {
                store.webView.load(URLRequest(url: URL(string: "accounts/edit/", relativeTo: WebViewStore.home)!))
            }, resetCache: {
                store.resetCache()
            })
        }
        .sheet(isPresented: $showSetup, onDismiss: { settings.hasSeenSetup = true }) {
            NavigationStack { SetupGuideView() }
        }
    }
}
