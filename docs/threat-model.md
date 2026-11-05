# Modèle de menaces

Ce document recense les attaques réalistes contre Music Room. Pour chaque risque : **l'attaque**, **notre protection**, et **ce qui reste**. Les chemins renvoient au code qui implémente la protection, pour pouvoir le vérifier.

Périmètre : l'API (`backend/`), les sockets temps réel, l'app Flutter (`mobile/`) et le déploiement Docker (`infra/`).

Deux scripts rejouent les attaques principales contre un serveur lancé (`make dev`) :

```sh
node docs/demos/brute-force.mjs                                  # 401 x5 puis 429
EMAIL=<compte de test> PASSWORD=<son mot de passe> node docs/demos/refresh-reuse.mjs
```

`API_URL=http://<hôte>:3000` cible un autre serveur. Les deux scripts n'utilisent que Node 22, sans dépendance.

## Vue d'ensemble

| # | Menace | Protection principale | Reste |
|---|---|---|---|
| 1 | Brute force du mot de passe | 5 essais / 15 min par IP + email, argon2id | Limiteur ouvert si Redis tombe |
| 2 | Vol de session | Refresh token à usage unique, réutilisation détectée | Jeton d'accès valide 15 min |
| 3 | Énumération des comptes | Mêmes réponses que le compte existe ou non | Un identifiant connu se vérifie |
| 4 | IDOR (accès aux données d'autrui) | Droits vérifiés à chaque requête, identifiants UUIDv7 | Abonnés d'une room devenue privée |
| 5 | Injection | Requêtes SQL paramétrées, règle ESLint, texte nettoyé | — |
| 6 | Payloads trop gros | Limite Fastify 1 Mio, longueurs max zod | Limites par défaut, non réglées |
| 7 | Spam | Limites sur recherche, amis, plan | Rooms, votes, sockets : #76, #77 |
| 8 | Fuite par les logs | Rédaction des jetons et mots de passe | — |

Les risques assumés (HTTP sans TLS, GPS falsifiable, jeton valide après déconnexion, Swagger public) sont détaillés à la fin.

## 1. Brute force du mot de passe

**Attaque.** Essayer des mots de passe en boucle sur `POST /v1/sessions` pour un email connu, ou essayer un mot de passe courant sur beaucoup d'emails (credential stuffing).

**Protection.**
- Deux compteurs Redis par tentative, comptés **avant** argon2 (`backend/src/routes/sessions.js`, `backend/src/security/limits.js`) :
  - `login` : 5 essais par couple IP + email toutes les 15 min ;
  - `loginIp` : 50 essais par IP toutes les 15 min (une salle de 42 partage une seule IP publique).
- Au-delà : `429 rate_limited` avec `Retry-After`, **même avec le bon mot de passe**. Un attaquant ne peut donc pas savoir si son 6e essai était le bon.
- Une connexion réussie remet le compteur du couple à zéro.
- Hachage argon2id (19 Mio, 2 passes, `backend/src/auth/passwords.js`) : chaque essai coûte cher même hors limite.
- Les clés Redis sont des hachés SHA-256 : ni email ni IP en clair dans Redis.
- Mêmes limites sur le mot de passe actuel demandé pour le changer ou lier Google : 5 essais / 15 min par utilisateur (`backend/src/auth/current-password.js`).

**Démo.** `node docs/demos/brute-force.mjs` : 5 réponses `401 invalid_credentials`, puis `429 rate_limited, retry after 900 s`. L'email utilisé n'existe pas : aucun vrai compte n'est bloqué.

**Ce qui reste.**
- **Si Redis est indisponible, le limiteur laisse passer** (`backend/src/security/rate-limit.js`). Choix assumé : une panne de cache ne doit pas bloquer tout le monde. Argon2 continue de ralentir les essais pendant la panne.
- Un attaquant qui dispose de beaucoup d'IP contourne `loginIp`. La limite par couple IP + email protège quand même chaque compte.
- `trustProxy` n'est pas activé : l'IP vue est celle de la connexion TCP. C'est juste tant qu'il n'y a pas de reverse proxy. Si on en ajoute un, il faudra l'activer, sinon tous les clients partageront l'IP du proxy.

## 2. Vol de session et rotation des refresh tokens

**Attaque.** Récupérer les jetons d'un utilisateur (appareil perdu, malware, copie du stockage du navigateur) pour agir à sa place.

**Protection.**
- Jeton d'accès : JWT HS256 de **15 min**, signé avec `JWT_SECRET` (32 caractères minimum, sinon l'API refuse de démarrer). Algorithme, émetteur et audience sont imposés à la vérification (`backend/src/auth/tokens.js`).
- Refresh token : 32 octets aléatoires, valable 30 jours, **stocké haché** (SHA-256) en base. Une fuite de la base ne donne pas de session utilisable.
- Une session par appareil (table `devices`) : on peut en révoquer une sans toucher aux autres.
- **Rotation à chaque usage** (`rotateSession`, `backend/src/auth/sessions.js`). Chaque refresh renvoie un nouveau refresh token, et l'ancien devient invalide :
  - ancien jeton rejoué **dans les 10 s** : `409 refresh_conflict`, rien n'est révoqué. C'est le cas normal de deux onglets qui rafraîchissent en même temps ;
  - ancien jeton rejoué **après 10 s** : `401 refresh_token_reused`. Le serveur révoque la session de l'appareil et ferme ses sockets. Le voleur et la victime doivent se reconnecter : la victime voit qu'il s'est passé quelque chose.
