import { buildApp } from './app.js';
import { socketSetup }  from './utils/socket.js'

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);

const io = socketSetup(app.server);

app.decorate('io', io);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  await app.close();
  process.exit(1);
}