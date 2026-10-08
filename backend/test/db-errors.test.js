import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { dbErrorProblem } from '../src/db/errors.js';

// Same shape as the errors mysql2 throws; messages copied from MariaDB 12.3.3
function sqlError(errno, sqlMessage) {
  return Object.assign(new Error(sqlMessage), { errno, sqlMessage });
}

const DUP_EMAIL = sqlError(1062, "Duplicate entry 'a@b.fr' for key 'email'");
const DUP_PRIMARY = sqlError(1062, "Duplicate entry 'x-y' for key 'PRIMARY'");
const OWNS_ROOMS = sqlError(
  1451,
  'Cannot delete or update a parent row: a foreign key constraint fails ' +
    '(`mr`.`rooms`, CONSTRAINT `fk_rooms_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`))',
);
const MISSING_TRACK = sqlError(
  1452,
  'Cannot add or update a child row: a foreign key constraint fails ' +
    '(`mr`.`votes`, CONSTRAINT `fk_votes_rt` FOREIGN KEY (`room_track_id`) REFERENCES `room_tracks` (`id`))',
);

test('a known constraint gets its own code', () => {
  assert.deepEqual(dbErrorProblem(DUP_EMAIL), { status: 409, code: 'email_taken' });
  assert.deepEqual(dbErrorProblem(OWNS_ROOMS), { status: 409, code: 'owns_rooms' });
});

test('an unknown constraint falls back to the errno default', () => {
  assert.deepEqual(dbErrorProblem(DUP_PRIMARY), { status: 409, code: 'already_exists' });
  assert.deepEqual(dbErrorProblem(MISSING_TRACK), { status: 404, code: 'not_found' });
});

test('other errors are not translated', () => {
  assert.equal(dbErrorProblem(sqlError(1213, 'Deadlock found')), undefined);
  assert.equal(dbErrorProblem(new Error('boom')), undefined);
  assert.equal(dbErrorProblem(undefined), undefined);
});

test('a route that hits a duplicate email answers 409 without leaking the email', async (t) => {
  const okPool = { query: async () => [[{ 1: 1 }]], end: async () => {} };
  const okRedis = { ping: async () => 'PONG', quit: async () => 'OK' };
  const app = await buildApp({ pool: okPool, redis: okRedis, logger: false });
  t.after(() => app.close());
  app.post('/v1/dup', async () => {
    throw DUP_EMAIL;
  });

  const res = await app.inject({ method: 'POST', url: '/v1/dup' });

  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, 'email_taken');
  assert.ok(!res.body.includes('a@b.fr'));
});
