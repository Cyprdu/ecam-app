import AVFoundation
import Capacitor
import Foundation
import UIKit

// Pont entre l'app web et l'enregistreur natif.
// Côté JavaScript : const r = window.Capacitor.Plugins.EcamRecorder
//   await r.start({ course: 'Introduction Réseau IT', uploadUrl: 'https://…/up/…' })
//   await r.pause() · await r.resume() · await r.stop() · await r.status()
@objc(RecorderPlugin)
public class RecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RecorderPlugin"
    public let jsName = "EcamRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
    ]

    // Retour haptique iOS (vibration légère au toucher, réussite…)
    @objc func haptic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("uploadUrl"), let url = URL(string: raw) else { return call.reject("uploadUrl manquant") }
        let course = call.getString("course") ?? "Cours"
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { return call.reject(RecorderError.micDenied.localizedDescription) }
                do {
                    Uploader.shared.askNotificationPermission()
                    try Recorder.shared.start(course: course, uploadURL: url)
                    call.resolve(["recording": true])
                } catch {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        Recorder.shared.pause()
        call.resolve(status())
    }

    @objc func resume(_ call: CAPPluginCall) {
        Recorder.shared.resume()
        call.resolve(status())
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let done = Recorder.shared.stopAndUpload() else { return call.reject("Aucun enregistrement en cours") }
        call.resolve(["file": done.file.lastPathComponent, "duration": done.duration, "uploading": true])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    private func status() -> [String: Any] {
        ["active": Recorder.shared.isActive, "recording": Recorder.shared.isRecording, "seconds": Recorder.shared.elapsed, "course": Recorder.shared.course]
    }
}
