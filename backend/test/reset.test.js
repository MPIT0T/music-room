// Integration test: real MariaDB (run through make test)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { resetDb } from '../src/db/reset.js';

// How every DB test file uses it: each test starts from an empty database,
// even if a previous run crashed halfway and left rows behind
beforeEach(() => resetDb(pool));

// Close the pool once every test of this file is done, otherwise node --test never exits
after(() => pool.end());

test('resetDb empties every table except schema_migrations', async () => {
  // A room owner (the RESTRICT case), a member row (only emptied by cascade) and a genre
  await pool.query("INSERT INTO users (email, display_name) VALUES ('reset@test.fr', 'reset')");
  await pool.query(
    "INSERT INTO rooms (owner_id, name) SELECT id, 'reset' FROM users WHERE email = 'reset@test.fr'",
  );
  await pool.query(
    "INSERT INTO room_members (room_id, user_id) SELECT id, owner_id FROM rooms WHERE name = 'reset'",
  );
  await pool.query("INSERT INTO genres (name) VALUES ('reset')");

  await resetDb(pool);

  // Every table of the current database, so a table added later is checked too
  const [tables] = await pool.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`,
  );
  assert.ok(tables.length > 0, 'no table found: are the migrations applied?');
  for (const { name } of tables) {
    // ?? escapes a table name, like ? escapes a value
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM ??', [name]);
    assert.equal(Number(n), 0, `${name} is not empty after resetDb`);
  }
});

test('resetDb refuses to run in production', async (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => (process.env.NODE_ENV = previous));

  await assert.rejects(resetDb(pool), /NODE_ENV is production/);
});
