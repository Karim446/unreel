import SwiftUI
import UIKit

/// "Fancy text": letters swapped for look-alike Unicode characters, so a bio
/// can appear in another font. Everyone sees it, since it's just text.
enum FancyText {
    struct Style: Identifiable {
        let name: String
        let transform: (Character) -> String
        var id: String { name }
        func apply(_ text: String) -> String { text.map(transform).joined() }
    }

    /// Maps A–Z, a–z and 0–9 onto a block of Unicode letters starting at the given code points.
    private static func block(upper: UInt32?, lower: UInt32?, digit: UInt32? = nil,
                              exceptions: [Character: UInt32] = [:]) -> (Character) -> String {
        return { ch in
            if let special = exceptions[ch], let scalar = Unicode.Scalar(special) { return String(Character(scalar)) }
            guard ch.unicodeScalars.count == 1, let v = ch.unicodeScalars.first?.value else { return String(ch) }
            let mapped: UInt32?
            switch v {
            case 65...90: mapped = upper.map { $0 + v - 65 }
            case 97...122: mapped = lower.map { $0 + v - 97 }
            case 48...57: mapped = digit.map { $0 + v - 48 }
            default: mapped = nil
            }
            if let mapped, let scalar = Unicode.Scalar(mapped) { return String(Character(scalar)) }
            return String(ch)
        }
    }

    private static let smallCaps = Array("ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ")

    static let styles: [Style] = [
        Style(name: "Bold", transform: block(upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE)),
        Style(name: "Italic", transform: block(upper: 0x1D434, lower: 0x1D44E, exceptions: ["h": 0x210E])),
        Style(name: "Bold Italic", transform: block(upper: 0x1D468, lower: 0x1D482)),
        Style(name: "Sans Bold", transform: block(upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC)),
        Style(name: "Script", transform: block(upper: 0x1D49C, lower: 0x1D4B6, exceptions: [
            "B": 0x212C, "E": 0x2130, "F": 0x2131, "H": 0x210B, "I": 0x2110, "L": 0x2112,
            "M": 0x2133, "R": 0x211B, "e": 0x212F, "g": 0x210A, "o": 0x2134,
        ])),
        Style(name: "Bold Script", transform: block(upper: 0x1D4D0, lower: 0x1D4EA)),
        Style(name: "Gothic", transform: block(upper: 0x1D504, lower: 0x1D51E, exceptions: [
            "C": 0x212D, "H": 0x210C, "I": 0x2111, "R": 0x211C, "Z": 0x2128,
        ])),
        Style(name: "Double-Struck", transform: block(upper: 0x1D538, lower: 0x1D552, digit: 0x1D7D8, exceptions: [
            "C": 0x2102, "H": 0x210D, "N": 0x2115, "P": 0x2119, "Q": 0x211A, "R": 0x211D, "Z": 0x2124,
        ])),
        Style(name: "Monospace", transform: block(upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6)),
        Style(name: "Small Caps", transform: { ch in
            guard let v = ch.lowercased().unicodeScalars.first?.value, (97...122).contains(v), ch.isLetter else { return String(ch) }
            return String(FancyText.smallCaps[Int(v - 97)])
        }),
        Style(name: "Circled", transform: block(upper: 0x24B6, lower: 0x24D0, digit: 0x245F, exceptions: ["0": 0x24EA])),
    ]
}

struct FancyTextView: View {
    var openEditProfile: () -> Void

    init(openEditProfile: @escaping () -> Void) {
        self.openEditProfile = openEditProfile
    }

    @State private var text = ""
    @State private var copied: String?

    var body: some View {
        List {
            Section {
                TextField("Type your bio text", text: $text, axis: .vertical)
                    .lineLimit(1...4)
            } footer: {
                Text("Tap a style to copy it, then paste it into your bio. Everyone sees it, because it's made of look-alike characters rather than a real font. Screen readers may read it oddly.")
            }

            Section {
                ForEach(FancyText.styles) { style in
                    let sample = style.apply(text.isEmpty ? "Your bio here" : text)
                    Button {
                        UIPasteboard.general.string = sample
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        copied = style.name
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(sample).foregroundStyle(.primary)
                                Text(style.name).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if copied == style.name {
                                Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                }
            }

            Section {
                Button("Open Edit Profile", action: openEditProfile)
            }
        }
        .navigationTitle("Bio Fonts")
        .navigationBarTitleDisplayMode(.inline)
    }
}
