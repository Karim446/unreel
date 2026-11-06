import SwiftUI

struct SetupGuideView: View {
    @Environment(\.dismiss) private var dismiss

    private let steps = [
        "Open Shortcuts and go to the Automation tab.",
        "Tap + (New Automation), then choose App.",
        "Choose Instagram, check \"Is Opened\", and select \"Run Immediately\".",
        "Tap Next, then New Blank Automation.",
        "Add the \"Open URLs\" action and enter unreel://inbox",
        "Tap Done. Opening the real Instagram (or tapping one of its notifications) now lands you in your DMs here.",
        "Optional: long-press the real Instagram icon → Remove App → Remove from Home Screen. Don't choose Hide, which silences its notifications.",
    ]

    var body: some View {
        List {
            Section {
                Text("This automation sends every launch of the real Instagram app to Unreel instead. Instagram stays installed so its notifications keep working.")
                    .foregroundStyle(.secondary)
            }
            Section("Steps") {
                ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(i + 1)").font(.headline).frame(width: 22)
                        Text(step)
                    }
                }
            }
            Section {
                Text("Settings are hidden. Shake your phone, or long-press the Unreel icon and choose Filters.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Open Shortcuts") {
                    if let url = URL(string: "shortcuts://") { UIApplication.shared.open(url) }
                }
            }
        }
        .navigationTitle("Instagram Redirect")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }
}
