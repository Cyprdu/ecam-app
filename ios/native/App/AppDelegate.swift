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
        return true
    }

    // Envois terminés pendant que l'app était en arrière-plan (voir Uploader)
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        Uploader.shared.backgroundCompletion = completionHandler
    }

    // Afficher la notification « Envoyé » même si l'app est au premier plan
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
}
