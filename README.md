# App ECAM

```
iPhone (app installée)  ──►  Cloudflare (gratuit, toujours en ligne)  ◄──  PC (agent)
agenda, docs, devoirs        calendrier, fichiers, rappels, push          Whisper (RTX) + Claude Code
```

- `cloud/` : serveur + app (Cloudflare Workers + base D1). Tests : `npm test`.
- `pc/agent.py` : transcrit les audios et génère les fiches dans `ECAM/<MATIÈRE>/COURS <date>/`.
- `pc/config.json` : adresse du cloud + correspondance matière → dossier.
- Clés : `cloud/.dev.vars` (APP_KEY = clé d'accès de l'app). Ne jamais la partager.

## Mise en ligne (une fois)

1. Créer un compte gratuit sur cloudflare.com.
2. `cd _APP/cloud` puis `npx wrangler login` (autoriser dans le navigateur).
3. `npx wrangler d1 create ecam` → copier le `database_id` dans `wrangler.toml`.
4. `npx wrangler d1 execute ecam --remote --file schema.sql` puis activer R2 (tableau de bord Cloudflare → R2, carte requise, gratuit jusqu’à 10 Go) et `npx wrangler r2 bucket create ecam-files`
5. `npx wrangler secret bulk .dev.vars`
6. `npx wrangler deploy` → noter l'adresse `https://ecam-app.<toi>.workers.dev`, la mettre dans `pc/config.json` (`cloud_url`).

## iPhone

1. Safari → adresse de l'app → Partager → « Sur l'écran d'accueil ». Ouvrir l'app, coller la clé, Réglages → Activer les notifications.
2. App Raccourcis → nouveau raccourci **« ECAM Enregistrer »** : action *Dictaphone → Enregistrer un nouveau mémo vocal* (à défaut : *Ouvrir l'app Dictaphone*).
3. Nouveau raccourci **« Envoyer à ECAM »** :
   - Détails → *Afficher dans la feuille de partage*, types acceptés : *Fichiers* et *Médias*.
   - Action *Obtenir le contenu de l'URL* :
     - URL : `https://ecam-app.cyprien-veyret.workers.dev/api/files?kind=audio`
     - Méthode : POST
     - En-tête : `x-key` = ta clé (Réglages de l'app → Copier la clé)
     - Corps : *Fichier* → *Entrée du raccourci*
   - Action *Afficher la notification* : « Envoyé ».

En cours : app → cours → **Enregistrer** (ouvre le Dictaphone, écran éteint OK).
Après : Dictaphone → l'enregistrement → Partager → **Envoyer à ECAM**. Il est rattaché au cours sur lequel tu as appuyé.

## PC

- Démarrage automatique : `ECAM agent.cmd` dans le dossier Démarrage de Windows (`shell:startup`). Le supprimer pour arrêter.
- Lancement manuel : `pc/start-agent.cmd` (une seule instance à la fois, journal : `pc/agent.log`).
- L'app sait si le PC est allumé : l'agent interroge le serveur chaque minute (Réglages → Ordinateur : « vu il y a … »).
- Claude Code doit être connecté au compte Pro (`claude` dans un terminal, une fois).

## Fiches de cours

- Matière première : enregistrements et/ou documents rattachés au cours.
- Faite quand le cours est terminé et que rien n'a été ajouté depuis 3 h (serveur, toutes les 30 min), ou tout de suite avec « Faire la fiche maintenant ».
- Un ajout après coup (même le lendemain) refait la fiche 3 h plus tard.
- 19 h : notification des cours du jour pour lesquels rien n'a été envoyé.
