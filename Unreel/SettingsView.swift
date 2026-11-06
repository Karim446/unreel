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
                } footer: {
                    Text("DM Reels open one at a time. Swiping to another Reel sends you back to the chat.")
                }
                Section {
                    Toggle("Hide the Explore grid", isOn: $settings.hideExploreGrid)
                } footer: {
                    Text("Search still works, so you can find people and accounts.")
                }
                Section("Extras") {
                    NavigationLink("App Icon") { AppIconPicker() }
                    NavigationLink("Bio Fonts") {
                        FancyTextView {
                            dismiss()
                            openEditProfile()
                        }
                    }
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
