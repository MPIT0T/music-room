# Contrat d'API : authentification (v1.1)

Statut : **proposition, phase 1**. Toute modification de ce contrat passe par une PR.

v1.1 : `User-Agent` normalisé, limite sur le renvoi d'email, profil (`/v1/me`), changement de mot de passe, liaison Google, appareils.

Base URL : `APP_BASE_URL` (dev : `http://localhost:3000`). Toutes les routes sont préfixées par `/v1`.

## Conventions communes

### En-têtes envoyés par l'app

| En-tête | Obligatoire | Exemple | Rôle |
|---|---|---|---|
| `Content-Type` | oui si corps | `application/json` | |
| `Authorization` | routes protégées | `Bearer <accessToken>` | identifie l'utilisateur |
| `User-Agent` | recommandé | `MusicRoom/1.2.0 (android; Pixel 7)` | logs uniquement |

Format du `User-Agent` : `MusicRoom/<version> (<plateforme>; <modèle>)`, avec `<plateforme>` parmi `android`, `ios`, `web`. Le serveur en extrait la plateforme, le modèle et la version pour les logs (tronqués à 64 caractères, `unknown` si absents ou hors format). Ces valeurs servent au diagnostic, jamais à une décision de sécurité.

Sur Flutter web, le navigateur interdit de modifier `User-Agent` : les logs indiqueront `unknown`. Ce n'est pas bloquant.

Chaque réponse contient `X-Request-Id` (UUID généré par le serveur). L'app l'affiche dans les rapports de bug : il permet de retrouver la requête dans les logs. Un `X-Request-Id` envoyé par le client est ignoré.

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Format | JWT HS256 | chaîne opaque (32 octets aléatoires, base64url) |
| Durée de vie | 15 min | 30 jours, renouvelée à chaque refresh |
| Usage | en-tête `Authorization` et handshake Socket.IO | uniquement `POST /v1/sessions/refresh` |
| Stockage côté app | en mémoire | `flutter_secure_storage` (jamais `SharedPreferences`) |
| Stockage côté serveur | rien (signé) | hash SHA-256 dans `devices.refresh_hash` |

Claims de l'access token : `sub` (id utilisateur), `did` (id de l'appareil/session), `iat`, `exp`. L'app **ne doit pas** décoder le JWT pour prendre des décisions : elle utilise `accessTokenExpiresIn` et les codes d'erreur.

Une **session = un appareil** : chaque connexion crée une ligne `devices`. Se déconnecter sur un téléphone ne déconnecte pas les autres.

### Objet `device` (envoyé à chaque connexion)

```json
{ "name": "Pixel de Max", "platform": "android", "model": "Pixel 7", "appVersion": "1.2.0" }
```

| Champ | Type | Contraintes |
|---|---|---|
| `name` | string | 1–100 caractères, obligatoire |
| `platform` | string | `android`, `ios` ou `web`, obligatoire |
| `model` | string | ≤ 100 caractères, facultatif |
| `appVersion` | string | ≤ 20 caractères, facultatif |

### Objet `user` (renvoyé par l'API)

```json
{
  "id": "0192f3a4-7b1c-7d2e-9f00-1a2b3c4d5e6f",
  "email": "max@example.com",
  "emailVerified": true,
  "displayName": "Max",
  "avatarUrl": null,
  "plan": "free",
  "providers": ["password", "google"]
}
```

