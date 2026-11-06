import SwiftUI
import UIKit

/// Lets you switch the Home Screen icon (Filters → App Icon).
///
/// To add your own: put a 1024×1024 PNG in a new `AppIcon-<Name>.appiconset`
/// (and a small `IconPreview-<Name>.imageset`), add `AppIcon-<Name>` to
/// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES in project.yml, and add the
/// name to `choices` below.
struct AppIconPicker: View {
    private struct Choice: Identifiable {
        let name: String
        let iconName: String?        // nil = the main icon
        var id: String { name }
    }

    private let choices: [Choice] = [
        Choice(name: "Classic", iconName: nil),
        Choice(name: "Unreel", iconName: "AppIcon-Unreel"),
        Choice(name: "Midnight", iconName: "AppIcon-Midnight"),
        Choice(name: "Ocean", iconName: "AppIcon-Ocean"),
        Choice(name: "Mono", iconName: "AppIcon-Mono"),
    ]

    @State private var current = UIApplication.shared.alternateIconName
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 92), spacing: 18)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 22) {
                ForEach(choices) { choice in
                    Button { select(choice) } label: {
                        VStack(spacing: 8) {
                            Image("IconPreview-\(choice.name)")
                                .resizable()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .stroke(current == choice.iconName ? Color.accentColor : .clear, lineWidth: 3)
                                        .padding(-4)
                                )
                            Text(choice.name)
                                .font(.footnote)
                                .foregroundStyle(current == choice.iconName ? .primary : .secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)

            if let error {
                Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal)
            }
        }
        .navigationTitle("App Icon")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func select(_ choice: Choice) {
        guard choice.iconName != current else { return }
        UIApplication.shared.setAlternateIconName(choice.iconName) { err in
            Task { @MainActor in
                if let err { error = err.localizedDescription } else { current = choice.iconName; error = nil }
            }
        }
    }
}
