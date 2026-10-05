import { pool } from './pool.js';

await pool.query(`
  CREATE TABLE IF NOT EXISTS pings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('migrations ok');
await pool.end();