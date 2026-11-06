import UIKit

/// Native haptic taps requested by filter.js.
@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()

    static func play(_ style: String) {
        switch style {
        case "medium": medium.impactOccurred()
        case "selection": selection.selectionChanged()
        default: light.impactOccurred()
        }
    }
}
