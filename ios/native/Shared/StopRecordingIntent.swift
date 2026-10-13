import AppIntents

// Bouton « Arrêter » de la Dynamic Island : s'exécute dans l'app, arrête et envoie l'enregistrement.
// (fichier compilé dans l'app ET dans le widget, comme l'exige iOS)
struct StopRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Arrêter et envoyer"

    func perform() async throws -> some IntentResult {
        #if !WIDGET_EXTENSION
        await MainActor.run {
            if Recorder.shared.stopAndUpload() == nil { // rien en cours (app relancée) : on nettoie l'affichage et on récupère l'audio
                LiveActivity.end()
                Recorder.recoverInterrupted()
            }
        }
        #endif
        return .result()
    }
}
