// // Regles d'acces d'une room. Fonctions PURES : pas de base, pas de req/res, pas de Date.now().
// // Tout ce dont elles ont besoin arrive en parametre -> tests triviaux, et le meme code
// // servira aux routes REST ET aux evenements Socket.IO.
// //
// // Formes des donnees (objets simples) :
// //   room       = { id, ownerId, visibility: 'public'|'private',
// //                  voteLicense: 'open'|'invited_only'|'geo_time',
// //                  geo:    { lat, lng, radiusM } | null,
// //                  window: { start: Date, end: Date } | null }
// //   membership = { role: 'owner'|'invited' } | null     (ligne de room_members, ou null)
// //   ctx        = { now: Date, position: { lat, lng } | null }
// //                (position envoyee par le client : ATTENTION, il peut mentir)

// export const DENY = Object.freeze({
//   NOT_VISIBLE: 'not_visible',
//   NOT_INVITED: 'not_invited',
//   POSITION_REQUIRED: 'position_required',
//   TOO_FAR: 'too_far',
//   OUTSIDE_TIME_WINDOW: 'outside_time_window',
//   MISCONFIGURED: 'misconfigured',
// });

// // ---------------------------------------------------------------------------
// // EXEMPLE DEJA IMPLEMENTE (pour donner le style) : qui peut VOIR / trouver la room ?
// // public  -> tout le monde
// // private -> uniquement les gens qui ont une ligne dans room_members (owner ou invited)
// export function canView(room, membership) {
//   if (room.visibility === 'public') return true;
//   return membership != null;
// }

// // ---------------------------------------------------------------------------
// // TODO 1 : la fenetre horaire est-elle respectee ?
// //   - window === null  -> pas de contrainte -> true
// //   - intervalle SEMI-OUVERT : start <= now < end  (decision a justifier : pas de
// //     chevauchement quand deux fenetres s'enchainent, ex 16h-18h puis 18h-20h)
// //   - indice : comparer des Date avec .getTime()
// export function isWithinWindow(window, now) {
//   throw new Error('TODO isWithinWindow');
// }

// // ---------------------------------------------------------------------------
// // TODO 2 : distance en metres entre deux points GPS (formule de Haversine).
// //   R = 6_371_000 m
// //   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
// //   d = 2R · atan2(√a, √(1−a))        avec φ = latitude, λ = longitude, EN RADIANS
// //   indice : (deg * Math.PI) / 180
// export function distanceMeters(a, b) {
//   throw new Error('TODO distanceMeters');
// }

// // ---------------------------------------------------------------------------
// // TODO 3 : la position est-elle dans le rayon de la room ?
// //   - geo === null -> pas de contrainte -> true
// //   - sinon distanceMeters(geo, position) <= geo.radiusM
// //   - position === null alors que geo est defini -> false
// export function isWithinRadius(geo, position) {
//   throw new Error('TODO isWithinRadius');
// }

// // ---------------------------------------------------------------------------
// // TODO 4 : qui peut VOTER ? Retourne { allowed: true } ou { allowed: false, reason: DENY.xxx }
// // Le `reason` permet a l'API de renvoyer un 403 explicite ("trop loin", "hors horaire"...).
// //
// // Ordre des verifications :
// //   1. !canView(room, membership)           -> NOT_VISIBLE   (jamais voter sur une room qu'on ne voit pas,
// //                                                              meme avec la licence 'open')
// //   2. voteLicense === 'open'               -> allowed
// //   3. voteLicense === 'invited_only'       -> allowed si membership != null, sinon NOT_INVITED
// //   4. voteLicense === 'geo_time'           -> voir ci-dessous
// //        - room.geo ET room.window tous les deux null -> MISCONFIGURED
// //          (on REFUSE par defaut : une room mal configuree ne doit jamais s'ouvrir a tout le monde)
// //        - geo defini mais ctx.position null -> POSITION_REQUIRED
// //        - hors rayon   -> TOO_FAR
// //        - hors horaire -> OUTSIDE_TIME_WINDOW
// //   5. licence inconnue -> MISCONFIGURED
// export function canVote(room, membership, ctx) {
//   throw new Error('TODO canVote');
// }
