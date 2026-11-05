import { HttpProblem } from '../errors.js';

// Premium is for organizers: free accounts join, vote and propose anywhere, and host one
// public room open to everyone. Private rooms, licences and beacons need premium.
export const FREE_ROOM_LIMIT = 1;

const PREMIUM_FIELDS = [
  {
    field: 'visibility',
    needs: (value) => value === 'private',
    message: 'private rooms need premium',
  },
  {
    field: 'accessPolicy',
    needs: (value) => value !== 'everyone',
    message: 'invited and place_time need premium',
  },
  {
    field: 'beaconMinor',
    needs: (value) => value != null,
    message: 'a beacon needs premium',
  },
];

// What in room needs premium. With previous (PATCH), a value already stored is not counted:
// an account back on free keeps its rooms as they are, edits the rest, and can downgrade them
export function premiumIssues(room, previous) {
  return PREMIUM_FIELDS.filter(
    ({ field, needs }) => needs(room[field]) && room[field] !== previous?.[field],
  ).map(({ field, message }) => ({ path: field, message }));
}

export function premiumRequired(issues) {
  const problem = new HttpProblem(403, 'premium_required', {
    detail: 'Free accounts host public rooms open to everyone: go premium for the fields listed',
  });
  problem.errors = issues;
  return problem;
}

export const roomLimitReached = () =>
  new HttpProblem(403, 'room_limit_reached', {
    detail: 'Free accounts host one room at a time: delete it, or go premium',
  });
