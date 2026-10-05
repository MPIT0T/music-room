import Fastify from 'fastify';
import mysql from 'mysql2/promise';

const app = Fastify({ logger: true });
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok', db: 'ok' };
});

await app.listen({ port: 3000, host: '0.0.0.0' });