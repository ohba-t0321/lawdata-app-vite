import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSupabaseSessionPooler } from './pooler-db.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATION_DIR = path.resolve(
  SCRIPT_DIR,
  'migrations',
);

function parseArgs(argv) {
  const options = {
    migration: null,
    force: false,
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
    if (arg === '--force') {
      options.force = true;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const poolerUrl = process.env.DATABASE_POOLER_URL;
  if (options.force) {
    console.warn('flag_ignored=--force migrations always run');
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
  const client = await connectSupabaseSessionPooler({
    poolerUrl,
    applicationName: 'lawdata-apply-migration',
  });
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  console.log(`migration_applied_via=pooler:session files=${migrationFiles.map((file) => path.basename(file)).join(',')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
