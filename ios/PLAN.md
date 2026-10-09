# Migration vers une vraie app iPhone — plan d'action

> **Règle d'or : tant que la phase 5 n'est pas validée, rien ne change pour toi.**
> L'app web (ecam-app.cyprien-veyret.workers.dev), le serveur Cloudflare, l'agent du PC et les raccourcis continuent de fonctionner exactement comme aujourd'hui.
> Ce dossier `_APP/ios` est indépendant : on peut le supprimer à tout moment sans rien casser.

## Pourquoi

Une app web installée depuis Safari ne peut pas : enregistrer écran verrouillé, s'afficher dans la Dynamic Island, lancer un enregistrement sans ouvrir Raccourcis/Dictaphone. Une vraie app iPhone le peut.

## L'idée : une « coque » native autour de l'app actuelle

```
┌──────────────── App iPhone « ECAM » (native) ────────────────┐
│  Affiche l'app actuelle (le site Cloudflare) dans une vue web │ ← toutes les mises à jour du site
│  + Enregistreur natif (AVAudioRecorder, arrière-plan)         │   arrivent sans réinstaller
│  + Activité en direct : Dynamic Island + écran verrouillé     │
│  + Envoi automatique à l'arrêt (vers /up/…, comme le raccourci)│
└───────────────────────────────────────────────────────────────┘
        compilée gratuitement par GitHub (Mac loué) → installée par SideStore
```

