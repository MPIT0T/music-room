import { readdir, readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const dir = new URL('./migrations/', import.meta.url);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

const [[{ locked }]] = await conn.query("SELECT GET_LOCK('migrations', 10) AS locked");
if (locked !== 1) throw new Error('could not get the migrations lock');

await conn.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )
`);

const [rows] = await conn.query('SELECT name FROM schema_migrations');
const applied = new Set(rows.map((r) => r.name));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  await conn.query(await readFile(new URL(file, dir), 'utf8'));
  await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
  console.log(`applied ${file}`);
}

await conn.query("SELECT RELEASE_LOCK('migrations')");
console.log('migrations ok');
await conn.end();
