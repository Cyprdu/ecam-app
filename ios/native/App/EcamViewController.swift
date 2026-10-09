import Capacitor

// Vue web Capacitor qui charge l'app ECAM (adresse dans Resources/capacitor.config.json)
// et lui donne accès à l'enregistreur natif : window.Capacitor.Plugins.EcamRecorder
class EcamViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RecorderPlugin())
    }
}
