import AVFoundation
import Capacitor
import Foundation
import UIKit
import QuickLook
import UserNotifications

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
        CAPPluginMethod(name: "notifStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifEnable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "incoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dropShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmAuthorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAlarms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tabs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "theme", returnType: CAPPluginReturnPromise),
    ]

    // ---------- Barre d'onglets native et thème ----------
    @objc func tabs(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? EcamViewController)?.setTabs(selected: call.getString("selected"), hidden: call.getBool("hidden") ?? false)
            call.resolve()
        }
    }

    @objc func theme(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? EcamViewController)?.setTheme(call.getString("mode") ?? "auto")
            call.resolve()
        }
    }

    // ---------- Réveil automatique (AlarmKit, iOS 26) ----------
    @objc func alarmStatus(_ call: CAPPluginCall) {
        call.resolve(["available": Reveil.available, "status": Reveil.status()])
    }

    @objc func alarmAuthorize(_ call: CAPPluginCall) {
        Task { call.resolve(["status": await Reveil.authorize()]) }
    }

    // items : [{ at: "AAAA-MM-JJTHH:MM" (heure de Paris), title }] — remplace toutes les alarmes ECAM
    @objc func setAlarms(_ call: CAPPluginCall) {
        let parse = DateFormatter()
        parse.dateFormat = "yyyy-MM-dd'T'HH:mm"
        parse.timeZone = TimeZone(identifier: "Europe/Paris")
        let items: [(Date, String)] = (call.getArray("items", JSObject.self) ?? []).compactMap { it in
            guard let at = it["at"] as? String, let d = parse.date(from: at) else { return nil }
            return (d, it["title"] as? String ?? "Cours")
        }
        Task {
            do { call.resolve(["scheduled": try await Reveil.replace(items)]) } catch { call.reject("Réveil impossible : \(error.localizedDescription)") }
        }
    }

    // ---------- Documents reçus par « Partager › ECAM » ----------
    override public func load() {
        Incoming.shared.onReceive = { [weak self] in self?.notifyListeners("shared", data: [:]) }
    }

    @objc func incoming(_ call: CAPPluginCall) {
        call.resolve(["items": Incoming.shared.list()])
    }

    @objc func sendShared(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let raw = call.getString("uploadUrl"), let url = URL(string: raw) else { return call.reject("paramètres manquants") }
        let ok = Incoming.shared.send(name: name, uploadURL: url, subject: call.getString("subject") ?? "", uid: call.getString("uid") ?? "")
        ok ? call.resolve() : call.reject("Document introuvable")
    }

    @objc func dropShared(_ call: CAPPluginCall) {
        Incoming.shared.drop(name: call.getString("name") ?? "")
        call.resolve()
    }

    // ---------- Enregistrements gardés sur le téléphone tant que le serveur ne les a pas reçus ----------
    @objc func pending(_ call: CAPPluginCall) {
        Uploader.shared.pendingList { call.resolve(["items": $0]) }
    }

    @objc func retry(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            Recorder.recoverInterrupted()
            Uploader.shared.resumePending(uploadURL: call.getString("uploadUrl").flatMap(URL.init))
            call.resolve()
        }
    }

    // ---------- Rappels (notifications locales : le Web Push n'existe pas dans l'app installée par SideStore) ----------
    @objc func notifStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            call.resolve(["status": s.authorizationStatus == .authorized ? "granted" : s.authorizationStatus == .denied ? "denied" : "default"])
        }
    }

    @objc func notifEnable(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["status": granted ? "granted" : "denied"])
        }
    }

    // items : [{ id, title, body, at: "AAAA-MM-JJTHH:MM" (heure de Paris), url }] — remplace tous les rappels programmés
    @objc func schedule(_ call: CAPPluginCall) {
        let items = call.getArray("items", JSObject.self) ?? []
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("ecam-") })
            let parse = DateFormatter()
            parse.dateFormat = "yyyy-MM-dd'T'HH:mm"
            parse.timeZone = TimeZone(identifier: "Europe/Paris")
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "Europe/Paris")!
            var count = 0
            for it in items.prefix(60) { // iOS garde 64 rappels au maximum
                guard let id = it["id"] as? String, let at = it["at"] as? String, let date = parse.date(from: at), date > Date() else { continue }
                let content = UNMutableNotificationContent()
                content.title = it["title"] as? String ?? "ECAM"
                content.body = it["body"] as? String ?? ""
                content.sound = .default
                content.userInfo = ["url": it["url"] as? String ?? "/#devoirs"]
                if it["important"] as? Bool == true { // cours dans un autre bâtiment : passe en avant (mode Concentration compris si autorisé)
                    content.interruptionLevel = .timeSensitive
                    content.relevanceScore = 1
                }
                let when = cal.dateComponents(in: cal.timeZone, from: date)
                let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(timeZone: cal.timeZone, year: when.year, month: when.month, day: when.day, hour: when.hour, minute: when.minute), repeats: false)
                center.add(UNNotificationRequest(identifier: "ecam-" + id, content: content, trigger: trigger))
                count += 1
            }
            call.resolve(["scheduled": count])
        }
    }

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
        DispatchQueue.main.async { Recorder.shared.pause(); call.resolve(self.status()) }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { Recorder.shared.resume(); call.resolve(self.status()) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { // l'enregistreur et son minuteur vivent sur le fil principal
            guard let done = Recorder.shared.stopAndUpload() else {
                LiveActivity.end() // affichage resté d'un enregistrement interrompu
                Recorder.recoverInterrupted()
                return call.resolve(["uploading": true])
            }
            call.resolve(["file": done.file.lastPathComponent, "duration": done.duration, "uploading": true])
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    private func status() -> [String: Any] {
        ["active": Recorder.shared.isActive, "recording": Recorder.shared.isRecording, "seconds": Recorder.shared.elapsed, "course": Recorder.shared.course]
    }
}

// ---------- Aperçu natif d'Apple (QuickLook) : PowerPoint, Word, Excel, PDF, images… comme sur Mac ----------
extension RecorderPlugin: QLPreviewControllerDataSource {
    private static var previewFile: URL?

    @objc func preview(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else { return call.reject("lien manquant") }
        let name = (call.getString("name") ?? "document").replacingOccurrences(of: "/", with: "-")
        URLSession.shared.downloadTask(with: url) { tmp, resp, err in
            guard let tmp, err == nil, ((resp as? HTTPURLResponse)?.statusCode ?? 500) < 300 else { return call.reject("Téléchargement impossible") }
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: dest)
            guard (try? FileManager.default.moveItem(at: tmp, to: dest)) != nil else { return call.reject("Fichier illisible") }
            DispatchQueue.main.async {
                RecorderPlugin.previewFile = dest
                let ql = QLPreviewController()
                ql.dataSource = self
                self.bridge?.viewController?.present(ql, animated: true)
                call.resolve()
            }
        }.resume()
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int { RecorderPlugin.previewFile == nil ? 0 : 1 }
    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { (RecorderPlugin.previewFile ?? URL(fileURLWithPath: "/")) as NSURL }
}
