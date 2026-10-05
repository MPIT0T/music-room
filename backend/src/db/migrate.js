import { readdir } from 'node:fs/promises';
import { pool } from './pool.js';

await pool.query(`
  CREATE TABLE IF NOT EXISTS pings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Applique chaque fichier de ./migrations dans l'ordre alphabetique (001_, 002_, ...).
const dir = new URL('./migrations/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith('.js')).sort();
for (const file of files) {
  const { up } = await import(new URL(file, dir));
  await up(pool);
  console.log(`applied ${file}`);
}

console.log('migrations ok');
await pool.end();