- **Capacitor** : la coque. Le bouton « Enregistrer » de l'app saura s'il tourne dans la coque (enregistreur natif) ou dans Safari (raccourcis, comme aujourd'hui).
- **Le serveur ne change pas** : l'enregistreur natif envoie au même lien que le raccourci, avec un nom daté sans accent (« Cours 2026-10-09 08h03 ») que le serveur sait déjà relier au bon cours.

## Structure du dossier

```
_APP/ios/
├── PLAN.md                         ← ce fichier
├── package.json                    ← outils Capacitor (installés)
├── project.yml                     ← description du projet Xcode (générée par XcodeGen sur le Mac de GitHub)
├── native/
│   ├── App/                        ← l'app : démarrage, vue web, enregistreur, envoi
│   │   ├── AppDelegate.swift
│   │   ├── EcamViewController.swift
│   │   ├── Recorder.swift          ← enregistrement (écran verrouillé, pause, appels entrants)
│   │   ├── RecorderPlugin.swift    ← pont JavaScript ↔ enregistreur (window.Capacitor.Plugins.EcamRecorder)
│   │   ├── Uploader.swift          ← envoi en arrière-plan, notification « Envoyé »
│   │   └── Info.plist
│   ├── Shared/                     ← commun à l'app et au widget
│   │   ├── RecordingAttributes.swift   ← données de l'activité en direct
│   │   └── StopRecordingIntent.swift   ← bouton « Arrêter » dans la Dynamic Island
│   ├── Widget/                     ← Dynamic Island + écran verrouillé
│   │   ├── RecordingLiveActivity.swift
│   │   └── Info.plist
│   └── Resources/
│       ├── capacitor.config.json   ← adresse du site affiché
│       └── public/index.html       ← page de secours hors ligne
├── web/native-bridge.js            ← code à brancher dans l'app web en phase 3 (pas encore actif)
└── ../.github/workflows/ios.yml    ← compilation automatique de l'app (.ipa) par GitHub
```

## Phases

### Phase 0 — Préparation ✅ (fait)
- Structure, fichiers de base, plan, outils Capacitor installés, compilation GitHub décrite.
- `_APP/.gitignore` : les secrets (clés, identifiants, journal) ne partiront jamais sur GitHub.

### Phase 1 — Comptes et outils (toi, ~45 min, une seule fois)
1. **iPhone** : iOS 17 minimum (pour le bouton Arrêter dans la Dynamic Island). Réglages → Général → Informations → Version.
2. **Mode développeur** : Réglages → Confidentialité et sécurité → Mode développeur → Activer (l'iPhone redémarre).
3. **Compte GitHub** gratuit (github.com) → créer un dépôt **privé** vide nommé `ecam-app`.
4. **SideStore** : suivre le guide officiel (sidestore.io) — sur le PC : iTunes et iCloud **depuis apple.com** (pas le Microsoft Store), puis l'installateur SideStore ; il crée le « fichier d'appairage » et installe SideStore sur l'iPhone avec ton identifiant Apple (que **tu** tapes).
5. Me dire « phase 1 faite » : je ne crée aucun compte et ne tape aucun mot de passe à ta place.

### Phase 2 — Première compilation (moi)
1. `git init` dans `_APP`, premier envoi vers ton dépôt privé (avec ton accord, les secrets exclus).
2. GitHub compile l'app (onglet Actions → « App iPhone » → fichier `ECAM-ipa`). Je corrige les erreurs de compilation éventuelles (je ne peux pas compiler sur Windows : c'est le Mac de GitHub qui le fait).
3. Installation : SideStore → « + » → choisir `ECAM.ipa`.
4. Test : l'app s'ouvre et affiche l'app actuelle (connexion, agenda, tout fonctionne).

### Phase 3 — Enregistrement natif (moi, puis tests avec toi)
1. Brancher `web/native-bridge.js` dans l'app web : **dans la coque**, « Enregistrer » utilise l'enregistreur natif ; **dans Safari**, rien ne change (raccourcis).
2. Écran de l'enregistrement dans l'app : chrono, Pause / Reprendre, Arrêter et envoyer.
3. Tests : écran verrouillé 10 min, appel entrant pendant l'enregistrement, Dynamic Island (chrono + bouton Arrêter), envoi automatique, rattachement au bon cours, coupure réseau pendant l'envoi (l'envoi reprend tout seul).

### Phase 4 — Notifications (décision à prendre)
Les notifications « push » natives (service APNs d'Apple) **ne sont pas autorisées avec un compte Apple gratuit**. Deux options :
- **A (recommandé au début)** : garder aussi l'app web installée → les notifications (notes, DS, fiches prêtes) continuent d'arriver par elle, comme aujourd'hui. Toucher la notification ouvre l'app web.
- **B** : notifications locales de la coque (rappels de DS/devoirs programmés sur l'iPhone) + vérification en arrière-plan des nouvelles notes (iOS décide de la fréquence : moins fiable que le push).

### Phase 5 — Bascule
- L'app native devient l'app principale ; l'app web reste en secours.
- Les raccourcis « ECAM Enregistrer » / « Envoyer à ECAM » deviennent facultatifs (on garde « Envoyer à ECAM » pour les photos et PDF).

## Le renouvellement tous les 7 jours
- **SideStore** renouvelle depuis l'iPhone, de n'importe où (pas besoin du PC après l'installation). Il le fait en arrière-plan ; sinon : SideStore → Mes apps → Actualiser.
- Si l'échéance est dépassée : l'app ne s'ouvre plus, **aucune donnée perdue**, elle refonctionne dès qu'on actualise.

## Limites à connaître
| Limite | Impact pour nous |
|---|---|
| 3 apps installées avec un compte gratuit (SideStore compris) | il en reste 2, l'app en utilise 1 |
| 10 identifiants d'app par semaine | l'app + son widget = 2 |
| Pas de push natif (APNs) avec un compte gratuit | phase 4, option A ou B |
| Compilation GitHub sur Mac : ~200 min/mois gratuites pour un dépôt privé | une compilation ≈ 5–8 min → ~25 par mois |
| Apple peut changer les règles du « sideload » | l'app web reste toujours disponible en secours |

## Retour en arrière
Supprimer l'app de l'iPhone. L'app web, le serveur et le PC n'ont jamais dépendu de ce dossier.
