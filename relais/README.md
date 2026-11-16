# Installer le relais Séance

La [version en ligne](https://lonjhe.github.io/Test-git/) tourne dans votre
navigateur. Si l'ajout de votre abonnement affiche « Le navigateur n'a pas pu
joindre ce serveur », c'est que votre fournisseur n'est accessible qu'en HTTP, ou
qu'il refuse les appels venant d'un site web. Un navigateur ne peut pas passer outre.

Le relais règle ça : c'est un petit programme, hébergé gratuitement sur **votre**
compte Cloudflare, qui va chercher le catalogue et les vidéos chez votre fournisseur
et les transmet à la page. Comptez dix minutes, sans rien installer sur votre
ordinateur.

> Vous n'avez pas besoin du relais si vous lancez Séance chez vous avec `npm start` :
> son serveur fait déjà ce travail.

## 1. Créer le relais

1. Créez un compte gratuit sur <https://dash.cloudflare.com/sign-up> (une adresse
   e-mail suffit, pas de carte bancaire).
2. Dans le menu, ouvrez **Workers & Pages**, puis **Create application** →
   **Create Worker** (ou « Start with Hello World! »).
3. Donnez-lui un nom, par exemple `seance-relais`, puis cliquez sur **Deploy**.
4. Cliquez sur **Edit code**. Effacez tout le contenu de l'éditeur et collez à la
   place le contenu du fichier [`worker.js`](worker.js) (bouton « Copy raw file » sur
   GitHub). Cliquez sur **Deploy**.

## 2. Choisir une clé

La clé empêche n'importe qui d'utiliser votre relais.

1. Revenez sur la page du Worker, onglet **Settings**, rubrique
   **Variables and Secrets**, puis **Add**.
2. Type : **Secret**. Nom : `CLE` (en majuscules). Valeur : un mot de passe long de
   votre choix, que vous n'utilisez nulle part ailleurs.
3. Cliquez sur **Deploy**.

## 3. Le brancher dans Séance

1. Notez l'adresse du Worker, affichée en haut de sa page. Elle ressemble à
   `https://seance-relais.votre-compte.workers.dev`.
2. Dans Séance en ligne, ouvrez **Réglages → Relais**, saisissez cette adresse et
   votre clé, puis **Enregistrer le relais**. Séance vérifie que le relais répond.
3. Ajoutez ensuite votre abonnement dans **Sources**, avec l'adresse exacte donnée
   par votre fournisseur (`http://…` compris).

Le relais se règle une fois par appareil : la clé est conservée dans le navigateur.

## Bon à savoir

- **Quota gratuit.** Cloudflare accorde 100 000 requêtes par jour, remises à zéro à
  minuit UTC. Un film compte pour quelques requêtes ; une chaîne en direct, environ
  un millier par heure. Au-delà, le relais répond par une erreur jusqu'au lendemain.
- **Ça peut ne pas suffire.** Certains fournisseurs refusent les connexions venant
  d'hébergeurs, ou lient l'abonnement à l'adresse de votre box. Dans ce cas Séance
  indique que le relais n'a pas réussi à joindre le fournisseur, et la seule solution
  est d'installer Séance chez vous.
- **Formats.** Le relais transmet la vidéo telle quelle : il ne la convertit pas. Les
  formats que votre navigateur ne sait pas lire (certains MKV, HEVC, son AC3/DTS)
  restent illisibles.
- **Confidentialité.** Vos identifiants et vos flux transitent par votre relais, sur
  votre compte Cloudflare ; ils ne passent par aucun serveur de Séance. Ne partagez
  ni l'adresse ni la clé.
- **Mettre à jour ou supprimer.** Pour mettre à jour, recollez `worker.js` dans
  l'éditeur et redéployez. Pour tout arrêter, supprimez le Worker dans le tableau de
  bord Cloudflare, puis désactivez le relais dans les réglages de Séance.

## En ligne de commande (facultatif)

```bash
cd relais
npx wrangler deploy
npx wrangler secret put CLE
```
