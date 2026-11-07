import SwiftUI
import WebKit

struct SettingsView: View {
    @EnvironmentObject private var settings: FilterSettings
    @Environment(\.dismiss) private var dismiss
    var openEditProfile: () -> Void
    var resetCache: () -> Void
    @State private var confirmReset = false
    @ObservedObject private var notifier = MessageNotifier.shared

    /// Copies the Instagram cookies the relay's bridge asks for, as JSON.
    private func copyRelayLogin() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let wanted = ["sessionid", "csrftoken", "ds_user_id", "mid", "ig_did", "rur", "datr"]
            var values: [String: String] = [:]
            for c in cookies where c.domain.contains("instagram.com") && wanted.contains(c.name) {
                values[c.name] = c.value
            }
            let data = (try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])) ?? Data()
            UIPasteboard.general.string = String(data: data, encoding: .utf8)
            Task { @MainActor in
                MessageNotifier.shared.status = values["sessionid"] == nil
                    ? "Not logged in: open Instagram in Unreel first."
                    : "Copied \(values.count) cookies. Paste them only into your own relay."
            }
        }
    }

    init(openEditProfile: @escaping () -> Void = {}, resetCache: @escaping () -> Void = {}) {
        self.openEditProfile = openEditProfile
        self.resetCache = resetCache
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Block the Reels tab", isOn: $settings.blockReelsTab)
                    Toggle("Block Reels in the feed", isOn: $settings.blockFeedReels)
                    Toggle("Allow Reels sent in DMs", isOn: $settings.allowDMReels)
                        .disabled(!settings.blockReelsTab)
                } footer: {
                    Text(settings.blockReelsTab
                         ? "With the Reels tab blocked, Reels only play when opened from a DM, one at a time; swiping to another sends you back to the chat. \"Block Reels in the feed\" hides every video post on the home feed."
                         : "The Reels tab is back and works normally. \"Block Reels in the feed\" still hides every video post on the home feed.")
                }
                Section {
                    Toggle("Hide the Explore grid", isOn: $settings.hideExploreGrid)
                    Toggle("Hide ads", isOn: $settings.hideAds)
                    Toggle("Hide my online status", isOn: $settings.hideOnline)
                } footer: {
                    Text("Search still works with the Explore grid hidden. Hiding ads removes sponsored posts from the feed and skips sponsored Stories. Hiding your online status stops sending \"Active now\" and \"typing…\" while you still see others'.")
                }
                Section {
                    NavigationLink("App Icon") { AppIconPicker() }
                    NavigationLink("Bio Fonts") {
                        FancyTextView {
                            dismiss()
                            openEditProfile()
                        }
                    }
                } header: {
                    Text("Extras")
                } footer: {
                    Text("Peek: long-press a chat in your inbox to read it without sending \"Seen\". Tap \"Mark as read\" in the chat when you're ready.")
                }
                Section {
                    Toggle("Alert on new unread DMs while app is running", isOn: $settings.notifications)
                    Button("Test Inbox Check") { Task { await notifier.testCheck() } }
                    Text(notifier.status).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                    Button("Copy Login for Relay Server") { copyRelayLogin() }
                } header: {
                    Text("Notifications (experimental)")
                } footer: {
                    Text("Unread alerts reuse the Inbox badge count and cannot reliably run while Unreel is closed. Test Inbox Check still probes the old failing inbox endpoint. Copy Login copies your Instagram session cookies so the relay server can connect as you. Treat it like a password: paste it only into your own server.")
                }
                Section {
                    Button("Reset Cache", role: .destructive) { confirmReset = true }
                } footer: {
                    Text("Fixes most display problems: clears saved pages, images and layout data and reloads. You stay logged in.")
                }
                Section {
                    NavigationLink("Set up Instagram redirect") { SetupGuideView() }
                } footer: {
                    Text("To get back here, shake your phone or long-press the app icon and choose Filters.")
                }
                Section {
                    LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")
                } footer: {
                    Text("Matches the run number on GitHub Actions, so you can confirm which version is installed.")
                }
            }
            .confirmationDialog("Reset cache?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset Cache", role: .destructive) {
                    dismiss()
                    resetCache()
                }
            } message: {
                Text("Unreel will reload. You'll stay logged in.")
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
