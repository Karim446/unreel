import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: FilterSettings
    @Environment(\.dismiss) private var dismiss

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
                    Toggle("Block Explore", isOn: $settings.blockExplore)
                }
                Section {
                    NavigationLink("Set up Instagram redirect") { SetupGuideView() }
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
