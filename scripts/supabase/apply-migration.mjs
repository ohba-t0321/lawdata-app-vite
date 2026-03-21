import { promises as fs } from 'node:fs';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATION = path.resolve(
  SCRIPT_DIR,
  'migrations/202602140001_create_law_cache_tables.sql',
);

dns.setDefaultResultOrder('ipv4first');

function parseArgs(argv) {
  const options = {
    migration: DEFAULT_MIGRATION,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--migration') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--migration requires a value.');
      }
      options.migration = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function parseProjectRef(supabaseUrl) {
  const match = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : null;
}

function buildTransactionPoolerConfig(databaseUrl, supabaseUrl) {
  const dbUrl = new URL(databaseUrl);
  const ref = parseProjectRef(supabaseUrl);
  if (!ref) {
    throw new Error('Failed to parse project ref from SUPABASE_URL.');
  }

  const host = dbUrl.hostname.startsWith('db.')
    ? dbUrl.hostname
    : `db.${ref}.supabase.co`;

  const user = dbUrl.username === 'postgres'
    ? dbUrl.username
    : decodeURIComponent(dbUrl.username || 'postgres');

  return {
    host,
    port: 6543,
    user,
    password: decodeURIComponent(dbUrl.password),
    database: (dbUrl.pathname || '/postgres').slice(1) || 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 3500,
  };
}

async function connectAndRun(clientConfig, sql) {
  const client = new Client(clientConfig);
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function tryDirect(databaseUrl, sql) {
  const connectionString = databaseUrl.includes('sslmode=')
    ? databaseUrl
    : `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=require`;

  await connectAndRun(
    {
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 4000,
    },
    sql,
  );
}

async function tryPooler(databaseUrl, supabaseUrl, sql) {
  const clientConfig = buildTransactionPoolerConfig(databaseUrl, supabaseUrl);
  await connectAndRun(clientConfig, sql);
  return `${clientConfig.host}:${clientConfig.port}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required.');
  }

  let sql;
  try {
    sql = await fs.readFile(options.migration, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Migration file not found: ${options.migration}`);
    }
    throw error;
  }

  try {
    await tryDirect(databaseUrl, sql);
    console.log('migration_applied_via=direct');
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`direct_connect_failed=${msg}`);
  }

  const poolerHost = await tryPooler(databaseUrl, supabaseUrl, sql);
  console.log(`migration_applied_via=pooler:${poolerHost}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