- Déconnexion (`DELETE /v1/sessions/current`) : révoque le refresh token de l'appareil et ferme ses sockets.
- Changement de mot de passe : révoque toutes les autres sessions. Réinitialisation par email : révoque toutes les sessions.
- Mobile : jetons dans `flutter_secure_storage` (Keystore sur Android, `mobile/lib/auth/session_store.dart`).

**Démo.** `EMAIL=… PASSWORD=… node docs/demos/refresh-reuse.mjs` :

```text
Victim signs in: 200 ok
Victim refreshes, gets a new token: 200 ok
Attacker replays the old token at once: 409 refresh_conflict
Attacker replays the old token again: 401 refresh_token_reused
Victim's current token: 401 invalid_refresh_token
```

**Ce qui reste.**
- Le jeton d'accès volé reste valable jusqu'à son expiration (15 min au plus), voir les risques assumés.
- Si le voleur rafraîchit **avant** la victime, c'est lui qui garde la session jusqu'à ce que la victime rafraîchisse à son tour. La réutilisation est alors détectée et la session coupée pour les deux.
- La détection ne révoque que l'appareil concerné, pas les autres sessions du compte.
- Sur le web servi en HTTP depuis une autre machine (`make share`), les jetons sont dans le `localStorage` en clair (`mobile/lib/core/app_storage_web.dart`). Un script injecté dans la page pourrait les lire.

## 3. Énumération des comptes

**Attaque.** Savoir si un email a un compte, pour cibler du phishing ou du brute force.

**Protection.** Les réponses ne dépendent pas de l'existence du compte :

| Route | Réponse |
|---|---|
| `POST /v1/users` (inscription) | Toujours `202`. Email déjà pris : un mail « déjà inscrit » part à son propriétaire, rien n'est dit à l'appelant. Le mot de passe est haché dans les deux cas, le temps de réponse est le même. |
| `POST /v1/sessions` (connexion) | Email inconnu, mauvais mot de passe, compte Google sans mot de passe : même `401 invalid_credentials`. Un haché factice est vérifié quand le compte n'existe pas, pour le même temps de réponse. `403 email_not_verified` n'arrive qu'après le bon mot de passe. |
| `POST /v1/password-resets` | Toujours `202`. |
| `POST /v1/users/verify-email/resend` | Toujours `202`. |

Les limites de débit sur le renvoi d'email et la réinitialisation sont comptées par email, que le compte existe ou non : un `429` ne révèle rien non plus.

La recherche d'utilisateurs (`GET /v1/users/search`) cherche par début de nom affiché, jamais par email. Elle ne renvoie que les comptes vérifiés, et elle est limitée à 30 recherches par minute.

**Ce qui reste.**
- `GET /v1/users/:id`, `PUT /v1/friends/:userId` et l'invitation dans une room répondent `404 user_not_found` à un identifiant inconnu. On peut donc vérifier qu'un identifiant **déjà connu** existe. Les identifiants sont des UUIDv7, impossibles à deviner (voir section 4).
- `GET /v1/users/:id` renvoie aussi les comptes pas encore vérifiés. Ce n'est pas grave : seul le profil public est visible, et il faut l'identifiant.

## 4. IDOR : accéder aux données d'un autre

**Attaque.** Changer un identifiant dans l'URL pour lire ou modifier une room privée, le profil d'un autre ou la file d'une room où l'on n'a pas les droits.