### Objet `session` (renvoyé par login, OAuth et refresh)

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "accessTokenExpiresIn": 900,
  "refreshToken": "q8Xf0...base64url...",
  "refreshTokenExpiresIn": 2592000,
  "user": { "...": "objet user" }
}
```

`*ExpiresIn` sont en secondes.

### Erreurs : `application/problem+json` (RFC 9457)

Toutes les erreurs ont ce format et ce `Content-Type` :

```json
{
  "type": "/problems/invalid-credentials",
  "title": "Invalid credentials",
  "status": 401,
  "code": "invalid_credentials",
  "requestId": "6f1c2e0a-8a3b-4c55-9d1e-2f7a0b9c1d3e"
}
```

L'app se base **uniquement sur `code`** (stable). `title` et `detail` sont en anglais, pour les développeurs, et ne doivent pas être affichés tels quels.

Les erreurs de validation (400) ajoutent `errors` :

```json
{
  "type": "/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "validation_failed",
  "requestId": "...",
  "errors": [{ "path": "password", "message": "must contain at least 8 characters" }]
}
```

Codes communs à toutes les routes :

| Status | `code` | Quand |
|---|---|---|
| 400 | `validation_failed` | corps invalide (voir `errors`) |
| 401 | `unauthorized` | `Authorization` absent, invalide ou expiré (route protégée) |
| 429 | `rate_limited` | trop de tentatives ; attendre `Retry-After` secondes |
| 500 | `internal_error` | bug serveur ; afficher un message générique + `requestId` |

### Règles de mot de passe

8 à 128 caractères, pas de règle de composition imposée (recommandation NIST SP 800-63B). Haché côté serveur avec argon2id. Le mot de passe n'est jamais renvoyé ni logué.

---

## `POST /v1/users` : inscription

```json
{ "email": "max@example.com", "password": "correct horse battery", "displayName": "Max" }
```

| Champ | Contraintes |
|---|---|
| `email` | email valide, ≤ 255, normalisé en minuscules |
| `password` | 8–128 caractères |
| `displayName` | 1–50 caractères |

**Réponse `202 Accepted`**, corps vide, **dans tous les cas**, y compris si l'email existe déjà.

- Nouvel email : le compte est créé et un email de vérification est envoyé (lien valable 24 h).
- Email déjà utilisé : aucun compte créé ; le propriétaire reçoit un email « quelqu'un a essayé de créer un compte avec votre adresse ».

Pourquoi : répondre `409` dirait à n'importe qui quels emails ont un compte (énumération).

L'utilisateur ne peut pas se connecter par mot de passe avant d'avoir vérifié son email. L'app affiche : « Vérifie ta boîte mail ».

| Status | `code` |
|---|---|
| 400 | `validation_failed` |
| 429 | `rate_limited` |

## `POST /v1/users/verify-email` : vérification de l'email

L'email contient un lien `APP_BASE_URL/verify-email?token=...` qui ouvre l'app (ou la page web), laquelle envoie :

```json
{ "token": "..." }
```

**Réponse `204 No Content`.** L'utilisateur peut maintenant se connecter.

| Status | `code` | Quand |
|---|---|---|
| 400 | `invalid_token` | token inconnu, expiré ou déjà utilisé |

Un `POST` (et non un `GET` sur le lien) évite que les antivirus de messagerie, qui ouvrent les liens, consomment le token.

## `POST /v1/users/verify-email/resend` : renvoyer l'email

```json
{ "email": "max@example.com" }
```

**Réponse `202`** (même raison que l'inscription). Renvoie un email seulement si le compte existe et n'est pas vérifié. L'ancien lien est invalidé.

| Status | `code` | Quand |
|---|---|---|
| 429 | `rate_limited` | plus d'une demande par minute pour cet email ; attendre `Retry-After` secondes |

La limite est comptée **par email normalisé, que le compte existe ou non**. Sinon, recevoir un `429` sur un email et un `202` sur un autre révélerait lequel a un compte.

## `POST /v1/sessions` : connexion email / mot de passe

```json
{
  "email": "max@example.com",
  "password": "correct horse battery",
  "device": { "name": "Pixel de Max", "platform": "android", "model": "Pixel 7", "appVersion": "1.2.0" }
}
```

**Réponse `200`** : objet `session`.

| Status | `code` | Quand |
|---|---|---|
| 401 | `invalid_credentials` | email inconnu **ou** mauvais mot de passe (même réponse, même temps de réponse) |
| 403 | `email_not_verified` | mot de passe correct mais email non vérifié ; proposer « renvoyer l'email » |
| 429 | `rate_limited` | 5 échecs / 15 min par couple IP + email |

Un compte créé via Google sans mot de passe renvoie `invalid_credentials` : l'app propose « Continuer avec Google ».

## `POST /v1/sessions/oauth` : connexion Google

L'app obtient un **ID token** Google avec `google_sign_in` (`serverClientId` = client ID **web**), puis :

```json
{
  "provider": "google",
  "idToken": "eyJhbGciOiJSUzI1NiIs...",
  "device": { "name": "Pixel de Max", "platform": "android" }
}
```

Le serveur vérifie la signature Google, `iss`, `exp`, et que `aud` est l'un de nos client IDs (`GOOGLE_CLIENT_ID_WEB`, `GOOGLE_CLIENT_ID_ANDROID`).

**Réponse `200`** (compte existant) ou **`201`** (compte créé) : objet `session`.

Règles de liaison de compte :

1. Compte Google déjà lié → connexion.
2. Sinon, si l'email Google est vérifié (`email_verified`) et qu'un compte local a le même email → le compte Google y est lié. Si l'email de ce compte local n'était pas vérifié, son mot de passe est **supprimé** (protection contre le pré-détournement : quelqu'un aurait pu créer le compte avec l'email de la victime avant elle).
3. Sinon → nouveau compte, email marqué vérifié, `displayName` = nom Google.

| Status | `code` | Quand |
|---|---|---|
| 400 | `unsupported_provider` | `provider` ≠ `google` |
| 401 | `invalid_oauth_token` | signature, expiration ou audience invalide |
| 403 | `oauth_email_not_verified` | Google indique un email non vérifié |
| 503 | `oauth_unavailable` | client ID non configuré côté serveur |

## `POST /v1/sessions/refresh` : renouveler les tokens

Pas d'en-tête `Authorization` (l'access token est peut-être expiré).

```json
{ "refreshToken": "q8Xf0..." }
```

**Réponse `200`** : un **nouvel** objet `session`. L'ancien refresh token est invalidé (rotation) : l'app **remplace** les deux tokens stockés.

| Status | `code` | Quand | Action de l'app |
|---|---|---|---|
| 401 | `invalid_refresh_token` | inconnu, expiré ou révoqué | supprimer les tokens, écran de connexion |
| 401 | `refresh_token_reused` | un ancien refresh token a été rejoué : vol probable, **la session de cet appareil est révoquée** | idem |
| 409 | `refresh_conflict` | même token envoyé deux fois en moins de 10 s (deux refresh simultanés) | relire les tokens stockés et réessayer la requête d'origine |

**Obligatoire côté app** : un seul refresh à la fois (single-flight). Si plusieurs requêtes reçoivent `401 unauthorized` en même temps, elles attendent le même refresh. Sinon, le deuxième refresh rejoue un token déjà tourné.

## `DELETE /v1/sessions/current` : déconnexion

`Authorization: Bearer <accessToken>`, pas de corps.

**Réponse `204`.** Le refresh token de cet appareil est révoqué (`refresh_hash`, `previous_refresh_hash` et `refresh_expires_at` vidés) et ses sockets sont fermés. **La ligne `devices` est conservée** : `control_delegations` est en `ON DELETE CASCADE` sur `devices`, la supprimer effacerait les délégations de contrôle de l'appareil. L'access token reste valide jusqu'à son expiration (≤ 15 min). L'app supprime les deux tokens.

## `POST /v1/password-resets` : demander une réinitialisation

```json
{ "email": "max@example.com" }
```

**Réponse `202`**, toujours. Si le compte existe, un email avec un lien `APP_BASE_URL/reset-password?token=...` est envoyé (valable 1 h, usage unique). Les liens précédents sont invalidés.

| Status | `code` |
|---|---|
| 429 | `rate_limited` (3 demandes / heure par email) |

## `POST /v1/password-resets/confirm` : choisir le nouveau mot de passe

```json
{ "token": "...", "newPassword": "another long passphrase" }
```

**Réponse `204`.** Effets :
- le mot de passe est changé ;
- **toutes les sessions** de l'utilisateur sont révoquées (tous ses appareils) ;
- l'email est marqué vérifié (le lien prouve la possession de la boîte mail).

L'app renvoie vers l'écran de connexion.

| Status | `code` | Quand |
|---|---|---|
| 400 | `invalid_token` | inconnu, expiré ou déjà utilisé |
| 400 | `validation_failed` | mot de passe hors règles |

---

## Profil et compte (v1.1)

Toutes ces routes demandent `Authorization: Bearer <accessToken>`.

### Objet `me` (mon profil complet)

```json
{
  "id": "0192f3a4-7b1c-7d2e-9f00-1a2b3c4d5e6f",
  "emailVerified": true,
  "plan": "free",
  "providers": ["password", "google"],
  "public": {
    "displayName": "Max",
    "avatarUrl": null,
    "bio": "Fan de jazz",
    "genres": [{ "id": 3, "name": "Jazz" }]
  },
  "friends": { "city": "Paris", "phone": null },
  "private": { "realName": "Maximilien B.", "birthDate": "1999-04-12", "email": "max@example.com" }
}
```

Les trois groupes suivent l'exigence ACC-8 (« Who sees what ») et fixent ce que verra un autre utilisateur sur ma page de profil (contrat v1.2, avec les amis et la recherche) :

| Groupe | Champs | Visible par |
|---|---|---|
| `public` | `displayName`, `avatarUrl`, `bio`, `genres` | tout utilisateur connecté |
| `friends` | `city`, `phone` | mes amis acceptés |
| `private` | `realName`, `birthDate`, `email` | moi seul |

Le groupe d'un champ n'est pas modifiable.

### `GET /v1/me`

**Réponse `200`** : objet `me`.

### `PATCH /v1/me`

Corps : uniquement les champs à modifier. `null` efface un champ facultatif.

```json
{ "displayName": "Max", "bio": "Fan de jazz", "city": "Paris", "genreIds": [3, 7] }
```

| Champ | Contraintes |
|---|---|
| `displayName` | 1–50 caractères, ne peut pas être `null` |
| `bio` | ≤ 500 caractères |
| `city` | ≤ 100 caractères |
| `realName` | ≤ 100 caractères |
| `phone` | ≤ 30 caractères |
| `birthDate` | `AAAA-MM-JJ`, dans le passé |
| `genreIds` | ≤ 20 ids existants ; remplace la liste entière |

`email` et `avatarUrl` ne sont pas modifiables en v1.1 : changer d'email demande un nouveau flux de vérification, et l'avatar demandera un upload (une URL libre permettrait de faire charger n'importe quelle adresse par les autres utilisateurs).

**Réponse `200`** : objet `me` à jour.

| Status | `code` | Quand |
|---|---|---|
| 400 | `validation_failed` | champ hors contraintes, champ inconnu |
| 400 | `unknown_genre` | un id de `genreIds` n'existe pas |

### `DELETE /v1/me` : supprimer mon compte

L'access token seul ne suffit pas : on redemande une preuve d'identité, pour qu'un token volé ne permette pas de supprimer le compte.

```json
{ "password": "correct horse battery" }
```

ou, pour un compte sans mot de passe :

```json
{ "provider": "google", "idToken": "eyJhbGciOiJSUzI1NiIs..." }
```

**Réponse `204`.** Le compte et toutes ses données (sessions, appareils et leurs délégations, liaisons Google, amis, genres, votes) sont supprimés, ainsi que **les rooms qu'il possède** (exigence ACC-10, pas de transfert de propriété). Tous les sockets de l'utilisateur sont fermés.

> **Dépendance schéma** : la clé étrangère `fk_rooms_owner` (`rooms.owner_id`) n'a pas de `ON DELETE` ; tant qu'elle n'est pas en `ON DELETE CASCADE` (demandé à Mathis), la suppression d'un utilisateur qui possède une room échoue. Cette route ne sera livrée qu'après cette migration.

| Status | `code` | Quand |
|---|---|---|
| 401 | `invalid_credentials` | mauvais mot de passe |
| 401 | `invalid_oauth_token` | ID token invalide, ou d'un autre compte Google que celui lié |
| 429 | `rate_limited` | 5 échecs / 15 min par utilisateur |

### `PUT /v1/me/password` : changer de mot de passe

```json
{ "currentPassword": "correct horse battery", "newPassword": "another long passphrase" }
```

**Réponse `204`.** Toutes les **autres** sessions sont révoquées ; celle de cet appareil reste valide.

| Status | `code` | Quand |
|---|---|---|
| 400 | `validation_failed` | `newPassword` hors règles |
| 401 | `invalid_credentials` | `currentPassword` incorrect |
| 409 | `no_password` | compte sans mot de passe (Google uniquement) : en définir un via `POST /v1/password-resets`, qui prouve la possession de l'email |
| 429 | `rate_limited` | 5 échecs / 15 min par utilisateur |

### `PUT /v1/me/oauth/google` : lier un compte Google

```json
{ "idToken": "eyJhbGciOiJSUzI1NiIs..." }
```

L'ID token est vérifié comme pour `POST /v1/sessions/oauth`. L'email du compte Google peut être différent de celui du compte Music Room.

**Réponse `200`** : objet `me` (`providers` contient `google`). Idempotent : renvoyer le même compte Google déjà lié répond aussi `200`.

| Status | `code` | Quand |
|---|---|---|
| 401 | `invalid_oauth_token` | signature, expiration ou audience invalide |
| 409 | `already_linked` | un **autre** compte Google est déjà lié à ce compte : le délier d'abord |
| 409 | `oauth_account_in_use` | ce compte Google est lié à un autre utilisateur |

### `DELETE /v1/me/oauth/google` : délier Google

**Réponse `200`** : objet `me`.

| Status | `code` | Quand |
|---|---|---|
| 404 | `not_linked` | aucun compte Google lié |
| 409 | `last_login_method` | le compte n'a pas de mot de passe : délier l'empêcherait de se reconnecter. Définir d'abord un mot de passe via `POST /v1/password-resets` |

---

## Appareils (v1.1)

Un appareil = une session (voir « Tokens »). Routes protégées par `Authorization: Bearer <accessToken>`.

### Objet `device` (renvoyé par l'API)

```json
{
  "id": "0192f3a4-0000-7000-8000-00000000000d",
  "name": "Pixel de Max",
  "platform": "android",
  "model": "Pixel 7",
  "appVersion": "1.2.0",
  "signedIn": true,
  "lastSeenAt": "2026-10-08T14:03:00.000Z",
  "createdAt": "2026-10-01T09:12:00.000Z",
  "current": true
}
```

`current` vaut `true` pour l'appareil qui fait la requête (claim `did` de l'access token). `signedIn` vaut `false` après une déconnexion (`DELETE /v1/sessions/current`) : l'appareil reste listé tant que sa ligne existe. Les dates sont en UTC (ISO 8601).

### `GET /v1/me/devices`

**Réponse `200`** : `{ "devices": [ ...objets device ] }`, du plus récemment vu au plus ancien.

### `PATCH /v1/me/devices/:id` : renommer

```json
{ "name": "Téléphone perso" }
```

**Réponse `200`** : objet `device`.

| Status | `code` | Quand |
|---|---|---|
| 400 | `validation_failed` | `name` vide ou > 100 caractères |
| 404 | `device_not_found` | appareil inconnu **ou appartenant à un autre utilisateur** (même réponse, pour ne pas révéler les ids des autres) |

### `DELETE /v1/me/devices/:id` : déconnecter un appareil

**Réponse `204`.** La ligne `devices` est **supprimée**, avec ses délégations de contrôle (`control_delegations`, en cascade), et ses sockets sont fermés. C'est la seule route qui supprime un appareil. Sur l'appareil courant, l'app supprime ensuite ses tokens.

| Status | `code` | Quand |
|---|---|---|
| 404 | `device_not_found` | même règle que ci-dessus |

---

## Socket.IO

Connexion avec l'access token dans le handshake :

```js
io(APP_BASE_URL, { auth: { token: accessToken } });
```

| Cas | Résultat |
|---|---|
| token valide | connexion acceptée ; `socket.data.userId` = `sub`, `socket.data.deviceId` = `did` |
| token absent, invalide ou expiré | événement `connect_error` avec `err.message === "unauthorized"` |

En cas de `connect_error: unauthorized`, l'app fait un refresh puis se reconnecte avec le nouveau token. Le token n'est vérifié qu'au handshake : une connexion déjà ouverte n'est pas coupée quand l'access token expire, mais elle l'est à la déconnexion (`DELETE /v1/sessions/current`, `DELETE /v1/me/devices/:id`), au changement ou à la réinitialisation du mot de passe, et à la suppression du compte.

## Récapitulatif

| Méthode | Route | Auth | Succès |
|---|---|---|---|
| POST | `/v1/users` | non | 202 |
| POST | `/v1/users/verify-email` | non | 204 |
| POST | `/v1/users/verify-email/resend` | non | 202 |
| POST | `/v1/sessions` | non | 200 `session` |
| POST | `/v1/sessions/oauth` | non | 200 / 201 `session` |
| POST | `/v1/sessions/refresh` | non | 200 `session` |
| DELETE | `/v1/sessions/current` | Bearer | 204 |
| POST | `/v1/password-resets` | non | 202 |
| POST | `/v1/password-resets/confirm` | non | 204 |
| GET | `/v1/me` | Bearer | 200 `me` |
| PATCH | `/v1/me` | Bearer | 200 `me` |
| DELETE | `/v1/me` | Bearer + preuve | 204 |
| PUT | `/v1/me/password` | Bearer | 204 |
| PUT | `/v1/me/oauth/google` | Bearer | 200 `me` |
| DELETE | `/v1/me/oauth/google` | Bearer | 200 `me` |
| GET | `/v1/me/devices` | Bearer | 200 |
| PATCH | `/v1/me/devices/:id` | Bearer | 200 `device` |
| DELETE | `/v1/me/devices/:id` | Bearer | 204 |
