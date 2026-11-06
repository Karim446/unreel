import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var settings: FilterSettings
    @StateObject private var store = WebViewStore()
    @State private var didLoad = false
    @State private var showSettings = false
    @State private var showSetup = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { store.goBack() } label: { Image(systemName: "chevron.left") }
                    .disabled(!store.canGoBack)
                Button { store.loadHome() } label: { Image(systemName: "house") }
                Spacer()
                Text("Unreel").font(.subheadline.weight(.semibold))
                Spacer()
                Button { showSettings = true } label: { Image(systemName: "slider.horizontal.3") }
            }
            .padding(.horizontal, 16)
            .frame(height: 36)

            Divider()

            InstagramWebView(webView: store.webView)
                .ignoresSafeArea(edges: .bottom)
        }
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            store.apply(settings, reloadIfChanged: false)
            store.loadHome()
            if !settings.hasSeenSetup { showSetup = true }
        }
        .sheet(isPresented: $showSettings, onDismiss: {
            store.apply(settings, reloadIfChanged: true)
        }) {
            SettingsView()
        }
        .sheet(isPresented: $showSetup, onDismiss: { settings.hasSeenSetup = true }) {
            NavigationStack { SetupGuideView() }
        }
    }
}
