import UIKit
import Capacitor
import UserNotifications

// Démarrage de l'app : une fenêtre qui affiche l'app web ECAM (voir EcamViewController).
@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = EcamViewController()
        window?.makeKeyAndVisible()
        UNUserNotificationCenter.current().delegate = self
        LiveActivity.end()                 // au démarrage rien n'enregistre : on retire un affichage resté d'avant
        Recorder.recoverInterrupted()      // enregistrement interrompu (app tuée, plantage) → réassemblé et envoyé
        Uploader.shared.resumePending()    // envois annulés ou échoués → relancés
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Recorder.recoverInterrupted()
        Uploader.shared.resumePending()
    }

    // Fermée depuis le sélecteur d'apps pendant un enregistrement : on finalise la tranche en cours (fichier lisible),
    // l'envoi se fera à la prochaine ouverture
    func applicationWillTerminate(_ application: UIApplication) {
        Recorder.shared.terminate()
    }

    // Envois terminés pendant que l'app était en arrière-plan (voir Uploader)
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        Uploader.shared.backgroundCompletion = completionHandler
    }

    // Afficher la notification « Envoyé » même si l'app est au premier plan
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // Toucher un rappel : ouvre la bonne page de l'app (userInfo["url"] = « /#cours/… », « /#devoirs »)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let path = response.notification.request.content.userInfo["url"] as? String,
              let hash = path.split(separator: "#", maxSplits: 1).last, path.contains("#") else { return }
        let js = "location.hash = \(String(reflecting: "#" + hash))"
        await MainActor.run {
            // ponytail: petit délai fixe pour laisser la page se charger au démarrage à froid
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                (self.window?.rootViewController as? CAPBridgeViewController)?.webView?.evaluateJavaScript(js)
            }
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if url.isFileURL { Incoming.shared.receive(url); return true } // « Partager › ECAM »
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
}
