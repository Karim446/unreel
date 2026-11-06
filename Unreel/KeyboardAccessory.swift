import ObjectiveC
import UIKit
import WebKit

extension WKWebView {
    /// Removes the web-style bar (up/down arrows and "Done") shown above the keyboard
    /// when typing in a text field, so typing a message feels like the real app.
    ///
    /// WebKit doesn't offer a setting for this, so we swap the web view's internal
    /// content view to a subclass whose `inputAccessoryView` is nil.
    func hideKeyboardAccessoryBar() {
        guard let contentView = scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }), let baseClass = object_getClass(contentView) else { return }

        let name = "\(baseClass)_UnreelNoAccessory"
        var noBarClass: AnyClass? = NSClassFromString(name)

        if noBarClass == nil, let newClass = objc_allocateClassPair(baseClass, name, 0) {
            let noBar: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            class_addMethod(newClass,
                            #selector(getter: UIResponder.inputAccessoryView),
                            imp_implementationWithBlock(noBar),
                            "@@:")
            objc_registerClassPair(newClass)
            noBarClass = newClass
        }

        if let noBarClass { object_setClass(contentView, noBarClass) }
    }
}
