import AVFoundation
import Foundation
import UIKit

// Enregistreur natif : continue écran verrouillé (mode « audio » en arrière-plan, Info.plist),
// se met en pause pendant un appel et reprend après, envoie automatiquement à l'arrêt.
//
// Sécurités pour ne JAMAIS perdre un cours :
// - l'audio est écrit en tranches de 10 min (Documents/Enregistrements/<cours>/) : un plantage ou une batterie vide
//   ne coûte au pire que la tranche en cours ;
// - l'app fermée depuis le sélecteur d'apps : la tranche en cours est finalisée avant la fermeture (applicationWillTerminate) ;
// - à la réouverture, tout enregistrement interrompu est réassemblé et mis dans la file d'envoi (voir Uploader) ;
// - un fichier n'est effacé du téléphone qu'une fois reçu par le serveur.
final class Recorder: NSObject {
    static let shared = Recorder()
    static let segmentSeconds: TimeInterval = 600

    private(set) var course = ""
    private var recorder: AVAudioRecorder?
    private var uploadURL: URL?
    private var startedAt = Date()
    private var pausedByUser = false
    private var folder: URL?
    private var segment = 0
    private var doneSeconds: TimeInterval = 0 // durée des tranches déjà terminées
    private var rotation: Timer?

    var isRecording: Bool { recorder?.isRecording ?? false }
    var isActive: Bool { recorder != nil }
    var elapsed: TimeInterval { doneSeconds + (recorder?.currentTime ?? 0) }

