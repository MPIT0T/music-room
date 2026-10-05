import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DENY, canView, isWithinWindow, distanceMeters, isWithinRadius, canVote,
} from './access.js';

const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m)); // 5 oct 2026, en UTC
const base = { id: 'r1', ownerId: 1, visibility: 'public', voteLicense: 'open', geo: null, window: null };
const room = (over = {}) => ({ ...base, ...over });
const invited = { role: 'invited' };
const PARIS = { lat: 48.8566, lng: 2.3522 };

// --- canView (exemple deja fourni) -----------------------------------------
test('canView: public -> visible par tous', () => {
  assert.equal(canView(room(), null), true);
});
test('canView: private -> invisible sans membership', () => {
  assert.equal(canView(room({ visibility: 'private' }), null), false);
});
test('canView: private -> visible pour un invite', () => {
  assert.equal(canView(room({ visibility: 'private' }), invited), true);
});

// --- isWithinWindow --------------------------------------------------------
test('isWithinWindow: pas de fenetre -> true', () => {
  assert.equal(isWithinWindow(null, at(3)), true);
});
test('isWithinWindow: dans la fenetre 16h-18h', () => {
  assert.equal(isWithinWindow({ start: at(16), end: at(18) }, at(17)), true);
});
test('isWithinWindow: avant / apres', () => {
  const w = { start: at(16), end: at(18) };
  assert.equal(isWithinWindow(w, at(15, 59)), false);
  assert.equal(isWithinWindow(w, at(18, 1)), false);
});
test('isWithinWindow: debut inclus, fin exclue', () => {
  const w = { start: at(16), end: at(18) };
  assert.equal(isWithinWindow(w, at(16)), true);
  assert.equal(isWithinWindow(w, at(18)), false);
});

// --- distanceMeters --------------------------------------------------------
test('distanceMeters: meme point -> 0', () => {
  assert.equal(distanceMeters(PARIS, PARIS), 0);
});
test('distanceMeters: Paris-Lyon ~ 392 km', () => {
  const lyon = { lat: 45.764, lng: 4.8357 };
  const d = distanceMeters(PARIS, lyon);
  assert.ok(d > 390_000 && d < 394_000, `distance inattendue: ${d}`);
});
test('distanceMeters: symetrique', () => {
  const lyon = { lat: 45.764, lng: 4.8357 };
  assert.equal(distanceMeters(PARIS, lyon), distanceMeters(lyon, PARIS));
});

// --- isWithinRadius --------------------------------------------------------
test('isWithinRadius: pas de geo -> true', () => {
  assert.equal(isWithinRadius(null, null), true);
});
test('isWithinRadius: dans / hors du rayon', () => {
  const geo = { ...PARIS, radiusM: 500 };
  assert.equal(isWithinRadius(geo, { lat: 48.8570, lng: 2.3525 }), true);   // ~50 m
  assert.equal(isWithinRadius(geo, { lat: 48.8700, lng: 2.3522 }), false);  // ~1,5 km
});
test('isWithinRadius: geo defini mais position inconnue -> false', () => {
  assert.equal(isWithinRadius({ ...PARIS, radiusM: 500 }, null), false);
});

// --- canVote ---------------------------------------------------------------
const ctx = (over = {}) => ({ now: at(17), position: null, ...over });

test('canVote open: un inconnu peut voter dans une room publique', () => {
  assert.deepEqual(canVote(room(), null, ctx()), { allowed: true });
});
test('canVote open: refuse si la room privee est invisible pour lui', () => {
  assert.deepEqual(
    canVote(room({ visibility: 'private' }), null, ctx()),
    { allowed: false, reason: DENY.NOT_VISIBLE },
  );
});
test('canVote invited_only: refuse un non invite, accepte un invite', () => {
  const r = room({ voteLicense: 'invited_only' });
  assert.deepEqual(canVote(r, null, ctx()), { allowed: false, reason: DENY.NOT_INVITED });
  assert.deepEqual(canVote(r, invited, ctx()), { allowed: true });
});
test('canVote geo_time: position obligatoire', () => {
  const r = room({ voteLicense: 'geo_time', geo: { ...PARIS, radiusM: 500 } });
  assert.deepEqual(canVote(r, null, ctx()), { allowed: false, reason: DENY.POSITION_REQUIRED });
});
test('canVote geo_time: trop loin', () => {
  const r = room({ voteLicense: 'geo_time', geo: { ...PARIS, radiusM: 500 } });
  assert.deepEqual(
    canVote(r, null, ctx({ position: { lat: 48.87, lng: 2.3522 } })),
    { allowed: false, reason: DENY.TOO_FAR },
  );
});
test('canVote geo_time: hors horaire', () => {
  const r = room({ voteLicense: 'geo_time', window: { start: at(16), end: at(18) } });
  assert.deepEqual(
    canVote(r, null, ctx({ now: at(19) })),
    { allowed: false, reason: DENY.OUTSIDE_TIME_WINDOW },
  );
});
test('canVote geo_time: lieu ET heure OK', () => {
  const r = room({
    voteLicense: 'geo_time',
    geo: { ...PARIS, radiusM: 500 },
    window: { start: at(16), end: at(18) },
  });
  assert.deepEqual(canVote(r, null, ctx({ position: PARIS })), { allowed: true });
});
test('canVote geo_time: ni geo ni fenetre -> MISCONFIGURED (on refuse par defaut)', () => {
  const r = room({ voteLicense: 'geo_time' });
  assert.deepEqual(canVote(r, null, ctx()), { allowed: false, reason: DENY.MISCONFIGURED });
});
test('canVote: licence inconnue -> MISCONFIGURED', () => {
  const r = room({ voteLicense: 'banana' });
  assert.deepEqual(canVote(r, null, ctx()), { allowed: false, reason: DENY.MISCONFIGURED });
});
