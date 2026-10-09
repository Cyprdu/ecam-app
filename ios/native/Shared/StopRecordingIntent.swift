import AppIntents

// Bouton « Arrêter » de la Dynamic Island : s'exécute dans l'app, arrête et envoie l'enregistrement.
// (fichier compilé dans l'app ET dans le widget, comme l'exige iOS)
struct StopRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Arrêter et envoyer"

    func perform() async throws -> some IntentResult {
        #if !WIDGET_EXTENSION
        await MainActor.run { _ = Recorder.shared.stopAndUpload() }
        #endif
        return .result()
    }
}
