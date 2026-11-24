import Foundation
import UIKit
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

    // App ouverte : envoi direct, immédiat et visible. App fermée ou écran verrouillé : envoi confié à iOS (session
    // d'arrière-plan), qui peut attendre longtemps — d'où des « envoi en cours » qui n'avançaient pas.
    private lazy var live: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 60
        config.httpMaximumConnectionsPerHost = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private let lock = DispatchQueue(label: "fr.cyprien.ecam.uploader") // protège tout l'état ci-dessous
    private var inFlight = Set<String>()        // noms des fichiers en cours d'envoi : jamais deux envois du même fichier
    private var progress: [String: Double] = [:]
    private var errors: [String: String] = [:]  // dernière erreur, montrée dans l'app
    private var tries: [String: Int] = [:]
    private var bodies: [URLSessionTask: Data] = [:]
    private var scanning = false
    private var rescan = false

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "fr.cyprien.ecam.upload")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private func infoURL(_ file: URL) -> URL { file.appendingPathExtension("json") }

    // Copie de sécurité : un enregistrement envoyé reste 5 jours dans « Envoyés » (app Fichiers › ECAM),
    // un enregistrement refusé reste dans la file et est réessayé (« Non envoyés » : ancienne version, revidé dans la file).
    static func folder(_ name: String) -> URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    private func keep(_ path: String, in name: String) {
        guard FileManager.default.fileExists(atPath: path) else { return }
        let fm = FileManager.default, src = URL(fileURLWithPath: path)
        let dest = Uploader.folder(name).appendingPathComponent(src.lastPathComponent)
        try? fm.removeItem(at: dest)
        if (try? fm.moveItem(at: src, to: dest)) == nil { return }
        try? fm.removeItem(at: infoURL(src))
    }
    private func purgeSent() {
        let fm = FileManager.default, limit = Date().addingTimeInterval(-5 * 86400)
        for f in (try? fm.contentsOfDirectory(at: Uploader.folder("Envoyés"), includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            if let d = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, d < limit { try? fm.removeItem(at: f) }
        }
    }

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
        DispatchQueue.main.async {
            let active = UIApplication.shared.applicationState == .active
            self.lock.async {
                // Un seul passage à la fois : deux passages simultanés envoyaient le même fichier en double
                if self.scanning { self.rescan = true; return }
                self.scanning = true
                self.purgeSent()
                self.requeueRefused()
                self.session.getAllTasks { tasks in self.lock.async { self.scan(tasks, active: active) } }
            }
        }
    }

    private func scan(_ tasks: [URLSessionTask], active: Bool) {
        var waiting = Set<String>()
        for t in tasks where t.state == .running || t.state == .suspended {
            let p = describe(t)
            if active || Date().timeIntervalSince1970 - p.at > 6 * 3600 {
                inFlight.remove(p.name)
                t.cancel() // app ouverte : on reprend l'envoi nous-mêmes au lieu d'attendre qu'iOS le décide
            } else { waiting.insert(p.name) }
        }
        let fallback = UserDefaults.standard.string(forKey: "uploadURL").flatMap { URL(string: $0) }
        for file in queued() where !waiting.contains(file.lastPathComponent) && !inFlight.contains(file.lastPathComponent) {
            let name = file.lastPathComponent
            let meta = (try? JSONSerialization.jsonObject(with: Data(contentsOf: infoURL(file)))) as? [String: String] ?? [:]
            guard let target = freshTarget(meta["url"].flatMap { URL(string: $0) }, fallback) else { errors[name] = "ouvre l'app avec du réseau"; continue }
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size == 0 { keep(file.path, in: "Vides"); continue }
            inFlight.insert(name)
            send(file: file, to: target, course: meta["course"] ?? "", name: meta["name"], mime: meta["mime"], via: active ? live : session)
        }
        scanning = false
        if rescan { rescan = false; resumePending() }
    }

    /// Le lien gardé avec un vieux fichier peut avoir changé : adresse à jour, avec la matière et le cours du fichier.
    private func freshTarget(_ own: URL?, _ latest: URL?) -> URL? {
        guard let own else { return latest }
        guard let latest, var c = URLComponents(url: latest, resolvingAgainstBaseURL: false) else { return own }
        c.percentEncodedQuery = URLComponents(url: own, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        return c.url
    }

    /// Les anciens « Non envoyés » repartent dans la file : le serveur ignore ceux qu'il a déjà.
    /// Seulement les enregistrements : un document refusé a perdu sa matière, il reste à repartager.
    private func requeueRefused() {
        let fm = FileManager.default
        for f in (try? fm.contentsOfDirectory(at: Uploader.folder("Non envoyés"), includingPropertiesForKeys: nil)) ?? [] where f.pathExtension.lowercased() == "m4a" {
            let dest = Uploader.outbox.appendingPathComponent(f.lastPathComponent)
            if !fm.fileExists(atPath: dest.path) { try? fm.moveItem(at: f, to: dest) }
        }
    }

    /// L'app passe en arrière-plan : les envois en cours sont confiés à iOS, qui les termine.
    func handOver() {
        var bg = UIBackgroundTaskIdentifier.invalid
        let end = { if bg != .invalid { UIApplication.shared.endBackgroundTask(bg); bg = .invalid } }
        bg = UIApplication.shared.beginBackgroundTask(withName: "envoi") { end() }
        live.getAllTasks { tasks in
            tasks.forEach { $0.cancel() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.resumePending()
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) { end() }
            }
        }
    }

    // « chemin|cours|date d'envoi ». Seul le NOM compte : le chemin de l'app change quand SideStore la réinstalle.
    private func describe(_ t: URLSessionTask) -> (name: String, course: String, at: Double) {
        let p = (t.taskDescription ?? "").components(separatedBy: "|")
        return (URL(fileURLWithPath: p.first ?? "").lastPathComponent, p.count > 1 ? p[1] : "", p.count > 2 ? Double(p[2]) ?? 0 : 0)
    }

    func queued() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: Uploader.outbox, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension != "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// Pour l'app : ce qui attend encore sur le téléphone.
    func pendingList(_ done: @escaping ([[String: Any]]) -> Void) {
        lock.async {
            let fm = FileManager.default
            let size = { (f: URL) -> Int in (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 }
            var items: [[String: Any]] = []
            for f in self.queued() {
                let n = f.lastPathComponent
                items.append(["name": f.deletingPathExtension().lastPathComponent, "size": size(f), "sending": self.inFlight.contains(n),
                              "progress": self.progress[n] ?? 0, "error": self.errors[n] ?? ""])
            }
            for dir in (try? fm.contentsOfDirectory(at: Recorder.root, includingPropertiesForKeys: nil)) ?? [] where dir.hasDirectoryPath {
                let parts = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []).filter { $0.pathExtension == "m4a" }
                if !parts.isEmpty { items.append(["name": dir.lastPathComponent + " (à assembler)", "size": parts.map(size).reduce(0, +), "sending": false]) }
            }
            done(items)
        }
    }

    private func send(file: URL, to target: URL, course: String, name: String? = nil, mime: String? = nil, via: URLSession) {
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
        let task = via.uploadTask(with: req, fromFile: file)
        let label = course.replacingOccurrences(of: "|", with: " ")
        task.taskDescription = "\(file.path)|\(label)|\(Date().timeIntervalSince1970)"
        task.resume()
    }

    func askNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        let name = describe(task).name
        lock.async { self.progress[name] = totalBytesExpectedToSend > 0 ? Double(totalBytesSent) / Double(totalBytesExpectedToSend) : 0 }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.async { self.bodies[dataTask, default: Data()].append(data.prefix(2000)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.async { self.finished(task, error, isLive: session === self.live) }
    }

    private func finished(_ task: URLSessionTask, _ error: Error?, isLive: Bool) {
        let (name, course, _) = describe(task)
        let path = Uploader.outbox.appendingPathComponent(name).path
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let reply = bodies.removeValue(forKey: task) ?? Data()
        let cancelled = (error as? URLError)?.code == .cancelled
        if cancelled && !isLive { return } // repris par l'envoi direct (déjà marqué en cours)
        inFlight.remove(name)
        progress[name] = nil
        if error == nil && (200..<300).contains(status) {
            errors[name] = nil
            tries[name] = nil
            // Reçu par le serveur : copie de sécurité gardée 5 jours (dossier « Envoyés »), documents supprimés
            if path.hasSuffix(".m4a") {
                try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: path) // 5 jours à partir de l'envoi
                keep(path, in: "Envoyés")
                notify("Enregistrement envoyé", "\(course.isEmpty ? "Ton cours" : course) — transcription et fiche automatiques")
            } else {
                try? FileManager.default.removeItem(atPath: path)
                try? FileManager.default.removeItem(at: infoURL(URL(fileURLWithPath: path)))
                notify("Document ajouté", "Rangé dans \(course)")
            }
        } else if !cancelled {
            // Quelle que soit l'erreur (refus compris), le fichier reste dans la file et sera réessayé
            let said = ((try? JSONSerialization.jsonObject(with: reply)) as? [String: Any])?["error"] as? String
            let why = error?.localizedDescription ?? "serveur : \(said ?? "erreur") (\(status))"
            errors[name] = why
            let n = (tries[name] ?? 0) + 1
            tries[name] = n
            if n == 3 { notify("Envoi pas encore fait", "\(why) — l'enregistrement est gardé sur l'iPhone et sera réessayé.") }
            // 10 s, 20 s, 40 s… puis toutes les 10 min tant que l'app tourne, et à chaque ouverture
            let wait = min(600, 5 * pow(2, Double(min(n, 8))))
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { self.resumePending() }
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
