import Foundation
import Photos

/// Saves a photo or video (from a long-press in Unreel) to the Photos library.
@MainActor
enum MediaSaver {
    /// Returns a short message to show the user.
    static func save(urlString: String, isVideo: Bool) async -> String {
        guard let url = URL(string: urlString), url.scheme == "https" else { return "This one can\u{2019}t be saved" }

        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            return "Allow Unreel to add to Photos in iPhone Settings"
        }

        var request = URLRequest(url: url)
        request.setValue(WebViewStore.safariUA, forHTTPHeaderField: "User-Agent")
        request.setValue("https://www.instagram.com/", forHTTPHeaderField: "Referer")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else { return "Download failed" }

            if isVideo {
                let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
                try data.write(to: file)
                defer { try? FileManager.default.removeItem(at: file) }
                try await PHPhotoLibrary.shared().performChanges {
                    _ = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file)
                }
            } else {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
                }
            }
            return isVideo ? "Video saved to Photos" : "Saved to Photos"
        } catch {
            return "Couldn\u{2019}t save: " + error.localizedDescription
        }
    }
}
