import { setTimeout as sleep } from 'node:timers/promises';

// MariaDB errors after which the whole transaction can safely be replayed
const RETRYABLE = new Set([
  1213, // ER_LOCK_DEADLOCK: the server already rolled the transaction back
  1020, // ER_CHECKREAD: row changed since our snapshot (innodb_snapshot_isolation)
]);

export async function withTransaction(pool, fn, { attempts = 3, backoffMs = 20 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runOnce(pool, fn);
    } catch (err) {
      if (attempt >= attempts || !RETRYABLE.has(err.errno)) throw err;
      // random delay so the two conflicting transactions do not collide again
      await sleep(backoffMs * attempt * (0.5 + Math.random()));
    }
  }
}

async function runOnce(pool, fn) {
  const conn = await pool.getConnection();
  let broken = false;
  try {
    await conn.beginTransaction();
    const res = await fn(conn);
    await conn.commit();
    return res;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // rollback failed too (e.g. lost connection): keep the original error
      broken = true;
    }
    throw err;
  } finally {
    if (broken) conn.destroy();
    else conn.release();
  }
}