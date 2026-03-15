import { promises as fs } from 'node:fs';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATION_DIR = path.resolve(
  SCRIPT_DIR,
  'migrations',
);
const REQUIRED_TABLES = [
  { name: 'laws', probeColumn: 'law_num' },
  { name: 'law_versions', probeColumn: 'id' },
  { name: 'law_assets', probeColumn: 'version_id' },
  { name: 'law_references', probeColumn: 'id' },
  { name: 'ingest_runs', probeColumn: 'id' },
];

dns.setDefaultResultOrder('ipv4first');

dns.setDefaultResultOrder('ipv4first');

function parseArgs(argv) {
  const options = {
    migration: null,
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

async function resolveMigrationFiles(options) {
  if (options.migration) {
    return [options.migration];
  }

  const entries = await fs.readdir(DEFAULT_MIGRATION_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(DEFAULT_MIGRATION_DIR, entry.name))
    .sort();
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

async function confirmSchemaViaSupabase(supabaseUrl, serviceRoleKey) {
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to verify the schema via Supabase REST.');
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const missingTables = [];
  for (const { name, probeColumn } of REQUIRED_TABLES) {
    const { error } = await client.from(name).select(probeColumn, { head: true, count: 'exact' }).limit(1);
    if (error) {
      missingTables.push(`${name}: ${error.message}`);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(`Supabase REST schema check failed: ${missingTables.join('; ')}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required.');
  }

  const migrationFiles = await resolveMigrationFiles(options);
  if (migrationFiles.length === 0) {
    throw new Error(`No migration files found in: ${DEFAULT_MIGRATION_DIR}`);
  }

  const sqlParts = [];
  for (const migrationFile of migrationFiles) {
    try {
      const sql = await fs.readFile(migrationFile, 'utf8');
      sqlParts.push(`-- ${path.basename(migrationFile)}\n${sql}`);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Migration file not found: ${migrationFile}`);
      }
      throw error;
    }
  }
  const sql = `begin;\n${sqlParts.join('\n\n')}\ncommit;\n`;

  try {
    await tryDirect(databaseUrl, sql);
    console.log(`migration_applied_via=direct files=${migrationFiles.map((file) => path.basename(file)).join(',')}`);
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`direct_connect_failed=${msg}`);
  }

  try {
    await confirmSchemaViaSupabase(supabaseUrl, serviceRoleKey);
    console.log('migration_skipped_via=supabase_rest_schema_check');
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`rest_schema_check_failed=${msg}`);
  }

  const poolerHost = await tryPooler(databaseUrl, supabaseUrl, sql);
  console.log(
    `migration_applied_via=pooler:${poolerHost} files=${migrationFiles.map((file) => path.basename(file)).join(',')}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
