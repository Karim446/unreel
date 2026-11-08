import SwiftUI
import WebKit

struct SettingsView: View {
    @EnvironmentObject private var settings: FilterSettings
    @Environment(\.dismiss) private var dismiss
    var openEditProfile: () -> Void
    var resetCache: () -> Void
    @State private var confirmReset = false
    @State private var relayCopyStatus = ""

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
            let message = values["sessionid"] == nil
                ? "Not logged in: open Instagram in Unreel first."
                : "Copied. Paste it only into your own relay."
            Task { @MainActor in relayCopyStatus = message }
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
                    Toggle("Home shows the Following feed", isOn: $settings.followingFeed)
                } footer: {
                    Text("Only posts from accounts you follow, newest first, with no suggested posts. It ends when you've seen everything new.")
                }
                Section {
                    Toggle("Hide the Explore grid", isOn: $settings.hideExploreGrid)
                    Toggle("Hide ads", isOn: $settings.hideAds)
                    Toggle("Hide my online status", isOn: $settings.hideOnline)
                    Toggle("Hide when I'm typing", isOn: $settings.hideTyping)
                } footer: {
                    Text("Search still works with the Explore grid hidden. Hiding ads removes sponsored posts from the feed and skips sponsored Stories. Hiding your online status stops sending \"Active now\", and hiding typing stops \"typing…\" from showing to others. You still see theirs.")
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
                    Text("Peek: long-press a chat in your inbox to read it without sending \"Seen\". Long-press a photo, video, profile picture or caption to save it, view it full size, or copy the text.")
                }
                Section {
                    Button("Copy Login for Relay Server") { copyRelayLogin() }
                    if !relayCopyStatus.isEmpty {
                        Text(relayCopyStatus).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Notification relay")
                } footer: {
                    Text("Only needed if your server says the Instagram login needs attention: this copies your Instagram session so you can log the relay back in. Treat it like a password and paste it only into your own server.")
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
