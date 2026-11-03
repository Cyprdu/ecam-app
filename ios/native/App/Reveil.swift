import AVFoundation
import Foundation
#if canImport(AlarmKit)
import ActivityKit
import AlarmKit
import SwiftUI
#endif

// Réveil automatique avant le premier cours (AlarmKit, iOS 26) : de vraies alarmes, qui sonnent même en mode silencieux.
// L'app web calcule les heures (premier cours − 1 h) et les envoie ici ; on remplace à chaque fois les alarmes ECAM
// précédentes (identifiants gardés dans UserDefaults), sans toucher aux autres alarmes de l'iPhone.
enum Reveil {
    static let key = "ecamAlarms"

    // Sonnerie choisie par l'étudiant : convertie en .caf (format accepté par iOS pour les alarmes) dans Library/Sounds
    static var soundFile: String? { UserDefaults.standard.string(forKey: "ecamAlarmSound") }
    static var soundLabel: String { UserDefaults.standard.string(forKey: "ecamAlarmSoundLabel") ?? "" }
    private static var soundsDir: URL {
        let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Sounds", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Copie le son choisi en PCM 16 bits, coupé à 30 s ; renvoie son nom d'affichage
    static func importSound(from src: URL) throws -> String {
        resetSound()
        let input = try AVAudioFile(forReading: src)
        let fmt = input.processingFormat
        let name = "ecam-reveil-" + String(Int(Date().timeIntervalSince1970)) + ".caf"
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: fmt.sampleRate, AVNumberOfChannelsKey: fmt.channelCount,
                                       AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
        let out = try AVAudioFile(forWriting: soundsDir.appendingPathComponent(name), settings: settings, commonFormat: fmt.commonFormat, interleaved: fmt.isInterleaved)
        var left = AVAudioFrameCount(min(Double(input.length), fmt.sampleRate * 30))
        guard left > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 8192) else { throw CocoaError(.fileReadCorruptFile) }
        while left > 0 {
            try input.read(into: buf, frameCount: min(8192, left))
            if buf.frameLength == 0 { break }
            try out.write(from: buf)
            left -= min(left, buf.frameLength)
        }
        let label = src.deletingPathExtension().lastPathComponent
        UserDefaults.standard.set(name, forKey: "ecamAlarmSound")
        UserDefaults.standard.set(label, forKey: "ecamAlarmSoundLabel")
        return label
    }

    static func resetSound() {
        for f in (try? FileManager.default.contentsOfDirectory(at: soundsDir, includingPropertiesForKeys: nil)) ?? [] where f.lastPathComponent.hasPrefix("ecam-reveil") {
            try? FileManager.default.removeItem(at: f)
        }
        UserDefaults.standard.removeObject(forKey: "ecamAlarmSound")
        UserDefaults.standard.removeObject(forKey: "ecamAlarmSoundLabel")
    }

    static var available: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// "authorized" | "denied" | "notDetermined" | "unavailable"
    static func status() -> String {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            switch AlarmManager.shared.authorizationState {
            case .authorized: return "authorized"
            case .denied: return "denied"
            default: return "notDetermined"
            }
        }
        #endif
        return "unavailable"
    }

    static func authorize() async -> String {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            if AlarmManager.shared.authorizationState == .notDetermined { _ = try? await AlarmManager.shared.requestAuthorization() }
            return status()
        }
        #endif
        return "unavailable"
    }

    /// items : [(date, titre, sonnerie perso)] — remplace toutes les alarmes ECAM ; renvoie le nombre programmé
    static func replace(_ items: [(Date, String, Bool)]) async throws -> Int {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let manager = AlarmManager.shared
            for raw in UserDefaults.standard.stringArray(forKey: key) ?? [] {
                if let id = UUID(uuidString: raw) { try? manager.cancel(id: id) }
            }
            var ids: [String] = []
            for (date, title, soft) in items where date > Date() {
                let id = UUID()
                let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title),
                                                    stopButton: AlarmButton(text: "Arrêter", textColor: .white, systemImageName: "stop.fill"))
                let attributes = AlarmAttributes<EcamAlarm>(presentation: AlarmPresentation(alert: alert), metadata: EcamAlarm(), tintColor: .orange)
                // 1re alarme : la sonnerie choisie (douce) ; 2e : l'alarme de base d'iOS
                let sound: AlertConfiguration.AlertSound = soft ? (soundFile.map { .named($0) } ?? .default) : .default
                let configuration = AlarmManager.AlarmConfiguration<EcamAlarm>(schedule: .fixed(date), attributes: attributes, sound: sound)
                _ = try await manager.schedule(id: id, configuration: configuration)
                ids.append(id.uuidString)
            }
            UserDefaults.standard.set(ids, forKey: key)
            return ids.count
        }
        #endif
        return 0
    }
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct EcamAlarm: AlarmMetadata {}
#endif
