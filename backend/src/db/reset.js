const TABLES_IN_ORDER = ['rooms', 'users', 'tracks', 'genres'];

export async function resetDb(pool) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('resetDb refused: NODE_ENV is production');
  }
  for (const table of TABLES_IN_ORDER) {
    await pool.query(`DELETE FROM ${table}`);
  }
}