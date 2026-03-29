import dns from 'node:dns';
import { Client } from 'pg';

export const DATABASE_POOLER_URL_ENV = 'DATABASE_POOLER_URL';
const SESSION_MODE_PORT = 5432;

dns.setDefaultResultOrder('ipv4first');

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readDatabasePoolerUrl(env = process.env) {
  const poolerUrl = asNonEmptyString(env[DATABASE_POOLER_URL_ENV]);
  if (!poolerUrl) {
    throw new Error(
      `${DATABASE_POOLER_URL_ENV} is required. `
      + 'Use the Supavisor session mode connection string from the Supabase Connect page (port 5432).',
    );
  }
  return poolerUrl;
}

export function buildSupabaseSessionPoolerClientConfig({
  poolerUrl = null,
  applicationName,
  connectionTimeoutMillis = 4000,
  env = process.env,
} = {}) {
  const rawPoolerUrl = poolerUrl ?? readDatabasePoolerUrl(env);
  const url = new URL(rawPoolerUrl);
  const host = url.hostname;
  const port = Number(url.port || SESSION_MODE_PORT);

  if (host.endsWith('.supabase.co') && !host.endsWith('.pooler.supabase.com')) {
    throw new Error(
      `${DATABASE_POOLER_URL_ENV} must point to the Supavisor pooler hostname (*.pooler.supabase.com), `
      + `but received ${host}.`,
    );
  }

  if (port !== SESSION_MODE_PORT) {
    throw new Error(
      `${DATABASE_POOLER_URL_ENV} must use Supavisor session mode on port ${SESSION_MODE_PORT}. `
      + `Received port ${port}.`,
    );
  }

  const config = {
    host,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: (url.pathname || '/postgres').slice(1) || 'postgres',
    ssl: {
      rejectUnauthorized: false,
      servername: host,
    },
    connectionTimeoutMillis,
  };

  if (applicationName) {
    config.application_name = applicationName;
  }

  return config;
}

export function explainSupabaseSessionPoolerConnectionError(error, host, port) {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const lines = [
    `Failed to connect to Supabase Postgres via Supavisor session mode (${host}:${port}).`,
    `Underlying error: ${originalMessage}`,
  ];

  if (error?.code === 'EAI_AGAIN' || error?.code === 'ENOTFOUND') {
    lines.push(
      'DNS resolution for the pooler hostname failed. Confirm that DATABASE_POOLER_URL matches the Connect page value.',
    );
    return lines.join(' ');
  }

  if (error?.code === 'ECONNREFUSED' || error?.code === 'EHOSTUNREACH' || error?.code === 'ENETUNREACH') {
    lines.push(
      'The session pooler endpoint was not reachable. Confirm that the hostname and port 5432 in DATABASE_POOLER_URL match the Supabase Connect page.',
    );
    return lines.join(' ');
  }

  if (error?.code === '28P01' || error?.code === '28000' || originalMessage.includes('password authentication failed')) {
    lines.push(
      'Check that DATABASE_POOLER_URL contains the current database password from the Supabase Connect page.',
    );
    return lines.join(' ');
  }

  lines.push(
    'Check that DATABASE_POOLER_URL is the Supavisor session mode connection string on port 5432 and that the database password is current.',
  );
  return lines.join(' ');
}

async function safeEnd(client) {
  try {
    await client.end();
  } catch {
    // ignore close failures after unsuccessful connect attempts
  }
}

export async function connectSupabaseSessionPooler(options = {}) {
  const clientConfig = buildSupabaseSessionPoolerClientConfig(options);
  const client = new Client(clientConfig);
  try {
    await client.connect();
    return client;
  } catch (error) {
    await safeEnd(client);
    throw new Error(
      explainSupabaseSessionPoolerConnectionError(error, clientConfig.host, clientConfig.port),
      { cause: error },
    );
  }
}
