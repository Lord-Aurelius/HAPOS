const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const sqlPath = path.join(projectRoot, 'db', 'runtime-store.sql');
const bootstrapPath = path.join(projectRoot, 'data', 'store.json');
const directConnectionKeys = ['DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL'];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    const unwrapped = rawValue.replace(/^['"]|['"]$/g, '');
    process.env[key] = unwrapped;
  }
}

async function readBootstrapState() {
  const raw = await fsp.readFile(bootstrapPath, 'utf8');
  return JSON.parse(raw);
}

function resolveDatabaseUrl() {
  for (const key of directConnectionKeys) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

async function main() {
  loadEnvFile(envPath);

  const connectionString = resolveDatabaseUrl();

  if (!connectionString) {
    throw new Error('A Postgres connection string (DATABASE_URL, POSTGRES_URL_NON_POOLING, or POSTGRES_URL) is required before bootstrapping the Postgres runtime store.');
  }

  const sql = await fsp.readFile(sqlPath, 'utf8');
  const bootstrapState = await readBootstrapState();
  const client = new Client({ connectionString });

  await client.connect();

  try {
    await client.query('begin');
    await client.query(sql);

    const existing = await client.query('select id from app.runtime_state where id = 1');
    if (existing.rowCount === 0) {
      await client.query('insert into app.runtime_state (id, state) values ($1, $2::jsonb)', [
        1,
        JSON.stringify(bootstrapState),
      ]);
      process.stdout.write('Initialized app.runtime_state from data/store.json\n');
    } else {
      process.stdout.write('app.runtime_state already exists. No bootstrap data was overwritten.\n');
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
