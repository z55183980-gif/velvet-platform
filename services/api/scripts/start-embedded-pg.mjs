import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseDir = resolve(__dirname, '../.embedded-pg');
const port = Number(process.env.EMBEDDED_PG_PORT || 5433);
const password = process.env.EMBEDDED_PG_PASSWORD || 'postgres';
const dbName = process.env.EMBEDDED_PG_DB || 'velvet';

if (!existsSync(databaseDir)) mkdirSync(databaseDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password,
  port,
  persistent: true,
});

const alreadyInitialized = existsSync(resolve(databaseDir, 'PG_VERSION'));

async function main() {
  if (!alreadyInitialized) {
    console.log(`[embedded-pg] initialise ${databaseDir}`);
    await pg.initialise();
  }
  console.log(`[embedded-pg] starting 127.0.0.1:${port}`);
  await pg.start();
  try {
    await pg.createDatabase(dbName);
    console.log(`[embedded-pg] db ready: ${dbName}`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/already exists/i.test(msg)) console.log(`[embedded-pg] db exists: ${dbName}`);
    else console.warn(`[embedded-pg] createDatabase: ${msg}`);
  }
  console.log(`[embedded-pg] DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:${port}/${dbName}?schema=public`);
  console.log('[embedded-pg] READY');
  const stop = async () => { try { await pg.stop(); } catch {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

main().catch((err) => { console.error('[embedded-pg] failed:', err); process.exit(1); });
