import PhotosUI
import SwiftUI
import UIKit

/// Native message bar shown in chats, laid out like the Instagram app:
/// camera · text field · mic · gallery · stickers · more (or Send while typing).
struct ComposerBar: View {
    @ObservedObject var store: WebViewStore

    @State private var text = ""
    @State private var sending = false
    @State private var showCamera = false
    @State private var photoItems: [PhotosPickerItem] = []

    private let accent = Color(red: 0.47, green: 0.33, blue: 0.98)   // Instagram's DM purple
    private let failed = UINotificationFeedbackGenerator()

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        HStack(alignment: .bottom, spacing: 14) {
            Button { showCamera = true } label: {
                Image(systemName: "camera.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(accent))
            }

            TextField("Message...", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .font(.system(size: 17))
                .padding(.vertical, 9)

            if trimmed.isEmpty {
                HStack(spacing: 18) {
                    icon("mic") { store.showWebComposer("voice") }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 10, matching: .images) {
                        Image(systemName: "photo").font(.system(size: 21))
                    }
                    icon("ellipsis.message") { store.showWebComposer("sticker") }
                    icon("plus.circle") { store.showWebComposer("more") }
                }
                .foregroundStyle(.primary)
                .padding(.bottom, 9)
            } else {
                Button(action: send) {
                    Text("Send").font(.system(size: 17, weight: .semibold)).foregroundStyle(accent)
                }
                .disabled(sending)
                .padding(.bottom, 9)
            }
        }
        .padding(.leading, 5)
        .padding(.trailing, 14)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? .black : .systemGray6 }))
        )
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(Color(uiColor: store.pageColor))
        .onChange(of: photoItems) { _, items in sendPhotos(items) }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(isPresented: $showCamera) { image in
                if let data = image.jpegForUpload() { sendImageData([data]) }
            }
            .ignoresSafeArea()
        }
    }

    private func icon(_ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: name).font(.system(size: 21)) }
    }

    private func send() {
        let message = trimmed
        guard !message.isEmpty, !sending else { return }
        text = ""            // clear right away, like the app
        sending = true
        Task {
            let ok = await store.sendMessage(message)
            sending = false
            if !ok {
                if text.isEmpty { text = message }   // put it back so nothing is lost
                failed.notificationOccurred(.error)
            }
        }
    }

    private func sendPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photoItems = []
        Task {
            var images: [Data] = []
            for item in items {
                if let raw = try? await item.loadTransferable(type: Data.self),
                   let jpeg = UIImage(data: raw)?.jpegForUpload() {
                    images.append(jpeg)
                }
            }
            sendImageData(images)
        }
    }

    private func sendImageData(_ images: [Data]) {
        Task {
            if !(await store.sendImages(images)) { failed.notificationOccurred(.error) }
        }
    }
}

// MARK: - Camera

struct CameraPicker: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    var onPhoto: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.isPresented = false
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.isPresented = false }
    }
}

// MARK: - Image prep

extension UIImage {
    /// A JPEG no larger than `maxDimension` on its longest side, upright.
    func jpegForUpload(maxDimension: CGFloat = 2048, quality: CGFloat = 0.85) -> Data? {
        let longest = max(size.width, size.height)
        let scale = min(1, maxDimension / longest)
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}
