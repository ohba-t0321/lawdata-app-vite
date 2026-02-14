import { promises as fs } from 'node:fs';
import { Client } from 'pg';

const DEFAULT_MIGRATION = 'supabase/migrations/202602140001_create_law_cache_tables.sql';

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
      options.migration = value;
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
  const dbUrl = new URL(databaseUrl);
  const ref = parseProjectRef(supabaseUrl);
  if (!ref) {
    throw new Error('Failed to parse project ref from SUPABASE_URL.');
  }

  const regions = [
    'ap-northeast-1',
    'ap-northeast-2',
    'ap-south-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'ca-central-1',
    'eu-central-1',
    'eu-north-1',
    'eu-west-1',
    'eu-west-2',
    'eu-west-3',
    'sa-east-1',
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
  ];

  const candidates = [];
  for (const shard of [0, 1, 2]) {
    for (const region of regions) {
      candidates.push(`aws-${shard}-${region}.pooler.supabase.com`);
    }
  }

  let lastError = null;
  for (const host of candidates) {
    try {
      await connectAndRun(
        {
          host,
          port: 6543,
          user: `postgres.${ref}`,
          password: decodeURIComponent(dbUrl.password),
          database: (dbUrl.pathname || '/postgres').slice(1) || 'postgres',
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 3500,
        },
        sql,
      );
      return host;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Pooler connection failed.');
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

  const sql = await fs.readFile(options.migration, 'utf8');

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
