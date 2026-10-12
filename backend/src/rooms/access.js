// Room access rules.

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

export function isWithinWindow(window, now) {
  if (window == null) return true;
  const t = now.getTime();
  return window.start.getTime() <= t && t < window.end.getTime();
}

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
