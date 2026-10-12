import Foundation
import UserNotifications

// File d'envoi des enregistrements (Documents/À envoyer) : un fichier n'est supprimé du téléphone qu'une fois
// que le serveur a confirmé l'avoir reçu. L'envoi se fait en arrière-plan (continue app fermée, réseau coupé…) ;
// s'il est annulé ou échoue (app fermée depuis le sélecteur d'apps, pas de réseau), il est relancé
// à chaque ouverture de l'app. Les fichiers sont aussi visibles dans l'app Fichiers (Sur mon iPhone › ECAM).
final class Uploader: NSObject, URLSessionDataDelegate {
    static let shared = Uploader()
    var backgroundCompletion: (() -> Void)?

    static var outbox: URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("À envoyer", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "fr.cyprien.ecam.upload")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private func infoURL(_ file: URL) -> URL { file.appendingPathExtension("json") }

    /// Met un fichier dans la file (avec le cours et le lien d'envoi), puis l'envoie.
    func enqueue(file: URL, course: String, url: URL?, name: String? = nil, mime: String? = nil) {
        var meta: [String: String] = ["course": course]
        if let url { meta["url"] = url.absoluteString }
        if let name { meta["name"] = name } // documents partagés : leur vrai nom et type
        if let mime { meta["mime"] = mime }
        try? JSONSerialization.data(withJSONObject: meta).write(to: infoURL(file))
        resumePending()
    }

    /// Envoie tout ce qui attend dans la file et n'est pas déjà en cours d'envoi.
    func resumePending(uploadURL: URL? = nil) {
        if let uploadURL { UserDefaults.standard.set(uploadURL.absoluteString, forKey: "uploadURL") }
        let fallback = UserDefaults.standard.string(forKey: "uploadURL").flatMap(URL.init)
        session.getAllTasks { tasks in
            let busy = Set(tasks.filter { $0.state == .running || $0.state == .suspended }.compactMap { $0.taskDescription?.components(separatedBy: "|").first })
            for file in self.queued() where !busy.contains(file.path) {
                let meta = (try? JSONSerialization.jsonObject(with: Data(contentsOf: self.infoURL(file)))) as? [String: String] ?? [:]
                guard let target = (meta["url"]).flatMap(URL.init) ?? fallback else { continue } // lien inconnu : l'app le donnera à l'ouverture
                self.send(file: file, to: target, course: meta["course"] ?? "", name: meta["name"], mime: meta["mime"])
            }
        }
    }

    func queued() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: Uploader.outbox, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension != "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// Pour l'app : ce qui attend encore sur le téléphone.
    func pendingList(_ done: @escaping ([[String: Any]]) -> Void) {
        session.getAllTasks { tasks in
            let busy = Set(tasks.filter { $0.state == .running }.compactMap { $0.taskDescription?.components(separatedBy: "|").first })
            done(self.queued().map { f in
                let size = (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                return ["name": f.deletingPathExtension().lastPathComponent, "size": size, "sending": busy.contains(f.path)]
            })
        }
    }

    private func send(file: URL, to target: URL, course: String, name: String? = nil, mime: String? = nil) {
        var req = URLRequest(url: target)
        req.httpMethod = "POST"
        req.setValue(mime ?? "audio/x-m4a", forHTTPHeaderField: "Content-Type")
        // Enregistrement : nom sans accent (« Cours 2026-10-09 08h03 »), date lue par le serveur.
        // Document partagé : son vrai nom, passé dans l'adresse (les accents y sont encodés proprement)
        if let name, var c = URLComponents(url: target, resolvingAgainstBaseURL: false) {
            c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "name", value: name)]
            req.url = c.url
        } else {
            req.setValue(file.deletingPathExtension().lastPathComponent, forHTTPHeaderField: "x-name")
        }
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
        if error == nil && (200..<300).contains(status) {
            // Reçu par le serveur : on peut libérer la place sur le téléphone
            try? FileManager.default.removeItem(atPath: path)
            try? FileManager.default.removeItem(at: infoURL(URL(fileURLWithPath: path)))
            if path.hasSuffix(".m4a") {
                notify("Enregistrement envoyé", "\(course.isEmpty ? "Ton cours" : course) — transcription et fiche automatiques")
            } else {
                notify("Document ajouté", "Rangé dans \(course)")
            }
        } else if status == 400 { // refusé car vide (moins d'une seconde d'audio) : inutile de le renvoyer
            try? FileManager.default.removeItem(atPath: path)
            try? FileManager.default.removeItem(at: infoURL(URL(fileURLWithPath: path)))
        } else if (error as? URLError)?.code != .cancelled {
            notify("Envoi pas encore fait", "L'enregistrement est gardé sur l'iPhone : il sera renvoyé automatiquement à la prochaine ouverture de l'app.")
        }
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
