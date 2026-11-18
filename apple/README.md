# Séance pour iPhone, iPad, Mac et Apple TV

Deux applications, générées à partir du même projet :

| App | Appareils | Fonctionnement |
| --- | --- | --- |
| **Seance** | iPhone, iPad, Mac | l'interface web de Séance dans une fenêtre native : tout ce que fait le site, plus l'adresse du serveur mémorisée, AirPlay et la lecture plein écran |
| **SeanceTV** | Apple TV | un client natif (tvOS n'a pas de vue web), piloté à la télécommande Siri, qui lit le catalogue et lance la vidéo avec le lecteur d'Apple |

**Ces applications ne remplacent pas le serveur** : elles se connectent à Séance, qui doit tourner sur un
ordinateur du réseau (`npm start`, voir le [README principal](../README.md)). Au premier lancement, elles
demandent l'adresse affichée par le serveur, par exemple `192.168.1.20:8080`.

> **Ce code n'a pas été compilé.** Il a été écrit sur Linux, sans Xcode. Les formats échangés avec le
> serveur sont vérifiés par `npm test`, mais le Swift lui-même ne l'est pas : attendez-vous à corriger
> quelques erreurs de compilation au premier build. Si Xcode en affiche, copiez la liste des erreurs
> (onglet « Issues ») : elles se règlent vite.

## Sans rien compiler : installer le site comme une app

Pour iPhone, iPad et Mac, c'est possible dès maintenant, sans Xcode :

- **iPhone / iPad** : ouvrez l'adresse du serveur dans Safari, touchez **Partager → Sur l'écran d'accueil**.
- **Mac** : ouvrez-la dans Safari, puis **Fichier → Ajouter au Dock**.

Séance s'ouvre alors en plein écran, avec son icône. L'Apple TV n'a pas de navigateur : il lui faut l'app ci-dessous.

## Compiler les apps

Il faut un Mac avec **Xcode 15 ou plus** (gratuit, App Store) et un identifiant Apple (gratuit).

1. Installez XcodeGen : `brew install xcodegen` (Homebrew : <https://brew.sh>).
2. Dans `apple/project.yml`, remplacez `com.example` par un identifiant qui vous est propre, par exemple
   `fr.votrenom` (à faire à trois endroits : `bundleIdPrefix` et les deux `PRODUCT_BUNDLE_IDENTIFIER`).
   Apple refuse un identifiant déjà pris.
3. Générez le projet puis ouvrez-le :
   ```bash
   cd apple
   xcodegen generate
   open Seance.xcodeproj
   ```
4. Dans Xcode, pour chacune des deux cibles (**Seance** et **SeanceTV**) : onglet **Signing & Capabilities**,
   choisissez votre **Team** (ajoutez votre identifiant Apple dans *Xcode → Settings → Accounts* si besoin).

### iPhone et iPad

Branchez l'appareil, activez le **Mode développeur** (*Réglages → Confidentialité et sécurité*), choisissez-le
dans la barre de Xcode (cible **Seance**) et lancez avec ⌘R. La première fois, faites confiance au profil dans
*Réglages → Général → VPN et gestion de l'appareil*.

### Mac

Choisissez **My Mac** (cible **Seance**) et lancez avec ⌘R. Pour garder l'app : *Product → Show Build Folder in
Finder*, ouvrez `Products/Debug` et glissez `Seance.app` dans Applications. Le menu *Seance → Changer de serveur…*
rouvre l'écran de connexion.

### Apple TV

1. Sur l'Apple TV : *Réglages → Télécommandes et appareils → Télécommande et appareils → Apple TV Remote*
   (même Wi-Fi que le Mac).
2. Dans Xcode : *Window → Devices and Simulators*, bouton **+**, choisissez l'Apple TV et saisissez le code
   affiché à l'écran.
3. Choisissez la cible **SeanceTV** et l'Apple TV comme destination, puis ⌘R.

Avec un compte Apple **gratuit**, une app installée ainsi expire au bout de **7 jours** : il suffit de la
réinstaller depuis Xcode. Un compte développeur payant (99 €/an) lève cette limite et permet TestFlight.

## Ce que fait l'app Apple TV

Accueil par étagères (reprise de lecture, ma liste, ajouts récents, mieux notés, genres, séries, TV en direct),
films et séries filtrables par genre et triables, fiches avec « Dans le même style », épisodes par saison,
chaînes par catégorie, favoris et reprises partagés avec les autres écrans.

Ce qu'elle ne fait pas (utilisez le site ou l'app iPhone/Mac pour cela) : la recherche, l'outil « Découvrir »,
le réglage des sources et de la clé TMDB, le zapping entre chaînes pendant la lecture.

### Les vidéos MKV sur Apple TV

L'Apple TV ne lit que les MP4 (H.264/HEVC) et le HLS. Pour les MKV ou le son AC3/DTS, **installez ffmpeg sur
l'ordinateur qui fait tourner Séance** (`brew install ffmpeg`) : le serveur convertit alors la vidéo en HLS et
l'Apple TV la lit. Sans ffmpeg, l'app l'indique à l'écran. La reprise de lecture fonctionne ; l'avance rapide
dans une vidéo convertie est limitée à ce qui est déjà préparé.

## Limites connues

- **Réseau.** Le serveur doit être joignable : Mac allumé, même Wi-Fi. Hors de la maison, il faudrait un accès
  distant (VPN type Tailscale) ; ce n'est pas prévu dans l'app.
- **HTTP.** Le serveur Séance parle en HTTP sur le réseau local : les apps l'autorisent (`NSAllowsArbitraryLoads`).
  Cela suffit pour un usage personnel ; l'App Store demanderait de le justifier.
- **Icône Apple TV.** Seules les icônes iPhone, iPad et Mac sont fournies ; l'Apple TV exige une icône à
  plusieurs couches, à ajouter dans Xcode (*SeanceTV → Assets*) pour une diffusion hors de votre foyer.
- **App Store.** Non traité : il faudrait un compte payant, une icône tvOS, et justifier auprès d'Apple une app
  qui lit des flux IPTV.

## Organisation du code

```
apple/
  project.yml        définition du projet (XcodeGen)
  Config/            Info.plist et droits de l'app Mac
  Shared/            adresse du serveur et écran de connexion (toutes les apps)
  App/               iPhone, iPad, Mac : fenêtre web (WKWebView)
  TV/                Apple TV : modèles, client de l'API, écrans, lecteur
```

Les formats attendus par `TV/Models.swift` sont contrôlés par `test/apple-contract.test.js` : si le serveur
change, ce test échoue avant que l'app Apple TV ne casse.
