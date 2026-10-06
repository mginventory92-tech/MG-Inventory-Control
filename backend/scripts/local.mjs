// Local mode: runs the whole system with an embedded PostgreSQL (PGlite), so no database install is needed.
// Data is kept in the ./data folder next to the project. Usage: npm run local   (after build)
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(here, '..', '..', 'data'));
mkdirSync(dataDir, { recursive: true });

// a secret generated once and kept, so logins survive restarts and nobody else knows it
const secretFile = join(dataDir, 'jwt-secret.txt');
if (!process.env.JWT_SECRET) {
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('hex'));
  process.env.JWT_SECRET = readFileSync(secretFile, 'utf8').trim();
}

const db = await PGlite.create({ dataDir: join(dataDir, 'db'), extensions: { uuid_ossp } });
const dbPort = +(process.env.LOCAL_DB_PORT || 54329);
const server = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1' });
await server.start();

process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
process.env.DB_POOL_MAX = '1'; // one connection: transactions run one after another, which is what the embedded DB needs
process.env.PORT ||= '3000';

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try { await server.stop(); await db.close(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await import('../dist/main.js');