    static var root: URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Enregistrements", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private let settings: [String: Any] = [ // AAC mono 48 kb/s : ~20 Mo pour 1 h, largement suffisant pour Whisper
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 22_050,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 48_000,
    ]

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
        let dir = Recorder.root.appendingPathComponent("Cours \(stamp.string(from: startedAt))", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Ce qu'il faut pour renvoyer l'enregistrement même si l'app est tuée
        let meta = ["course": course, "url": uploadURL.absoluteString]
        try JSONSerialization.data(withJSONObject: meta).write(to: dir.appendingPathComponent("infos.json"))

        folder = dir
        segment = 0
        doneSeconds = 0
        self.course = course
        self.uploadURL = uploadURL
        pausedByUser = false
        UserDefaults.standard.set(uploadURL.absoluteString, forKey: "uploadURL")
        try startSegment()
        rotation = Timer.scheduledTimer(withTimeInterval: Recorder.segmentSeconds, repeats: true) { [weak self] _ in self?.rotate() }
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        LiveActivity.start(course: course, startedAt: startedAt)
    }

    private func startSegment() throws {
        guard let dir = folder else { return }
        segment += 1
        let rec = try AVAudioRecorder(url: dir.appendingPathComponent(String(format: "partie %03d.m4a", segment)), settings: settings)
        guard rec.record() else { throw RecorderError.cannotStart }
        recorder = rec
    }

    // Tranche suivante : la précédente est finalisée (lisible quoi qu'il arrive ensuite)
    private func rotate() {
        guard let rec = recorder, !pausedByUser else { return }
        let wasRecording = rec.isRecording
        doneSeconds += rec.currentTime
        rec.stop()
        do {
            try startSegment()
            if !wasRecording { recorder?.pause() }
        } catch {
            recorder = nil // ne devrait pas arriver ; l'audio déjà enregistré reste sauvegardé
        }
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

    /// Arrête, réassemble les tranches, et met le fichier dans la file d'envoi.
    @discardableResult
    func stopAndUpload() -> (file: URL, duration: TimeInterval)? {
        guard let rec = recorder, let dir = folder else { return nil }
        let duration = elapsed
        finish(rec)
        // la dernière tranche finit de s'écrire sur le disque juste après stop() : on lui laisse une seconde
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { Recorder.finalize(folder: dir) }
        return (dir, duration)
    }

    /// L'app va être fermée (sélecteur d'apps) : on finalise la tranche en cours, l'envoi se fera à la réouverture.
    func terminate() {
        guard let rec = recorder else { return }
        finish(rec)
    }

    private func finish(_ rec: AVAudioRecorder) {
        rec.stop()
        recorder = nil
        folder = nil
        rotation?.invalidate()
        rotation = nil
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        LiveActivity.end()
    }

    /// Réassemble les tranches d'un dossier en un seul fichier, le met dans la file d'envoi, puis supprime le dossier.
    /// Si l'assemblage échoue, chaque tranche est envoyée telle quelle : rien n'est jamais jeté.
    static func finalize(folder: URL) {
        let fm = FileManager.default
        let parts = ((try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? [])
            .filter { $0.pathExtension == "m4a" && ((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 0 }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        let meta = (try? JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("infos.json")))) as? [String: String] ?? [:]
        let course = meta["course"] ?? ""
        let url = URL(string: meta["url"] ?? "") ?? UserDefaults.standard.string(forKey: "uploadURL").flatMap(URL.init)
        guard !parts.isEmpty else { try? fm.removeItem(at: folder); return }
        guard !finalizing.contains(folder.path) else { return } // déjà en cours (ouverture + retour au premier plan)
        finalizing.insert(folder.path)
        let out = Uploader.outbox.appendingPathComponent(folder.lastPathComponent + ".m4a")
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "assemblage") { UIApplication.shared.endBackgroundTask(task) }
        let done = { finalizing.remove(folder.path); UIApplication.shared.endBackgroundTask(task) }

        let sendParts = { // repli : les tranches une par une
            for (i, p) in parts.enumerated() {
                let dest = Uploader.outbox.appendingPathComponent("\(folder.lastPathComponent) partie \(i + 1).m4a")
                try? fm.moveItem(at: p, to: dest)
                Uploader.shared.enqueue(file: dest, course: course, url: url)
            }
            try? fm.removeItem(at: folder)
        }
        if parts.count == 1 {
            try? fm.moveItem(at: parts[0], to: out)
            Uploader.shared.enqueue(file: out, course: course, url: url)
            try? fm.removeItem(at: folder)
            done()
            return
        }
        Task {
            let comp = AVMutableComposition()
            let track = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            var cursor = CMTime.zero
            for p in parts { // une tranche illisible (coupée net) est ignorée ici, mais gardée par le repli si besoin
                let asset = AVURLAsset(url: p)
                guard let src = try? await asset.loadTracks(withMediaType: .audio).first,
                      let range = try? await src.load(.timeRange), range.duration.seconds > 0 else { continue }
                try? track?.insertTimeRange(range, of: src, at: cursor)
                cursor = cursor + range.duration
            }
            // 1) sans réencodage (quelques secondes même pour 2 h) ; 2) sinon réencodé (plus long, mais accepté partout)
            var ok = false
            for preset in [AVAssetExportPresetPassthrough, AVAssetExportPresetAppleM4A] where !ok && cursor.seconds > 0 {
                try? fm.removeItem(at: out)
                guard let export = AVAssetExportSession(asset: comp, presetName: preset) else { continue }
                export.outputURL = out
                export.outputFileType = .m4a
                await export.export()
                ok = export.status == .completed
            }
            await MainActor.run {
                if ok {
                    Uploader.shared.enqueue(file: out, course: course, url: url)
                    try? fm.removeItem(at: folder)
                } else { sendParts() }
                done()
            }
        }
    }

    private static var finalizing = Set<String>()

    /// À l'ouverture de l'app : enregistrements interrompus (app tuée, plantage, ancienne version) → file d'envoi.
    static func recoverInterrupted() {
        let fm = FileManager.default
        if shared.isActive { return }
        for dir in (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [] where dir.hasDirectoryPath {
            finalize(folder: dir)
        }
        // Ancienne version : un seul fichier « Cours … .m4a » directement dans Documents
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        for f in (try? fm.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil)) ?? [] where f.pathExtension == "m4a" {
            let dest = Uploader.outbox.appendingPathComponent(f.lastPathComponent)
            if (try? fm.moveItem(at: f, to: dest)) != nil { Uploader.shared.enqueue(file: dest, course: "", url: nil) }
        }
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
