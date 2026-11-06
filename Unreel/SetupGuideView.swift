import SwiftUI

struct SetupGuideView: View {
    @Environment(\.dismiss) private var dismiss

    private let steps = [
        "Open Shortcuts and go to the Automation tab.",
        "Tap + (New Automation), then choose App.",
        "Choose Instagram, check \"Is Opened\", and select \"Run Immediately\".",
        "Tap Next, then New Blank Automation.",
        "Add the \"Open App\" action and pick Unreel.",
        "Tap Done. Opening Instagram now lands you in Unreel.",
    ]

    var body: some View {
        List {
            Section {
                Text("Keep the Instagram icon where it is. This automation sends every tap on it to Unreel instead.")
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
