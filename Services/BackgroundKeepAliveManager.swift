import Foundation
import AVFoundation
import BackgroundTasks
import UIKit

final class BackgroundKeepAliveManager {
    static let shared = BackgroundKeepAliveManager()
    static let refreshTaskIdentifier = "com.karim.unreel.inboxrefresh"

    private var audioPlayer: AVAudioPlayer?
    private var pollingTimer: Timer?
    private var isKeepAliveEnabled: Bool = UserDefaults.standard.bool(forKey: "unreel.backgroundKeepAlive")

    private init() {}

    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.refreshTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handleAppRefreshTask(refreshTask)
        }
    }

    func setKeepAliveEnabled(_ enabled: Bool) {
        self.isKeepAliveEnabled = enabled
        if !enabled {
            stopSilentAudioAndTimer()
        }
    }

    func handleAppDidBecomeActive() {
        stopSilentAudioAndTimer()
        Task {
            await InstagramInboxService.shared.checkInboxNow(reason: "foreground")
        }
    }

    func handleAppDidEnterBackground() {
        scheduleNextBGAppRefresh()
        if isKeepAliveEnabled {
            startSilentAudioAndAdaptiveTimer()
        }
    }

    private func scheduleNextBGAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[Unreel] Could not schedule BGAppRefreshTask: \(error.localizedDescription)")
        }
    }

    private func handleAppRefreshTask(_ task: BGAppRefreshTask) {
        scheduleNextBGAppRefresh()

        let checkTask = Task {
            let success = await InstagramInboxService.shared.checkInboxNow(reason: "bg_refresh")
            task.setTaskCompleted(success: success)
        }

        task.expirationHandler = {
            checkTask.cancel()
            task.setTaskCompleted(success: false)
        }
    }

    private func startSilentAudioAndAdaptiveTimer() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            if audioPlayer == nil {
                let wavData = Self.makeSilentWAVData(durationSeconds: 2, sampleRate: 8000)
                audioPlayer = try AVAudioPlayer(data: wavData, fileTypeHint: AVFileType.wav.rawValue)
                audioPlayer?.numberOfLoops = -1
                audioPlayer?.volume = 0.0
                audioPlayer?.prepareToPlay()
            }
            audioPlayer?.play()
            scheduleNextAdaptivePoll()
        } catch {
            print("[Unreel] Silent audio setup error: \(error.localizedDescription)")
        }
    }

    private func scheduleNextAdaptivePoll() {
        pollingTimer?.invalidate()
        let jitteredInterval = Double.random(in: 75.0...115.0)
        pollingTimer = Timer.scheduledTimer(withTimeInterval: jitteredInterval, repeats: false) { [weak self] _ in
            guard let self = self, self.isKeepAliveEnabled else { return }
            Task {
                await InstagramInboxService.shared.checkInboxNow(reason: "background_keepalive")
                await MainActor.run {
                    if UIApplication.shared.applicationState == .background {
                        self.scheduleNextAdaptivePoll()
                    }
                }
            }
        }
    }

    private func stopSilentAudioAndTimer() {
        pollingTimer?.invalidate()
        pollingTimer = nil
        audioPlayer?.stop()
    }

    private static func makeSilentWAVData(durationSeconds: Int, sampleRate: Int) -> Data {
        let numSamples = durationSeconds * sampleRate
        let dataSize = UInt32(numSamples)
        let totalFileSize = 36 + dataSize

        var data = Data()
        data.append("RIFF".data(using: .ascii)!)
        data.append(withUnsafeBytes(of: totalFileSize.littleEndian) { Data($0) })
        data.append("WAVEfmt ".data(using: .ascii)!)

        let fmtChunkSize: UInt32 = 16
        let audioFormat: UInt16 = 1
        let numChannels: UInt16 = 1
        let sr = UInt32(sampleRate)
        let byteRate = sr * 1
        let blockAlign: UInt16 = 1
        let bitsPerSample: UInt16 = 8

        data.append(withUnsafeBytes(of: fmtChunkSize.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: audioFormat.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: numChannels.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: sr.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })

        data.append("data".data(using: .ascii)!)
        data.append(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })
        data.append(Data(repeating: 0x80, count: numSamples))
        return data
    }
}
