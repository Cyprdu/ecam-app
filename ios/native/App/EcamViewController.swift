import Capacitor
import UIKit

// Vue web Capacitor qui charge l'app ECAM (adresse dans Resources/capacitor.config.json)
// et lui donne accès à l'enregistreur natif : window.Capacitor.Plugins.EcamRecorder
class EcamViewController: CAPBridgeViewController, UITabBarDelegate {
    // Onglets natifs (Liquid Glass sur iOS 26) : l'app web dit lequel est actif, la barre lui dit lequel est touché
    static let tabs = [("agenda", "Agenda", "calendar"), ("devoirs", "Devoirs", "checkmark.circle"), ("assistant", "Assistant", "sparkles"),
                       ("notes", "Notes", "rosette"), ("ecam", "ECAM", "square.grid.2x2")]
    let tabBar = UITabBar()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RecorderPlugin())
        // Comportement iOS : glisser depuis le bord gauche = retour, pas de rebond de la page entière
        webView?.allowsBackForwardNavigationGestures = true
        webView?.scrollView.bounces = false
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        // Fond natif aux couleurs du thème (sinon fond sombre visible en mode clair au lancement et sous le clavier)
        let bg = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.047, green: 0.051, blue: 0.059, alpha: 1) : UIColor(red: 0.961, green: 0.965, blue: 0.973, alpha: 1) }
        view.backgroundColor = bg
        webView?.backgroundColor = bg
        webView?.scrollView.backgroundColor = bg

        tabBar.delegate = self
        tabBar.tintColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 1, green: 0.478, blue: 0.2, alpha: 1) : UIColor(red: 0.91, green: 0.349, blue: 0.047, alpha: 1) }
        tabBar.items = Self.tabs.enumerated().map { i, t in
            UITabBarItem(title: t.1, image: UIImage(systemName: t.2), selectedImage: UIImage(systemName: t.2 + ".fill") ?? UIImage(systemName: t.2)).tagged(i)
        }
        tabBar.isHidden = true // affichée quand l'app web le demande (une ancienne version web garde sa propre barre)
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        UISelectionFeedbackGenerator().selectionChanged()
        webView?.evaluateJavaScript("window.nativeTab && nativeTab('\(Self.tabs[item.tag].0)')")
    }

    // selected : onglet actif (nil = inchangé) ; hidden : masquée pendant une feuille ou sur l'écran de connexion
    func setTabs(selected: String?, hidden: Bool) {
        if let s = selected, let i = Self.tabs.firstIndex(where: { $0.0 == s }) { tabBar.selectedItem = tabBar.items?[i] }
        guard hidden != (tabBar.isHidden || tabBar.alpha == 0) else { return }
        if !hidden { tabBar.isHidden = false }
        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
            self.tabBar.alpha = hidden ? 0 : 1
            self.tabBar.transform = hidden ? CGAffineTransform(translationX: 0, y: 24) : .identity
        } completion: { _ in if hidden && self.tabBar.alpha == 0 { self.tabBar.isHidden = true } }
    }

    // Thème choisi dans l'app : clair, sombre ou celui de l'iPhone (barre d'état, clavier, alertes suivent)
    func setTheme(_ mode: String) {
        view.window?.overrideUserInterfaceStyle = mode == "light" ? .light : mode == "dark" ? .dark : .unspecified
    }
}

private extension UITabBarItem {
    func tagged(_ t: Int) -> UITabBarItem { tag = t; return self }
}
