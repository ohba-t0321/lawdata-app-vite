import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const LAW_TYPES = 'Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc';
const LAW_API_BASE = 'https://laws.e-gov.go.jp/api/2';
const DEFAULT_CHUNK_SIZE = 1000;
const MANIFEST_FILE = '_meta.json';

function parseArgs(argv) {
  const options = {
    chunkSize: DEFAULT_CHUNK_SIZE,
    dryRun: false,
    refDir: process.env.LAWDATA_REF_DIR || path.join(process.cwd(), 'public', 'ref_json'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--chunk-size') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--chunk-size must be a positive integer.');
      }
      options.chunkSize = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--ref-dir') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--ref-dir requires a value.');
      }
      options.refDir = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestamp(value) {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseProjectRef(supabaseUrl) {
  const match = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : null;
}

function buildDirectClientConfig(databaseUrl) {
  const connectionString = databaseUrl.includes('sslmode=')
    ? databaseUrl
    : `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=require`;
  return {
    application_name: 'lawdata-ref-json-full-sync',
    connectionString,
    connectionTimeoutMillis: 4000,
    ssl: { rejectUnauthorized: false },
  };
}

function buildPoolerClientConfigs(databaseUrl, supabaseUrl) {
  const dbUrl = new URL(databaseUrl);
  const ref = parseProjectRef(supabaseUrl);
  if (!ref) {
    return [];
  }

  const regions = [
    'ap-northeast-1',
  ];

  const configs = [];
  for (const shard of [0, 1, 2]) {
    for (const region of regions) {
      configs.push({
        application_name: 'lawdata-ref-json-full-sync',
        connectionTimeoutMillis: 3500,
        database: (dbUrl.pathname || '/postgres').slice(1) || 'postgres',
        host: `aws-${shard}-${region}.pooler.supabase.com`,
        password: decodeURIComponent(dbUrl.password),
        port: 6543,
        ssl: { rejectUnauthorized: false },
        user: `postgres.${ref}`,
      });
    }
  }
  return configs;
}

async function connectDatabase(databaseUrl, supabaseUrl) {
  const attempts = [
    { label: 'direct', config: buildDirectClientConfig(databaseUrl) },
    ...buildPoolerClientConfigs(databaseUrl, supabaseUrl).map((config) => ({
      label: `pooler:${config.host}`,
      config,
    })),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    const client = new Client(attempt.config);
    try {
      await client.connect();
      console.log(`db_connected_via=${attempt.label}`);
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore close failures after unsuccessful connect attempts
      }
    }
  }

  throw lastError ?? new Error('Failed to connect to Supabase Postgres.');
}

async function fetchJson(url, retry = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retry; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}

function buildLawListUrl(limit) {
  const params = new URLSearchParams({
    law_type: LAW_TYPES,
    limit: String(limit),
  });
  return `${LAW_API_BASE}/laws?${params.toString()}`;
}

async function fetchLawList() {
  const first = await fetchJson(buildLawListUrl(1));
  const totalCount = Number(first?.total_count ?? 0);
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return [];
  }
  const payload = await fetchJson(buildLawListUrl(totalCount));
  return Array.isArray(payload?.laws) ? payload.laws : [];
}

function normalizeLawRow(law) {
  const lawNum = asNonEmptyString(law?.law_info?.law_num);
  const lawTitle = asNonEmptyString(law?.current_revision_info?.law_title);
  if (!lawNum || !lawTitle) {
    return null;
  }

  return {
    law_num: lawNum,
    law_id: asNonEmptyString(law?.law_info?.law_id),
    law_type: asNonEmptyString(law?.law_info?.law_type),
    law_title: lawTitle,
    current_revision_id: asNonEmptyString(law?.current_revision_info?.law_revision_id),
    updated_source: toTimestamp(law?.current_revision_info?.updated ?? law?.revision_info?.updated),
    source_law_info: law?.law_info ?? null,
    source_revision_info: law?.revision_info ?? null,
    source_current_revision_info: law?.current_revision_info ?? null,
  };
}