**Protection.**
- Les identifiants (utilisateurs, rooms, morceaux) sont des **UUIDv7** : 74 bits aléatoires, impossibles à énumérer (`backend/src/db/migrations/001_schema.sql`).
- Chaque route vérifie les droits en base, à chaque requête :
  - **rooms** : `loadVisibleRoom` (`backend/src/rooms/guards.js`) renvoie le même `404` pour « n'existe pas » et « privée, vous n'êtes pas membre ». Les règles sont dans `backend/src/rooms/access.js` :
    - `canView` : room publique ou membre ;
    - `canManage` : propriétaire seulement (modifier, supprimer, inviter, passer un morceau) ;
    - `canVote` : licence `everyone`, `invited` ou `place_time`.
  - **morceaux d'une room** : toujours cherchés avec l'identifiant de la room. Un morceau d'une autre room donne `404`.
  - **amis** : toutes les requêtes partent de l'utilisateur connecté. Seul le destinataire peut accepter une demande.
  - **profils** (`backend/src/users/profile.js`) :
    - groupe public : tout utilisateur connecté ;
    - groupe amis (ville, téléphone) : soi-même et amis acceptés ;
    - groupe privé : jamais, il n'est même pas lu en base par cette route. Seul `/v1/me` le renvoie à son propriétaire.
  - **sockets** : s'abonner à une room repasse par `loadVisibleRoom`.
- Les champs modifiables sont fixés par un schéma strict : envoyer `plan`, `email` ou `id` à `PATCH /v1/me` donne `400`.

**Ce qui reste.**
- Passer une room de publique à privée **ne déconnecte pas** les abonnés socket qui ne sont pas membres. Ils continuent de recevoir les événements jusqu'à leur déconnexion. Les abonnés sont expulsés seulement à la suppression de la room ou au retrait d'un membre.
- Le propriétaire d'une room peut inviter n'importe quel utilisateur par son identifiant, sans accord ni limite.
- Le premium est simulé : n'importe qui passe premium gratuitement (20 changements par heure). Les restrictions du plan gratuit ne protègent donc rien, elles illustrent l'offre.

## 5. Injection

**Attaque.** Glisser du SQL, du HTML ou des caractères invisibles dans un champ texte.

**Protection.**
- **SQL** :
  - toutes les requêtes passent des valeurs par `?` (mysql2), jamais par concaténation ;
  - une règle ESLint fait échouer la CI si une requête contient `${}` ou `+` (`backend/eslint.config.js`) ;
  - `multipleStatements` n'est activé que pour les migrations ;
  - les messages d'erreur SQL ne sont jamais renvoyés au client.
- **Texte saisi** : `safeText` (`backend/src/validation.js`) normalise en NFC, coupe les espaces et refuse :
  - les caractères de contrôle ;
  - les caractères qui inversent le sens du texte. Exemple : un nom qui s'afficherait « evil » à l'envers.
- **Emails** : le nom affiché est échappé dans le HTML (`backend/src/mail/templates.js`). Les liens sont construits à partir de `APP_BASE_URL`, jamais de l'en-tête `Host`.
- **Pages ouvertes depuis les emails** : CSP stricte, `X-Frame-Options: DENY`, `no-referrer`. Le jeton est retiré de l'URL dès la lecture (`backend/src/routes/email-pages.js`).
- **App Flutter** : les widgets `Text` n'interprètent pas le HTML.

**Ce qui reste.** `safeText` accepte `<` et `>`. Tout futur affichage dans du HTML (un client web autre que Flutter, par exemple) devra échapper le texte.

## 6. Payloads trop gros

**Attaque.** Envoyer des corps énormes ou des listes immenses pour saturer la mémoire ou la base.

**Protection.**
- Fastify refuse les corps de plus de 1 Mio (`413 payload_too_large`), Socket.IO les messages de plus de 1 Mo : ce sont les valeurs par défaut des deux bibliothèques.
- Chaque champ a une longueur maximale dans les schémas zod. Exemples :
  - nom affiché 50, bio 500, description de room 1000 ;
  - `genreIds` 20 éléments au maximum, sans doublon ;
  - jeton Google 4096 caractères ;
  - pages de résultats 20 à 50 éléments.
- Le JWT est refusé au-delà de 4096 caractères, avant toute vérification.

**Ce qui reste.** Les deux limites globales sont les valeurs par défaut, jamais réglées. Nos corps font moins de 10 Kio : `bodyLimit` pourrait descendre à 64 Kio.

## 7. Spam

**Attaque.** Un compte qui crée des rooms, ajoute des morceaux, vote ou envoie des événements socket en boucle.

