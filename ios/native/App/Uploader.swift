import Foundation
import UserNotifications

// Envoi de l'enregistrement en arrière-plan : continue même si l'app est fermée ou le réseau coupe
// (iOS reprend l'envoi tout seul). Une notification confirme la réception par l'app ECAM.
final class Uploader: NSObject, URLSessionDataDelegate {
    static let shared = Uploader()
    var backgroundCompletion: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "fr.cyprien.ecam.upload")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func send(file: URL, to target: URL, course: String) {
        var req = URLRequest(url: target)
        req.httpMethod = "POST"
        req.setValue("audio/x-m4a", forHTTPHeaderField: "Content-Type")
        // Nom sans accent (« Cours 2026-10-09 08h03 ») : pas de problème d'encodage, date lue par le serveur
        req.setValue(file.deletingPathExtension().lastPathComponent, forHTTPHeaderField: "x-name")
        let task = session.uploadTask(with: req, fromFile: file)
        task.taskDescription = "\(file.path)|\(course)"
        task.resume()
    }

    func askNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let parts = (task.taskDescription ?? "").components(separatedBy: "|")
        let path = parts.first ?? "", course = parts.count > 1 ? parts[1] : ""
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let ok = error == nil && (200..<300).contains(status)
        if ok { try? FileManager.default.removeItem(atPath: path) } // le PC et le cloud ont la copie
        notify(ok ? "Enregistrement envoyé" : "Envoi impossible",
               ok ? "\(course) — transcription et fiche automatiques" : "Il est gardé sur l'iPhone : réessaie depuis l'app")
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { self.backgroundCompletion?(); self.backgroundCompletion = nil }
    }

    private func notify(_ title: String, _ body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
