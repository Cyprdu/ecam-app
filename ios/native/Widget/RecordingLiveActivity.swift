import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct EcamWidgets: WidgetBundle {
    var body: some Widget { RecordingLiveActivity() }
}

// Dynamic Island (compacte, minimale, étendue) + bannière de l'écran verrouillé
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingAttributes.self) { ctx in
            HStack(spacing: 12) {
                Image(systemName: ctx.state.paused ? "pause.circle.fill" : "mic.circle.fill")
                    .font(.title).foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctx.attributes.course).font(.headline).lineLimit(1)
                    Chrono(state: ctx.state).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                }
                Spacer()
                Button(intent: StopRecordingIntent()) { Label("Arrêter", systemImage: "stop.fill") }
                    .tint(.orange)
            }
            .padding()
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: ctx.state.paused ? "pause.fill" : "mic.fill").foregroundStyle(.orange)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Chrono(state: ctx.state).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(ctx.attributes.course).lineLimit(1)
                        Spacer()
                        Button(intent: StopRecordingIntent()) { Label("Arrêter", systemImage: "stop.fill") }.tint(.orange)
                    }
                }
            } compactLeading: {
                Image(systemName: ctx.state.paused ? "pause.fill" : "mic.fill").foregroundStyle(.orange)
            } compactTrailing: {
                Chrono(state: ctx.state).monospacedDigit().frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "mic.fill").foregroundStyle(.orange)
            }
        }
    }
}

// Chrono : défile tout seul pendant l'enregistrement, figé en pause
struct Chrono: View {
    let state: RecordingAttributes.ContentState
    var body: some View {
        if state.paused {
            Text(Duration.seconds(state.elapsed).formatted(.time(pattern: .hourMinuteSecond)))
        } else {
            Text(timerInterval: state.since...Date.distantFuture, countsDown: false)
        }
    }
}
