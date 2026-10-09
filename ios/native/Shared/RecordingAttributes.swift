import ActivityKit
import Foundation

// Données affichées dans la Dynamic Island et sur l'écran verrouillé pendant un enregistrement.
struct RecordingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var paused: Bool
        var since: Date        // début fictif du chrono (= maintenant − temps déjà enregistré)
        var elapsed: Double    // secondes enregistrées (affichées telles quelles en pause)
    }
    var course: String
}

#if !WIDGET_EXTENSION
// Démarre / met à jour / termine l'activité en direct (côté app uniquement)
enum LiveActivity {
    private static var current: Activity<RecordingAttributes>?

    static func start(course: String, startedAt: Date) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = RecordingAttributes.ContentState(paused: false, since: startedAt, elapsed: 0)
        current = try? Activity.request(attributes: .init(course: course), content: .init(state: state, staleDate: nil))
    }

    static func update(paused: Bool, elapsed: Double) {
        let state = RecordingAttributes.ContentState(paused: paused, since: Date().addingTimeInterval(-elapsed), elapsed: elapsed)
        Task { await current?.update(.init(state: state, staleDate: nil)) }
    }

    static func end() {
        Task { await current?.end(nil, dismissalPolicy: .immediate); current = nil }
    }
}
#endif
