import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @State private var showSettings = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            InstagramWebView()
                .ignoresSafeArea(edges: .bottom)

            Button {
                showSettings = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                    if appState.unreadCount > 0 {
                        Text("\(appState.unreadCount)")
                            .font(.system(size: 11, weight: .bold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color.red)
                            .clipShape(Capsule())
                    }
                }
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.ultraThinMaterial)
                .clipShape(Capsule())
            }
            .padding(.top, 8)
            .padding(.trailing, 14)
        }
        .sheet(isPresented: $showSettings) {
            UnreelSettingsView()
                .environmentObject(appState)
        }
    }
}

struct UnreelSettingsView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Focus & Content Blocking") {
                    Toggle("Block Reels Everywhere", isOn: $appState.blockReels)
                    Toggle("Block Sponsored Ads", isOn: $appState.blockSponsoredPosts)
                    Toggle("Hide Explore Grid", isOn: $appState.hideExploreGrid)
                    Toggle("Force Dark Mode", isOn: $appState.forceDarkMode)
                }

                Section {
                    Toggle("Background Silent Audio Keep-Alive", isOn: $appState.backgroundKeepAliveEnabled)

                    HStack {
                        Text("Inbox Sync Status")
                        Spacer()
                        Text(appState.lastSyncStatus)
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }

                    Button("Sync DM Inbox Now") {
                        Task {
                            await InstagramInboxService.shared.checkInboxNow(reason: "manual_button")
                        }
                    }

                    Button("Open Direct Inbox") {
                        appState.navigateTo(url: URL(string: "https://www.instagram.com/direct/inbox/")!)
                        dismiss()
                    }
                } header: {
                    Text("DM Notifications")
                } footer: {
                    Text("While Unreel is open or backgrounded, DM notifications are delivered via the live WebSocket hook and fixed Mobile API fingerprint. For zero-battery notifications when Unreel is force-closed, run the included ntfy/Bark relay script in relay-server/ which deep-links via unreel://direct.")
                }
            }
            .navigationTitle("Unreel Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
