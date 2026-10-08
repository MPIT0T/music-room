# Contrat d'API : authentification (v1)

Statut : **proposition, phase 1**. Toute modification de ce contrat passe par une PR.

Base URL : `APP_BASE_URL` (dev : `http://localhost:3000`). Toutes les routes sont préfixées par `/v1`.

## Conventions communes

### En-têtes envoyés par l'app

| En-tête | Obligatoire | Exemple | Rôle |
|---|---|---|---|
| `Content-Type` | oui si corps | `application/json` | |
| `Authorization` | routes protégées | `Bearer <accessToken>` | identifie l'utilisateur |
| `X-Platform` | recommandé | `android`, `ios`, `web` | logs uniquement |
| `X-Device` | recommandé | `Pixel 7` | logs uniquement |
| `X-App-Version` | recommandé | `1.2.0` | logs uniquement |

Les en-têtes `X-*` servent au diagnostic (tronqués à 64 caractères), jamais à une décision de sécurité.

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

**Réponse `202`**, toujours (même raison que l'inscription). Renvoie un email seulement si le compte existe et n'est pas vérifié. L'ancien lien est invalidé.

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

**Réponse `204`.** Le refresh token de cet appareil est révoqué ; l'access token reste valide jusqu'à son expiration (≤ 15 min). L'app supprime les deux tokens.

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

## Socket.IO

Connexion avec l'access token dans le handshake :

```js
io(APP_BASE_URL, { auth: { token: accessToken } });
```

| Cas | Résultat |
|---|---|
| token valide | connexion acceptée ; `socket.data.userId` = `sub`, `socket.data.deviceId` = `did` |
| token absent, invalide ou expiré | événement `connect_error` avec `err.message === "unauthorized"` |

En cas de `connect_error: unauthorized`, l'app fait un refresh puis se reconnecte avec le nouveau token. Le token n'est vérifié qu'au handshake : une connexion déjà ouverte n'est pas coupée quand l'access token expire, mais elle l'est à la déconnexion (`DELETE /v1/sessions/current`) ou à la réinitialisation du mot de passe.

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
