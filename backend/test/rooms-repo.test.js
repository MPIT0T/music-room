import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRoomForUser, toRoom } from '../src/rooms/repo.js';

const ROOM_ID = '01920000-0000-7000-8000-000000000001';

// A row as mysql2 returns it: snake_case, BIGINT as a string, DATETIME as Date
const row = {
  id: ROOM_ID,
  owner_id: 'owner-id',
  name: 'Friday night',
  description: null,
  visibility: 'public',
  access_policy: 'time_window',
  latitude: '48.867400',
  longitude: '2.363600',
  radius_m: 200,
  starts_at: new Date('2026-10-08T16:00:00Z'),
  ends_at: new Date('2026-10-08T18:00:00Z'),
  beacon_minor: 42,
  version: '3',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-02T00:00:00Z'),
};

test('toRoom: camelCase, version converted, window grouped', () => {
  const room = toRoom(row);
  assert.equal(room.ownerId, 'owner-id');
  assert.equal(room.accessPolicy, 'time_window');
  assert.equal('geo' in room, false);
  assert.deepEqual(room.window, { start: row.starts_at, end: row.ends_at });
  assert.equal(room.beaconMinor, 42);
  assert.equal(room.version, 3);
  assert.equal('owner_id' in room, false);
});

test('toRoom: no time gives a null window', () => {
  const room = toRoom({ ...row, starts_at: null, ends_at: null });
  assert.equal(room.window, null);
});

test('findRoomForUser: parameterised query, invitation flag, null when missing', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push(params);
      return params[1] === ROOM_ID ? [[{ ...row, is_invited: 1 }]] : [[]];
    },
  };

  const found = await findRoomForUser(db, ROOM_ID, 'user-id');
  assert.equal(found.isInvited, true);
  assert.equal(found.room.id, ROOM_ID);
  assert.deepEqual(calls[0], ['user-id', ROOM_ID]);

  assert.equal(await findRoomForUser(db, 'unknown', 'user-id'), null);
});
