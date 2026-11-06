import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: FilterSettings
    @Environment(\.dismiss) private var dismiss
    var openEditProfile: () -> Void

    init(openEditProfile: @escaping () -> Void = {}) {
        self.openEditProfile = openEditProfile
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
                } footer: {
                    Text("Search still works with the Explore grid hidden. Hiding ads removes sponsored posts from the feed and skips sponsored Stories.")
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
