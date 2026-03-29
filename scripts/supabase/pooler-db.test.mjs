import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupabaseSessionPoolerClientConfig,
  explainSupabaseSessionPoolerConnectionError,
} from './pooler-db.mjs';

const DATABASE_POOLER_URL = 'postgresql://postgres.project:p%40ssword@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

test('buildSupabaseSessionPoolerClientConfig builds session mode config', () => {
  const config = buildSupabaseSessionPoolerClientConfig({
    poolerUrl: DATABASE_POOLER_URL,
    applicationName: 'lawdata-test',
  });

  assert.equal(config.host, 'aws-1-ap-northeast-1.pooler.supabase.com');
  assert.equal(config.port, 5432);
  assert.equal(config.user, 'postgres.project');
  assert.equal(config.password, 'p@ssword');
  assert.equal(config.database, 'postgres');
  assert.equal(config.application_name, 'lawdata-test');
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: false,
    servername: 'aws-1-ap-northeast-1.pooler.supabase.com',
  });
});

test('buildSupabaseSessionPoolerClientConfig requires DATABASE_POOLER_URL', () => {
  assert.throws(
    () => buildSupabaseSessionPoolerClientConfig({ env: {} }),
    /DATABASE_POOLER_URL is required/,
  );
});

test('buildSupabaseSessionPoolerClientConfig rejects direct hostnames', () => {
  assert.throws(
    () => buildSupabaseSessionPoolerClientConfig({
      poolerUrl: 'postgresql://postgres:p%40ssword@db.example.supabase.co:5432/postgres',
    }),
    /must point to the Supavisor pooler hostname/,
  );
});

test('buildSupabaseSessionPoolerClientConfig requires session mode port 5432', () => {
  assert.throws(
    () => buildSupabaseSessionPoolerClientConfig({
      poolerUrl: 'postgresql://postgres.project:p%40ssword@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
    }),
    /must use Supavisor session mode on port 5432/,
  );
});

test('explainSupabaseSessionPoolerConnectionError gives password guidance', () => {
  const error = Object.assign(new Error('password authentication failed for user'), {
    code: '28P01',
  });

  const message = explainSupabaseSessionPoolerConnectionError(
    error,
    'aws-1-ap-northeast-1.pooler.supabase.com',
    5432,
  );
  assert.match(message, /DATABASE_POOLER_URL/);
  assert.match(message, /password/);
});