function dedupeLawRows(lawRows) {
  const map = new Map();
  for (const row of lawRows) {
    const current = map.get(row.law_num);
    if (!current) {
      map.set(row.law_num, row);
      continue;
    }
    const currentUpdated = current.updated_source ? Date.parse(current.updated_source) : 0;
    const nextUpdated = row.updated_source ? Date.parse(row.updated_source) : 0;
    if (nextUpdated >= currentUpdated) {
      map.set(row.law_num, row);
    }
  }
  return Array.from(map.values());
}

async function readRefData(refDir, lawNum) {
  const filePath = path.join(refDir, `${lawNum}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`ref_json file is not an array: ${filePath}`);
  }
  return parsed;
}

async function listRefJsonTargets(refDir) {
  const entries = await fs.readdir(refDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== MANIFEST_FILE)
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b, 'ja'));
}

function buildReferenceRows(refData, sourceLawNum) {
  const rows = [];
  let skippedCount = 0;

  for (const item of refData) {
    const referredLawNum = asNonEmptyString(item?.referred?.lawNum);
    if (referredLawNum && referredLawNum !== sourceLawNum) {
      throw new Error(
        `ref_json/${sourceLawNum}.json contains referred.lawNum=${referredLawNum}; expected ${sourceLawNum}`,
      );
    }

    const targetLawNum = asNonEmptyString(item?.ref?.lawNum);
    const targetProvision = asNonEmptyString(item?.ref?.lawArticle?.provision);
    const targetArticle = asNonEmptyString(item?.ref?.lawArticle?.article);
    if (!targetLawNum || !targetProvision || !targetArticle) {
      skippedCount += 1;
      continue;
    }

    rows.push({
      source_law_num: sourceLawNum,
      source_provision: asNonEmptyString(item?.referred?.lawArticle?.provision),
      source_article: asNonEmptyString(item?.referred?.lawArticle?.article),
      source_paragraph: asNonEmptyString(item?.referred?.lawArticle?.paragraph),
      source_item: asNonEmptyString(item?.referred?.lawArticle?.item),
      target_law_num: targetLawNum,
      target_provision: targetProvision,
      target_article: targetArticle,
      target_paragraph: asNonEmptyString(item?.ref?.lawArticle?.paragraph),
      target_item: asNonEmptyString(item?.ref?.lawArticle?.item),
      match_text: asNonEmptyString(item?.match),
      match_type: asNonEmptyString(item?.matchType),
      similarity_score: asFiniteNumber(item?.similarityScore),
    });
  }

  return { rows, skippedCount };
}

function buildValuesClause(rows, rowToValues) {
  const values = [];
  const placeholders = rows.map((row) => {
    const rowValues = rowToValues(row);
    const refs = rowValues.map((_, index) => `$${values.length + index + 1}`);
    values.push(...rowValues);
    return `(${refs.join(', ')})`;
  });
  return { placeholders, values };
}

async function upsertLawRows(client, lawRows, chunkSize) {
  const columns = [
    'law_num',
    'law_id',
    'law_type',
    'law_title',
    'current_revision_id',
    'updated_source',
    'source_law_info',
    'source_revision_info',
    'source_current_revision_info',
  ];

  for (let index = 0; index < lawRows.length; index += chunkSize) {
    const chunk = lawRows.slice(index, index + chunkSize);
    const { placeholders, values } = buildValuesClause(chunk, (row) => [
      row.law_num,
      row.law_id,
      row.law_type,
      row.law_title,
      row.current_revision_id,
      row.updated_source,
      row.source_law_info,
      row.source_revision_info,
      row.source_current_revision_info,
    ]);

    const sql = `
      insert into public.laws (${columns.join(', ')})
      values ${placeholders.join(', ')}
      on conflict (law_num) do update set
        law_id = excluded.law_id,
        law_type = excluded.law_type,
        law_title = excluded.law_title,
        current_revision_id = excluded.current_revision_id,
        updated_source = excluded.updated_source,
        source_law_info = excluded.source_law_info,
        source_revision_info = excluded.source_revision_info,
        source_current_revision_info = excluded.source_current_revision_info,
        updated_at = now()
    `;
    await client.query(sql, values);
  }
}

async function insertReferenceRows(client, rows) {
  const columns = [
    'source_law_num',
    'source_provision',
    'source_article',
    'source_paragraph',
    'source_item',
    'target_law_num',
    'target_provision',
    'target_article',
    'target_paragraph',
    'target_item',
    'match_text',
    'match_type',
    'similarity_score',
  ];
  const { placeholders, values } = buildValuesClause(rows, (row) => [
    row.source_law_num,
    row.source_provision,
    row.source_article,
    row.source_paragraph,
    row.source_item,
    row.target_law_num,
    row.target_provision,
    row.target_article,
    row.target_paragraph,
    row.target_item,
    row.match_text,
    row.match_type,
    row.similarity_score,
  ]);
  const sql = `
    insert into public.law_references (${columns.join(', ')})
    values ${placeholders.join(', ')}
  `;
  await client.query(sql, values);
}

async function countReferenceRows(refDir, targetLawNums) {
  let rowCount = 0;
  let skippedCount = 0;

  for (const lawNum of targetLawNums) {
    const refData = await readRefData(refDir, lawNum);
    const { rows, skippedCount: nextSkippedCount } = buildReferenceRows(refData, lawNum);
    rowCount += rows.length;
    skippedCount += nextSkippedCount;
  }

  return { rowCount, skippedCount };
}

async function replaceReferenceRows(client, refDir, targetLawNums, chunkSize) {
  let insertedRowCount = 0;
  let skippedCount = 0;
  let pendingRows = [];

  for (const [index, lawNum] of targetLawNums.entries()) {
    const refData = await readRefData(refDir, lawNum);
    const { rows, skippedCount: nextSkippedCount } = buildReferenceRows(refData, lawNum);
    skippedCount += nextSkippedCount;
    pendingRows.push(...rows);
    insertedRowCount += rows.length;

    while (pendingRows.length >= chunkSize) {
      const chunk = pendingRows.slice(0, chunkSize);
      pendingRows = pendingRows.slice(chunkSize);
      await insertReferenceRows(client, chunk);
    }

    if ((index + 1) % 250 === 0 || index + 1 === targetLawNums.length) {
      console.log(`  processed ref_json files: ${index + 1}/${targetLawNums.length}`);
    }
  }

  if (pendingRows.length > 0) {
    await insertReferenceRows(client, pendingRows);
  }

  return { insertedRowCount, skippedCount };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log('loading law list from e-Gov API...');
  const lawList = await fetchLawList();
  const lawRows = dedupeLawRows(lawList.map((law) => normalizeLawRow(law)).filter(Boolean));
  console.log(`law list loaded: ${lawList.length} rows, deduped: ${lawRows.length} rows`);

  const targetLawNums = await listRefJsonTargets(options.refDir);
  console.log(`ref_json targets: ${targetLawNums.length}`);

  const lawNumSet = new Set(lawRows.map((row) => row.law_num));
  const missingLawNums = targetLawNums.filter((lawNum) => !lawNumSet.has(lawNum));
  if (missingLawNums.length > 0) {
    const preview = missingLawNums.slice(0, 20).join(', ');
    throw new Error(
      `ref_json contains ${missingLawNums.length} files that are not present in the e-Gov law list: ${preview}`,
    );
  }

  if (options.dryRun) {
    const { rowCount, skippedCount } = await countReferenceRows(options.refDir, targetLawNums);
    console.log(
      `dry-run complete: target_files=${targetLawNums.length}, inserted_rows=${rowCount}, skipped_rows=${skippedCount}`,
    );
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  const client = await connectDatabase(databaseUrl, supabaseUrl);
  try {
    await client.query('begin');
    console.log('upserting laws...');
    await upsertLawRows(client, lawRows, options.chunkSize);

    console.log('replacing public.law_references from ref_json...');
    await client.query('truncate table public.law_references restart identity');
    const { insertedRowCount, skippedCount } = await replaceReferenceRows(
      client,
      options.refDir,
      targetLawNums,
      options.chunkSize,
    );
    await client.query('commit');
    console.log(
      `done: target_files=${targetLawNums.length}, inserted_rows=${insertedRowCount}, skipped_rows=${skippedCount}`,
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
