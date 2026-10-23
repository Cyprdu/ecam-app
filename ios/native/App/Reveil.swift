import Foundation
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

// Réveil automatique avant le premier cours (AlarmKit, iOS 26) : de vraies alarmes, qui sonnent même en mode silencieux.
// L'app web calcule les heures (premier cours − 1 h) et les envoie ici ; on remplace à chaque fois les alarmes ECAM
// précédentes (identifiants gardés dans UserDefaults), sans toucher aux autres alarmes de l'iPhone.
enum Reveil {
    static let key = "ecamAlarms"

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

    /// items : [(date, titre)] — remplace toutes les alarmes ECAM ; renvoie le nombre programmé
    static func replace(_ items: [(Date, String)]) async throws -> Int {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let manager = AlarmManager.shared
            for raw in UserDefaults.standard.stringArray(forKey: key) ?? [] {
                if let id = UUID(uuidString: raw) { try? manager.cancel(id: id) }
            }
            var ids: [String] = []
            for (date, title) in items where date > Date() {
                let id = UUID()
                let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title),
                                                    stopButton: AlarmButton(text: "Arrêter", textColor: .white, systemImageName: "stop.fill"))
                let attributes = AlarmAttributes<EcamAlarm>(presentation: AlarmPresentation(alert: alert), metadata: EcamAlarm(), tintColor: .orange)
                let configuration = AlarmManager.AlarmConfiguration<EcamAlarm>(schedule: .fixed(date), attributes: attributes)
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
