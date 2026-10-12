import Foundation
import UniformTypeIdentifiers

// Documents reçus par « Partager › ECAM » (Fichiers, Mail, Safari, WhatsApp…) : copiés dans Documents/Reçus,
// puis l'app web demande la matière et le cours avant de les mettre dans la file d'envoi (voir Uploader).
final class Incoming {
    static let shared = Incoming()
    var onReceive: (() -> Void)?

    static var folder: URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Reçus", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func receive(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var dest = Incoming.folder.appendingPathComponent(url.lastPathComponent)
        var n = 2
        while FileManager.default.fileExists(atPath: dest.path) { // même nom déjà reçu : « Cours (2).pdf »
            dest = Incoming.folder.appendingPathComponent("\(url.deletingPathExtension().lastPathComponent) (\(n)).\(url.pathExtension)")
            n += 1
        }
        guard (try? FileManager.default.copyItem(at: url, to: dest)) != nil else { return }
        if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) } // copie temporaire d'iOS
        DispatchQueue.main.async { self.onReceive?() }
    }

    func list() -> [[String: Any]] {
        ((try? FileManager.default.contentsOfDirectory(at: Incoming.folder, includingPropertiesForKeys: [.fileSizeKey, .creationDateKey])) ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .map { f in
                let v = try? f.resourceValues(forKeys: [.fileSizeKey, .creationDateKey])
                return ["path": f.path, "name": f.lastPathComponent, "size": v?.fileSize ?? 0, "received": ISO8601DateFormatter().string(from: v?.creationDate ?? Date())]
            }
    }

    /// Range le document (matière et cours choisis dans l'app) : il part dans la file d'envoi, supprimé une fois reçu.
    func send(path: String, uploadURL: URL, subject: String, uid: String) -> Bool {
        let src = URL(fileURLWithPath: path)
        guard src.path.hasPrefix(Incoming.folder.path), FileManager.default.fileExists(atPath: path) else { return false }
        var target = URLComponents(url: uploadURL, resolvingAgainstBaseURL: false)!
        target.queryItems = [URLQueryItem(name: "kind", value: "doc"), URLQueryItem(name: "subject", value: subject), URLQueryItem(name: "uid", value: uid)]
        let dest = Uploader.outbox.appendingPathComponent(String(UUID().uuidString.prefix(8)) + "-" + src.lastPathComponent)
        guard (try? FileManager.default.moveItem(at: src, to: dest)) != nil, let url = target.url else { return false }
        let mime = UTType(filenameExtension: src.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        Uploader.shared.enqueue(file: dest, course: subject, url: url, name: src.lastPathComponent, mime: mime)
        return true
    }

    func drop(path: String) {
        guard path.hasPrefix(Incoming.folder.path) else { return }
        try? FileManager.default.removeItem(atPath: path)
    }
}
