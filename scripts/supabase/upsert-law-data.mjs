import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const LAW_TYPES = 'Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc';
const LAW_API_BASE = 'https://laws.e-gov.go.jp/api/2';
const DEFAULT_CHUNK_SIZE = 200;
const DEFAULT_UPDATED_WITHIN_DAYS = 7;

function parseArgs(argv) {
  const options = {
    all: false,
    dryRun: false,
    limit: null,
    lawNums: new Set(),
    refDir: process.env.LAWDATA_REF_DIR || path.join(process.cwd(), 'public', 'ref_json'),
    updatedWithinDays: DEFAULT_UPDATED_WITHIN_DAYS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      options.all = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--limit must be a positive integer.');
      }
      options.limit = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--law-num') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--law-num requires a value.');
      }
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => options.lawNums.add(v));
      i += 1;
      continue;
    }
    if (arg === '--updated-within-days') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('--updated-within-days must be a non-negative number.');
      }
      options.updatedWithinDays = value;
      i += 1;
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

function chunkArray(input, size = DEFAULT_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickRevisionInfo(source) {
  if (!source || typeof source !== 'object') return null;
  return source.current_revision_info ?? source.revision_info ?? null;
}

function extractLawRevisionMarker(source) {
  const revisionInfo = pickRevisionInfo(source);
  const lawRevisionId = asNonEmptyString(revisionInfo?.law_revision_id);
  if (lawRevisionId) return `law_revision_id:${lawRevisionId}`;

  const updated = asNonEmptyString(revisionInfo?.updated);
  if (updated) return `updated:${updated}`;

  const amendmentEnforcementDate = asNonEmptyString(revisionInfo?.amendment_enforcement_date);
  if (amendmentEnforcementDate) return `amendment_enforcement_date:${amendmentEnforcementDate}`;

  const amendmentPromulgateDate = asNonEmptyString(revisionInfo?.amendment_promulgate_date);
  if (amendmentPromulgateDate) return `amendment_promulgate_date:${amendmentPromulgateDate}`;

  return null;
}

function toTimestamp(value) {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function supabaseOrThrow(error, context) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
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

async function fetchLawArticle(lawNum) {
  return fetchJson(`${LAW_API_BASE}/law_data/${encodeURIComponent(lawNum)}`);
}

async function readRefData(refDir, lawNum) {
  const filePath = path.join(refDir, `${lawNum}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isJsonNode(node) {
  return !!node && typeof node === 'object' && typeof node.tag === 'string' && Array.isArray(node.children);
}

function flattenText(children) {
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      if (isJsonNode(child)) return flattenText(child.children ?? []);
      return '';
    })
    .join('');
}

function findFirstTag(node, tag) {
  if (!isJsonNode(node)) return null;
  if (node.tag === tag) return node;
  for (const child of node.children ?? []) {
    if (isJsonNode(child)) {
      const found = findFirstTag(child, tag);
      if (found) return found;
    }
  }
  return null;
}

function buildTocItems(lawArticle) {
  const tocItems = [];
  const lawFullText = lawArticle?.law_full_text;
  if (!isJsonNode(lawFullText)) return tocItems;
  const tocNode = findFirstTag(lawFullText, 'TOC');
  if (!tocNode?.children) return tocItems;

  for (const child of tocNode.children) {
    if (!isJsonNode(child)) continue;

    if (child.tag === 'TOCChapter') {
      const chapterNum = child?.attr?.Num ?? '';
      const chapterTitleNode = (child.children ?? []).find((c) => isJsonNode(c) && c.tag === 'ChapterTitle');
      const articleRangeNode = (child.children ?? []).find((c) => isJsonNode(c) && c.tag === 'ArticleRange');
      const chapterLabel = chapterTitleNode ? flattenText(chapterTitleNode.children ?? []) : '';
      const articleRange = articleRangeNode ? flattenText(articleRangeNode.children ?? []) : '';

      if (chapterLabel) {
        tocItems.push({
          id: `toc-chapter-${chapterNum || chapterLabel}`,
          label: `${chapterLabel}${articleRange}`,
          depth: 0,
        });
      }

      for (const section of child.children ?? []) {
        if (!isJsonNode(section) || section.tag !== 'TOCSection') continue;
        const sectionNum = section?.attr?.Num ?? '';
        const sectionTitleNode = (section.children ?? []).find((c) => isJsonNode(c) && c.tag === 'SectionTitle');
        const sectionRangeNode = (section.children ?? []).find((c) => isJsonNode(c) && c.tag === 'ArticleRange');
        const sectionLabel = sectionTitleNode ? flattenText(sectionTitleNode.children ?? []) : '';
        const sectionRange = sectionRangeNode ? flattenText(sectionRangeNode.children ?? []) : '';
        if (sectionLabel) {
          tocItems.push({
            id: `toc-chapter-${chapterNum || '0'}-section-${sectionNum || sectionLabel}`,
            label: `${sectionLabel}${sectionRange}`,
            depth: 1,
          });
        }
      }
    }

    if (child.tag === 'TOCSupplProvision') {
      const labelNode = (child.children ?? []).find((c) => isJsonNode(c) && c.tag === 'SupplProvisionLabel');
      const label = labelNode ? flattenText(labelNode.children ?? []) : '附則';
      tocItems.push({
        id: 'toc-suppl-provision',
        label,
        depth: 0,
      });
    }
  }

  return tocItems;
}

function collectArticles(node, out = []) {
  if (!isJsonNode(node)) return out;
  for (const child of node.children ?? []) {
    if (!isJsonNode(child)) continue;
    if (child.tag === 'Article') {
      out.push(child);
    }
    collectArticles(child, out);
  }
  return out;
}

function buildArticleMap(lawArticle) {
  const articleMap = {};
  const lawFullText = lawArticle?.law_full_text;
  if (!isJsonNode(lawFullText)) return articleMap;

  const lawBody = (lawFullText.children ?? []).find((child) => isJsonNode(child) && child.tag === 'LawBody');
  if (!lawBody?.children) return articleMap;

  for (const part of lawBody.children) {
    if (!isJsonNode(part)) continue;
    if (part.tag !== 'MainProvision' && part.tag !== 'SupplProvision') continue;

    const provisionKey = part.tag === 'MainProvision'
      ? 'MainProvision'
      : asNonEmptyString(part?.attr?.AmendLawNum) ?? 'SupplProvision';

    const articles = collectArticles(part, []);
    for (const article of articles) {
      const articleNum = asNonEmptyString(article?.attr?.Num);
      if (!articleNum) continue;
      const key = `${provisionKey}:${articleNum}`;
      if (!(key in articleMap)) {
        articleMap[key] = article;
      }
    }
  }

  return articleMap;
}

function searchLawText(node, out = []) {
  if (!isJsonNode(node)) return out;
  for (const child of node.children ?? []) {
    if (typeof child === 'string') {
      out.push(child);
    } else if (isJsonNode(child)) {
      searchLawText(child, out);
    }
  }
  return out;
}

function buildRefLawTitleList(lawArticle, laws) {
  const lawTexts = isJsonNode(lawArticle?.law_full_text) ? searchLawText(lawArticle.law_full_text, []) : [];
  const refLaw = new Set();
  const regex = /(?<=（)((?:令和|平成|昭和|大正|明治)[元一二三四五六七八九十]+年(?:法律|政令|(?:[^）]?省令)|内閣府令)第[一二三四五六七八九十百千万]+号)(?:。以下「([^）]*?)」という。)?(?=）)/g;
  const titleAliasRegex = /([^（\n]{2,120}?)（以下「([^」]+?)」という。?）/g;
  const synonym = {};
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pushSynonym = (lawNum, alias) => {
    if (!synonym[lawNum]) {
      synonym[lawNum] = [];
    }
    if (!synonym[lawNum].includes(alias)) {
      synonym[lawNum].push(alias);
    }
  };

  for (const text of lawTexts) {
    let match = null;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        refLaw.add(match[1]);
      }
      if (match[1] && match[2]) {
        pushSynonym(match[1], match[2]);
      }
    }
    while ((match = titleAliasRegex.exec(text)) !== null) {
      const rawName = match[1]?.trim();
      const alias = match[2]?.trim();
      if (!rawName || !alias) continue;
      const matchedLaw = laws.find((law) => {
        const title = law?.current_revision_info?.law_title;
        return typeof title === 'string' && rawName.endsWith(title);
      });
      const lawNum = matchedLaw?.law_info?.law_num;
      if (typeof lawNum === 'string') {
        refLaw.add(lawNum);
        pushSynonym(lawNum, alias);
      }
    }
  }

  for (const lawNum of refLaw) {
    const lawTitle = laws.find((law) => law?.law_info?.law_num === lawNum)?.current_revision_info?.law_title;
    if (!lawTitle) continue;
    const synonymRegex = new RegExp(`${escapeRegExp(lawTitle)}（以下「(.*?)」という。）`, 'g');
    for (const text of lawTexts) {
      let match = null;
      while ((match = synonymRegex.exec(text)) !== null) {
        if (match[1]) {
          pushSynonym(lawNum, match[1]);
        }
      }
    }
  }

  const refLawList = Array.from(refLaw);
  const referencedLaws = refLawList
    .map((lawNum) => laws.find((law) => law?.law_info?.law_num === lawNum))
    .filter(Boolean);
  const uniqueByType = (aliases, lawType) => {
    const matched = referencedLaws.filter((law) => law?.law_info?.law_type === lawType);
    if (matched.length !== 1) return;
    const lawNum = matched[0]?.law_info?.law_num;
    if (typeof lawNum !== 'string') return;
    aliases.forEach((alias) => pushSynonym(lawNum, alias));
  };
  uniqueByType(['同法'], 'Act');
  uniqueByType(['同令', '同政令'], 'CabinetOrder');
  uniqueByType(['同省令'], 'MinisterialOrdinance');
  uniqueByType(['同規則'], 'Rule');

  return {
    lawTitleList: refLawList,
    synonymList: synonym,
  };
}

function normalizeAttrKeys(attr = {}) {
  const normalized = {};
  const keyMap = {
    rowspan: 'rowSpan',
    colspan: 'colSpan',
    WritingMode: 'writingMode',
  };

  for (const [key, value] of Object.entries(attr)) {
    const mappedKey = keyMap[key] || key.toLowerCase();
    normalized[mappedKey] = value;
  }
  return normalized;
}

function buildVirtualTree(node) {
  if (typeof node === 'string') {
    return { type: 'text', value: node };
  }
  const children = Array.isArray(node?.children) ? node.children : [];
  return {
    type: 'element',
    tag: node?.tag || 'span',
    attr: normalizeAttrKeys(node?.attr || {}),
    children: children.map((child) => buildVirtualTree(child)),
  };
}

function buildVnodePayload(lawArticle) {
  const lawFullText = lawArticle?.law_full_text;
  if (!isJsonNode(lawFullText)) return [];
  return [buildVirtualTree(lawFullText)];
}

function normalizeLawRow(law) {
  const lawNum = asNonEmptyString(law?.law_info?.law_num);
  const lawTitle = asNonEmptyString(law?.current_revision_info?.law_title);
  if (!lawNum || !lawTitle) {
    return null;
  }

  const revisionMarker = extractLawRevisionMarker(law) ?? 'unknown';
  return {
    law_num: lawNum,
    law_id: asNonEmptyString(law?.law_info?.law_id),
    law_type: asNonEmptyString(law?.law_info?.law_type),
    law_title: lawTitle,
    revision_marker: revisionMarker,
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

function filterByUpdatedWithinDays(lawRows, days) {
  if (!Number.isFinite(days) || days < 0) return lawRows;

  const cutoffMillis = Date.now() - (days * 24 * 60 * 60 * 1000);
  return lawRows.filter((row) => {
    if (!row.updated_source) return false;
    const updatedMillis = Date.parse(row.updated_source);
    if (Number.isNaN(updatedMillis)) return false;
    return updatedMillis >= cutoffMillis;
  });
}

async function fetchExistingMarkers(client) {
  const markerMap = new Map();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from('laws')
      .select('law_num, revision_marker')
      .range(from, to);
    supabaseOrThrow(error, 'load existing markers');

    if (!data || data.length === 0) break;
    for (const row of data) {
      markerMap.set(row.law_num, row.revision_marker);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return markerMap;
}


function buildReferenceRows(refData, sourceLawNum, sourceRevisionMarker) {
  const rows = [];
  for (const item of refData) {
    const targetLawNum = asNonEmptyString(item?.ref?.lawNum);
    const targetProvision = asNonEmptyString(item?.ref?.lawArticle?.provision);
    const targetArticle = asNonEmptyString(item?.ref?.lawArticle?.article);
    if (!targetLawNum || !targetProvision || !targetArticle) continue;

    rows.push({
      source_law_num: sourceLawNum,
      source_revision_marker: sourceRevisionMarker,
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
      similarity_score: asFiniteNumber(item?.similarityScore),
    });
  }
  return rows;
}

async function upsertLawRows(client, lawRows, dryRun) {
  if (dryRun || lawRows.length === 0) return;
  const chunks = chunkArray(lawRows, 500);
  for (const rows of chunks) {
    const { error } = await client.from('laws').upsert(rows, { onConflict: 'law_num' });
    supabaseOrThrow(error, 'upsert laws');
  }
}

async function insertReferences(client, rows) {
  if (rows.length === 0) return;
  const chunks = chunkArray(rows, 500);
  for (const chunk of chunks) {
    const { error } = await client.from('law_references').insert(chunk);
    supabaseOrThrow(error, 'insert references');
  }
}

async function processOneLaw({ client, lawRow, lawList, options }) {
  const lawNum = lawRow.law_num;
  console.log(`  processing: ${lawNum}`);

  const lawArticle = await fetchLawArticle(lawNum);
  const revisionMarker = extractLawRevisionMarker(lawArticle) ?? lawRow.revision_marker;
  const refData = await readRefData(options.refDir, lawNum);
  if (options.dryRun) {
    return { lawNum, referenceCount: refData.length };
  }

  const { error: resetCurrentError } = await client
    .from('law_versions')
    .update({ is_current: false })
    .eq('law_num', lawNum)
    .neq('revision_marker', revisionMarker)
    .eq('is_current', true);
  supabaseOrThrow(resetCurrentError, `reset current version: ${lawNum}`);

  const { error: upsertVersionError } = await client.from('law_versions').upsert(
    [{
      law_num: lawNum,
      revision_marker: revisionMarker,
      is_current: true,
      source_revision_info: lawArticle?.revision_info ?? {},
    }],
    { onConflict: 'law_num,revision_marker' },
  );
  supabaseOrThrow(upsertVersionError, `upsert law_versions: ${lawNum}`);


  const referenceRows = buildReferenceRows(refData, lawNum, revisionMarker);
  const { error: deleteRefError } = await client
    .from('law_references')
    .delete()
    .eq('source_law_num', lawNum)
    .eq('source_revision_marker', revisionMarker);
  supabaseOrThrow(deleteRefError, `delete references: ${lawNum}`);
  await insertReferences(client, referenceRows);

  const { error: syncLawsError } = await client
    .from('laws')
    .update({
      revision_marker: revisionMarker,
      source_revision_info: lawArticle?.revision_info ?? lawRow.source_revision_info,
      updated_source: toTimestamp(lawArticle?.revision_info?.updated ?? lawArticle?.current_revision_info?.updated),
    })
    .eq('law_num', lawNum);
  supabaseOrThrow(syncLawsError, `sync laws row: ${lawNum}`);

  return { lawNum, referenceCount: referenceRows.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('loading law list from e-Gov API...');
  const lawList = await fetchLawList();
  const normalizedLawRows = lawList.map((law) => normalizeLawRow(law)).filter(Boolean);
  const lawRows = dedupeLawRows(normalizedLawRows);
  console.log(`law list loaded: ${lawList.length} rows, deduped: ${lawRows.length} rows`);

  const recentlyUpdatedLawRows = filterByUpdatedWithinDays(lawRows, options.updatedWithinDays);
  if (!options.all && options.lawNums.size === 0) {
    console.log(`recently updated laws (last ${options.updatedWithinDays} days): ${recentlyUpdatedLawRows.length}`);
  }

  console.log('loading existing revision markers from Supabase...');
  const existingMap = await fetchExistingMarkers(client);
  const baseRows = options.all || options.lawNums.size > 0 ? lawRows : recentlyUpdatedLawRows;
  await upsertLawRows(client, baseRows, options.dryRun);

  let targetRows = baseRows.filter((row) => {
    if (options.lawNums.size > 0) return options.lawNums.has(row.law_num);
    if (options.all) return true;
    const isChanged = existingMap.get(row.law_num) !== row.revision_marker;
    return isChanged;
  });

  if (options.limit) {
    targetRows = targetRows.slice(0, options.limit);
  }

  let runId = null;
  if (!options.dryRun) {
    const { data, error } = await client
      .from('ingest_runs')
      .insert([{ status: 'running', changed_law_count: targetRows.length }])
      .select('id')
      .single();
    supabaseOrThrow(error, 'create ingest run');
    runId = data.id;
  }

  console.log(`target laws: ${targetRows.length}`);
  let processedCount = 0;
  let failedCount = 0;
  const errors = [];

  for (const row of targetRows) {
    try {
      await processOneLaw({ client, lawRow: row, lawList, options });
      processedCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${row.law_num}: ${message}`);
      console.error(`  failed: ${row.law_num} -> ${message}`);
    }
  }

  const status = failedCount === 0 ? 'success' : processedCount > 0 ? 'partial_success' : 'failed';
  if (!options.dryRun && runId) {
    const { error } = await client
      .from('ingest_runs')
      .update({
        status,
        processed_count: processedCount,
        failed_count: failedCount,
        error_log: errors.join('\n').slice(0, 100000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    supabaseOrThrow(error, 'finish ingest run');
  }

  console.log(`done: status=${status}, processed=${processedCount}, failed=${failedCount}`);
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
