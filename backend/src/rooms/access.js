// Room access rules.

//   room = { id, ownerId, visibility: 'public'|'private',
//            accessPolicy: 'everyone'|'invited'|'place_time',
//            window: { start: Date, end: Date } | null,
//            place: { lat, lng, radiusM } | null }
//   role = 'owner' | 'invited' | null      (see roleOf)
//   ctx  = { now: Date, location: { lat, lng } | null }   location as sent by the phone

export const DENY = Object.freeze({
  NOT_VISIBLE: 'not_visible',
  NOT_INVITED: 'not_invited',
  OUTSIDE_TIME_WINDOW: 'outside_time_window',
  LOCATION_REQUIRED: 'location_required',
  OUTSIDE_PLACE: 'outside_place',
  MISCONFIGURED: 'misconfigured',
});

const ALLOWED = Object.freeze({ allowed: true });
const deny = (reason) => ({ allowed: false, reason });

export function roleOf(room, userId, isInvited) {
  if (userId != null && room.ownerId === userId) return 'owner';
  return isInvited ? 'invited' : null;
}

export function canView(room, role) {
  return room.visibility === 'public' || role != null;
}

export function canManage(room, role) {
  return role === 'owner';
}

export function canRemoveMember(room, role, actorId, memberId) {
  return role === 'owner' || (role === 'invited' && actorId === memberId);
}

export function isWithinWindow(window, now) {
  if (window == null) return true;
  const t = now.getTime();
  return window.start.getTime() <= t && t < window.end.getTime();
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance (haversine): exact enough at the scale of a party
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isWithinPlace(place, location) {
  return distanceM(place, location) <= place.radiusM;
}

export function canVote(room, role, ctx) {
  if (!canView(room, role)) return deny(DENY.NOT_VISIBLE);
  if (role === 'owner') return ALLOWED;

  switch (room.accessPolicy) {
    case 'everyone':
      return ALLOWED;
    case 'invited':
      return role === 'invited' ? ALLOWED : deny(DENY.NOT_INVITED);
    case 'place_time':
      if (room.window == null || room.place == null) return deny(DENY.MISCONFIGURED);
      if (!isWithinWindow(room.window, ctx.now)) return deny(DENY.OUTSIDE_TIME_WINDOW);
      // Declared by the phone: it can be faked, the server has no way to prove presence
      if (ctx.location == null) return deny(DENY.LOCATION_REQUIRED);
      if (!isWithinPlace(room.place, ctx.location)) return deny(DENY.OUTSIDE_PLACE);
      return ALLOWED;
    default:
      return deny(DENY.MISCONFIGURED);
  }
}
