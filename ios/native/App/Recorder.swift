import AVFoundation
import Foundation

// Enregistreur natif : continue écran verrouillé (mode « audio » en arrière-plan, Info.plist),
// se met en pause pendant un appel et reprend après, envoie automatiquement à l'arrêt.
final class Recorder: NSObject {
    static let shared = Recorder()

    private(set) var course = ""
    private var recorder: AVAudioRecorder?
    private var uploadURL: URL?
    private var startedAt = Date()
    private var pausedByUser = false

    var isRecording: Bool { recorder?.isRecording ?? false }
    var isActive: Bool { recorder != nil }
    var elapsed: TimeInterval { recorder?.currentTime ?? 0 }

    func start(course: String, uploadURL: URL) throws {
        guard recorder == nil else { throw RecorderError.alreadyRecording }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        // Nom daté sans accent : le serveur relie l'enregistrement au bon cours d'après la date et l'heure
        startedAt = Date()
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "fr_FR")
        stamp.timeZone = TimeZone(identifier: "Europe/Paris")
        stamp.dateFormat = "yyyy-MM-dd HH'h'mm"
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Cours \(stamp.string(from: startedAt)).m4a")

        // AAC mono 48 kb/s : ~20 Mo pour 1 h, largement suffisant pour Whisper
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 22_050,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
        ]
        let rec = try AVAudioRecorder(url: file, settings: settings)
        guard rec.record() else { throw RecorderError.cannotStart }
        recorder = rec
        self.course = course
        self.uploadURL = uploadURL
        pausedByUser = false
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        LiveActivity.start(course: course, startedAt: startedAt)
    }

    func pause() {
        pausedByUser = true
        recorder?.pause()
        LiveActivity.update(paused: true, elapsed: elapsed)
    }

    func resume() {
        pausedByUser = false
        recorder?.record()
        LiveActivity.update(paused: false, elapsed: elapsed)
    }

    /// Arrête, envoie à l'app ECAM et renvoie le fichier enregistré.
    @discardableResult
    func stopAndUpload() -> (file: URL, duration: TimeInterval)? {
        guard let rec = recorder, let target = uploadURL else { return nil }
        let duration = rec.currentTime
        rec.stop()
        recorder = nil
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        LiveActivity.end()
        Uploader.shared.send(file: rec.url, to: target, course: course)
        return (rec.url, duration)
    }

    // Appel téléphonique, alarme… : iOS coupe le micro ; on reprend tout seul ensuite
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            LiveActivity.update(paused: true, elapsed: elapsed)
        case .ended:
            guard !pausedByUser else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            recorder?.record()
            LiveActivity.update(paused: false, elapsed: elapsed)
        @unknown default:
            break
        }
    }
}

enum RecorderError: LocalizedError {
    case alreadyRecording, cannotStart, micDenied
    var errorDescription: String? {
        switch self {
        case .alreadyRecording: return "Un enregistrement est déjà en cours"
        case .cannotStart: return "Impossible de démarrer l'enregistrement"
        case .micDenied: return "Accès au micro refusé (Réglages → ECAM → Micro)"
        }
    }
}
