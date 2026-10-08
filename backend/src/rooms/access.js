// Room access rules. PURE functions: no database, no req/reply, no Date.now().
// Everything arrives as arguments, so the same code serves REST routes and Socket.IO events
// and the tests need no setup.
//
// Shapes (plain objects, see toRoom in repo.js):
//   room = { id, ownerId, visibility: 'public'|'private',
//            accessPolicy: 'everyone'|'invited'|'time_window',
//            window: { start: Date, end: Date } | null }
//   role = 'owner' | 'invited' | null      (see roleOf)
//   ctx  = { now: Date }

export const DENY = Object.freeze({
  NOT_VISIBLE: 'not_visible',
  NOT_INVITED: 'not_invited',
  OUTSIDE_TIME_WINDOW: 'outside_time_window',
  MISCONFIGURED: 'misconfigured',
});

const ALLOWED = Object.freeze({ allowed: true });
const deny = (reason) => ({ allowed: false, reason });

// The owner lives in rooms.owner_id, invited users in room_members
export function roleOf(room, userId, isInvited) {
  if (userId != null && room.ownerId === userId) return 'owner';
  return isInvited ? 'invited' : null;
}

// Find, open, see tracks, votes and members. Private rooms answer 404 to everyone else.
export function canView(room, role) {
  return room.visibility === 'public' || role != null;
}

// Settings, invitations, member removal, delete, skip
export function canManage(room, role) {
  return role === 'owner';
}

// Half-open interval start <= now < end: back-to-back windows (16h-18h then 18h-20h) never overlap
export function isWithinWindow(window, now) {
  if (window == null) return true;
  const t = now.getTime();
  return window.start.getTime() <= t && t < window.end.getTime();
}

// Vote and suggest a track. Returns { allowed: true } or { allowed: false, reason: DENY.* }
// so the API can answer an explicit 403 ("not invited", "outside the time window").
// time_window: anyone who can see the room, inside the time window. The owner is never restricted.
export function canVote(room, role, ctx) {
  if (!canView(room, role)) return deny(DENY.NOT_VISIBLE);
  if (role === 'owner') return ALLOWED;

  switch (room.accessPolicy) {
    case 'everyone':
      return ALLOWED;
    case 'invited':
      return role === 'invited' ? ALLOWED : deny(DENY.NOT_INVITED);
    case 'time_window':
      if (room.window == null) return deny(DENY.MISCONFIGURED);
      if (!isWithinWindow(room.window, ctx.now)) return deny(DENY.OUTSIDE_TIME_WINDOW);
      return ALLOWED;
    default:
      return deny(DENY.MISCONFIGURED);
  }
}
