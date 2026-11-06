import SwiftUI
import UIKit
import WebKit

struct InstagramWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WebContainerView {
        let container = WebContainerView(webView: webView)
        KeyboardTracker.shared.container = container
        return container
    }

    func updateUIView(_ uiView: WebContainerView, context: Context) {}
}

/// Holds the web view and makes room for the keyboard itself.
///
/// The keyboard was laggy because two things reacted to it at once: SwiftUI
/// animated the web view smaller while WebKit scrolled the page to reveal the
/// text box, and the two fought every frame. Now SwiftUI ignores the keyboard,
/// and KeyboardTracker shrinks the web view in one step *before* WebKit hears
/// about the keyboard, so WebKit sees the text box is already visible and leaves
/// the page alone.
final class WebContainerView: UIView {
    let webView: WKWebView

    var bottomInset: CGFloat = 0 {
        didSet {
            guard bottomInset != oldValue else { return }
            setNeedsLayout()
            layoutIfNeeded()   // apply now, synchronously
        }
    }

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        addSubview(webView)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = CGSize(width: bounds.width, height: max(0, bounds.height - bottomInset))
        // Set bounds/center (not frame) so the back-swipe transform keeps working.
        webView.bounds = CGRect(origin: .zero, size: size)
        webView.center = CGPoint(x: size.width / 2, y: size.height / 2)
    }
}

/// Watches the keyboard. Started at app launch, so its observer is registered
/// before WebKit's and always runs first.
@MainActor
final class KeyboardTracker {
    static let shared = KeyboardTracker()
    weak var container: WebContainerView?
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        let center = NotificationCenter.default
        center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: nil) { note in
            MainActor.assumeIsolated { KeyboardTracker.shared.keyboardWillChange(note) }
        }
        center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: nil) { _ in
            MainActor.assumeIsolated { KeyboardTracker.shared.container?.bottomInset = 0 }
        }
        center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: nil) { _ in
            MainActor.assumeIsolated { KeyboardTracker.shared.settlePage() }
        }
    }

    private func keyboardWillChange(_ note: Notification) {
        guard let container, let screen = container.window?.screen,
              let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let keyboard = container.convert(end, from: screen.coordinateSpace)
        container.bottomInset = max(0, container.bounds.maxY - keyboard.minY)
    }

    /// In chats the page itself shouldn't scroll; undo any nudge in one step.
    private func settlePage() {
        guard let scrollView = container?.webView.scrollView, !scrollView.isScrollEnabled else { return }
        let rest = CGPoint(x: 0, y: -scrollView.adjustedContentInset.top)
        if scrollView.contentOffset != rest { scrollView.setContentOffset(rest, animated: false) }
    }
}