**Protection.** Limites par utilisateur dans `backend/src/security/limits.js` :
- recherche de morceaux : 30 / min ;
- recherche d'utilisateurs : 30 / min ;
- demandes d'ami : 30 / h ;
- changement de plan : 20 / h.

Le plan gratuit limite à une room à la fois.

**Ce qui reste.**
- Rien ne limite la création de room (en premium), l'ajout de morceaux, les votes, les passages de morceau ni les invitations. Suivi par **#76**.
- Rien ne limite le nombre de sockets par compte ni le débit d'événements par socket. Suivi par **#77**.

## 8. Fuite d'informations par les logs

**Attaque.** Lire les logs (accès au serveur, capture d'écran partagée) pour y trouver des jetons ou des mots de passe.

**Protection** (`backend/src/logger.js`) :
- `authorization`, `password`, `token`, `refreshToken`, `idToken`, les cookies et les corps de requête sont remplacés par `[REDACTED]` ;
- une requête est loguée avec sa méthode et son modèle de route (`/v1/users/:id`), jamais l'URL réelle ni la query ;
- le mailer ne logue ni destinataire ni lien ;
- côté app, `ApiException` ne garde que le statut et le `code`, jamais le corps de la réponse.

## Risques assumés

Ces risques sont connus et acceptés pour ce projet. Pour chacun : pourquoi, et ce qu'il faudrait pour aller plus loin.

### HTTP sans TLS

L'API écoute en HTTP sur le port 3000, sans reverse proxy ni certificat (`infra/compose.prod.yml`). Sur un réseau partagé, un attaquant peut lire et modifier le trafic, jetons compris.

**Pourquoi.** Le projet tourne sur le réseau de l'école et sur `localhost`, sans nom de domaine pour obtenir un certificat. L'app Android en release refuse le HTTP en clair : le build de debug l'autorise pour les tests.

**Pour aller plus loin.** Un reverse proxy (Caddy) avec un certificat, en activant `trustProxy` (section 1).

### GPS falsifiable

La licence `place_time` vérifie la position envoyée par le téléphone dans l'en-tête `X-Location` (`backend/src/rooms/access.js`). Un utilisateur peut déclarer une fausse position et voter sans être sur place.

**Pourquoi.** Le serveur n'a aucun moyen de prouver la présence physique. Le code le dit lui-même. Le créneau horaire, lui, est vérifié avec l'heure du serveur.

**Pour aller plus loin.** Un code affiché sur place (QR code) ou une balise Bluetooth.

### Jeton d'accès valide 15 min après la déconnexion

La déconnexion révoque le refresh token, mais le jeton d'accès déjà émis reste accepté jusqu'à son expiration : l'API vérifie la signature du JWT sans consulter la base (`backend/src/auth/guards.js`). Même chose après un changement ou une réinitialisation de mot de passe. Un socket peut aussi se reconnecter pendant ce temps : le jeton n'est vérifié qu'à l'ouverture du socket.

**Pourquoi.** C'est le compromis habituel des JWT : aucune requête en base par appel. La fenêtre est courte, et les sockets ouverts de l'appareil sont fermés tout de suite.

**Pour aller plus loin.** Une liste de jetons révoqués dans Redis, consultée par `requireAuth` et à la connexion du socket.

### Swagger public

La documentation interactive `/docs` est exposée, y compris en production (`backend/src/utils/docs.js`). Elle décrit toutes les routes et leurs schémas.

**Pourquoi.** Le sujet demande une API documentée, et les correcteurs l'utilisent. La documentation ne donne aucun accès : toutes les routes protégées exigent un jeton. Le terrain de jeu `/dev`, qui crée des jetons sans mot de passe, n'existe qu'en développement.

**Pour aller plus loin.** Servir `/docs` seulement en développement, ou derrière une authentification.

### Autres points connus

- Redis n'a pas de mot de passe. Il n'est joignable que par le réseau Docker interne en production, et seulement sur `127.0.0.1` en développement.
- Pas d'en-têtes de sécurité HTTP globaux (helmet) : l'API ne sert que du JSON, et les seules pages HTML (celles des emails) ont leurs propres en-têtes.
- La connexion Google (`POST /v1/sessions/oauth`), la vérification d'email et la confirmation de réinitialisation n'ont pas de limite de débit. Elles exigent un jeton Google signé ou un jeton de 256 bits : impossibles à deviner.

## Relecture

Ce document est validé quand chaque membre de l'équipe l'a relu. Cocher en relisant :

- [ ] Mathis (@MPIT0T)
- [ ] Max (@maxdegers)
- [ ] Vincent (@vgarcia69)
- [ ] Yann (@yannallo)
