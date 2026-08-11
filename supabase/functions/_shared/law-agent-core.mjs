function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asString(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function compactText(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(compactText).filter(Boolean).join(' ');
  const record = asRecord(value);
  if (typeof record.text === 'string') return compactText(record.text);
  if (Array.isArray(record.children)) return compactText(record.children);
  return '';
}

function parsePosition(value) {
  if (typeof value === 'object' && value !== null) {
    const record = asRecord(value);
    return {
      provision: asString(record.provision) || 'MainProvision',
      article: asString(record.article || record.article_num || record.num),
      paragraph: asString(record.paragraph),
      item: asString(record.item),
    };
  }
  if (typeof value !== 'string') {
    return { provision: 'MainProvision', article: '', paragraph: '', item: '' };
  }
  return {
    provision: value.startsWith('SupplProvision') ? 'SupplProvision' : 'MainProvision',
    article: value.match(/(?:^|-)Article_([^\-]+)/)?.[1] ?? '',
    paragraph: value.match(/(?:^|-)Paragraph_([^\-]+)/)?.[1] ?? '',
    item: value.match(/(?:^|-)Item_([^\-]+)/)?.[1] ?? '',
  };
}

function decodeKeywordEntities(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (entity, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
}

export function keywordPlainText(value) {
  return compactText(decodeKeywordEntities(asString(value).replace(/<[^>]*>/g, '')));
}

export function locatorKey(locator) {
  return [
    asString(locator?.lawNum),
    asString(locator?.provision) || 'MainProvision',
    asString(locator?.article),
    asString(locator?.paragraph),
    asString(locator?.item),
  ].join(':');
}

export function articleSourceId(locator) {
  return `law:${asString(locator?.lawNum)}:${asString(locator?.provision) || 'MainProvision'}:${asString(locator?.article)}`;
}

export function parseKeywordResponse(payload, limit = 6, maxTextLength = 4_000) {
  const root = asRecord(payload);
  const items = Array.isArray(root.items) ? root.items : [];
  const sources = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const lawInfo = asRecord(item.law_info);
    const revisionInfo = asRecord(item.revision_info);
    const lawNum = asString(lawInfo.law_num || lawInfo.law_id);
    const lawTitle = asString(revisionInfo.law_title || lawInfo.law_title) || lawNum;
    const lawRevisionId = asString(revisionInfo.law_revision_id);
    const sentences = Array.isArray(item.sentences) ? item.sentences : [];
    for (const rawSentence of sentences) {
      if (sources.length >= limit) return sources;
      const sentence = asRecord(rawSentence);
      const text = keywordPlainText(sentence.text ?? sentence.sentence);
      if (!lawNum || !text) continue;
      const position = parsePosition(sentence.position);
      sources.push({
        sourceId: `keyword:${lawNum}:${position.provision}:${position.article}:${sources.length}`,
        lawNum,
        lawTitle,
        lawRevisionId,
        ...position,
        positionRaw: asString(sentence.position),
        text: text.slice(0, maxTextLength),
        origin: 'keyword',
        verifiedCurrent: false,
      });
    }
  }
  return sources;
}

export function parseLawListResponse(payload, limit = 6) {
  const root = asRecord(payload);
  const laws = Array.isArray(root.laws) ? root.laws : (Array.isArray(root.items) ? root.items : []);
  const candidates = [];
  for (const rawLaw of laws) {
    const law = asRecord(rawLaw);
    const lawInfo = asRecord(law.law_info);
    const revisionInfo = asRecord(law.revision_info);
    const currentRevisionInfo = asRecord(law.current_revision_info);
    const lawNum = asString(lawInfo.law_num || lawInfo.law_id);
    if (!lawNum) continue;
    candidates.push({
      lawNum,
      lawId: asString(lawInfo.law_id),
      lawTitle: asString(currentRevisionInfo.law_title || revisionInfo.law_title) || lawNum,
      lawRevisionId: asString(currentRevisionInfo.law_revision_id || revisionInfo.law_revision_id),
      lawType: asString(currentRevisionInfo.law_type || revisionInfo.law_type || lawInfo.law_type),
      promulgationDate: asString(lawInfo.promulgation_date),
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function isNode(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.tag === 'string';
}

function collectNodesByTag(node, tag, output) {
  if (!isNode(node)) return;
  if (node.tag === tag) output.push(node);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (isNode(child)) collectNodesByTag(child, tag, output);
  }
}

function findProvision(lawFullText, provision) {
  const bodies = [];
  collectNodesByTag(lawFullText, 'LawBody', bodies);
  const body = bodies[0];
  if (!body) return null;
  const wantedTag = provision === 'MainProvision' ? 'MainProvision' : 'SupplProvision';
  const amendLawNum = provision === 'MainProvision' || provision === 'SupplProvision' ? '' : provision;
  return (body.children ?? []).find((child) => {
    if (!isNode(child) || child.tag !== wantedTag) return false;
    const childAmend = asString(asRecord(child.attr).AmendLawNum);
    return amendLawNum ? childAmend === amendLawNum : !childAmend;
  }) ?? null;
}

function normalizeForMatch(value) {
  return keywordPlainText(value)
    .replace(/[\s　「」『』（）()【】\[\]]+/g, '')
    .replace(/^[…\.]+|[…\.]+$/g, '');
}

function snippetMatchScore(articleText, snippetText) {
  const article = normalizeForMatch(articleText);
  const snippet = normalizeForMatch(snippetText);
  if (!article || snippet.length < 6) return 0;
  if (article.includes(snippet)) return snippet.length + 1_000;

  const chunks = snippet
    .split(/[。！？；;]/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 12)
    .sort((left, right) => right.length - left.length);
  const exactChunk = chunks.find((chunk) => article.includes(chunk));
  if (exactChunk) return exactChunk.length + 500;

  const anchors = [];
  const anchorLength = Math.min(48, Math.max(18, Math.floor(snippet.length / 3)));
  for (let offset = 0; offset + anchorLength <= snippet.length; offset += Math.max(1, Math.floor(anchorLength / 2))) {
    const anchor = snippet.slice(offset, offset + anchorLength);
    if (article.includes(anchor)) anchors.push(anchor);
  }
  return anchors.length >= 2 ? anchors.length * anchorLength : 0;
}

/**
 * `/keyword` の断片を同じリビジョンの本文内で再探索し、条番号を確定する。
 * 複数条文が同点の場合は誤った条番号を補完せず null を返す。
 */
export function resolveKeywordSource(payload, source, maxTextLength = 6_000) {
  if (!source || !source.lawNum || !source.text) return null;
  if (String(source.positionRaw ?? '').toLowerCase() === 'toc') return null;

  if (source.article) {
    return extractLawArticle(payload, source, maxTextLength);
  }

  const root = asRecord(payload);
  const lawFullText = root.law_full_text;
  const bodies = [];
  collectNodesByTag(lawFullText, 'LawBody', bodies);
  const body = bodies[0];
  if (!body) return null;

  const candidates = [];
  for (const provisionNode of Array.isArray(body.children) ? body.children : []) {
    if (!isNode(provisionNode) || !['MainProvision', 'SupplProvision'].includes(provisionNode.tag)) continue;
    if (source.provision === 'SupplProvision' && provisionNode.tag !== 'SupplProvision') continue;
    if (source.provision === 'MainProvision' && provisionNode.tag !== 'MainProvision') continue;
    const articles = [];
    collectNodesByTag(provisionNode, 'Article', articles);
    for (const articleNode of articles) {
      const article = asString(asRecord(articleNode.attr).Num);
      if (!article) continue;
      const score = snippetMatchScore(compactText(articleNode), source.text);
      if (score <= 0) continue;
      const amendLawNum = asString(asRecord(provisionNode.attr).AmendLawNum);
      candidates.push({
        score,
        locator: {
          lawNum: source.lawNum,
          lawRevisionId: source.lawRevisionId,
          provision: provisionNode.tag === 'MainProvision' ? 'MainProvision' : (amendLawNum || 'SupplProvision'),
          article,
          paragraph: source.paragraph,
          item: source.item,
        },
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  if (!candidates[0] || (candidates[1] && candidates[1].score === candidates[0].score)) return null;
  return extractLawArticle(payload, candidates[0].locator, maxTextLength);
}

export function extractLawArticle(payload, locator, maxTextLength = 6_000) {
  const root = asRecord(payload);
  const lawInfo = asRecord(root.law_info);
  const revisionInfo = asRecord(root.revision_info);
  const currentRevisionInfo = asRecord(root.current_revision_info);
  const lawNum = asString(lawInfo.law_num) || asString(locator?.lawNum);
  const lawTitle = asString(revisionInfo.law_title || currentRevisionInfo.law_title) || lawNum;
  const lawRevisionId = asString(revisionInfo.law_revision_id || currentRevisionInfo.law_revision_id);
  const provision = asString(locator?.provision) || 'MainProvision';
  const article = asString(locator?.article);
  const provisionNode = findProvision(root.law_full_text, provision);
  if (!provisionNode || !article) return null;
  const articles = [];
  collectNodesByTag(provisionNode, 'Article', articles);
  const articleNode = articles.find((node) => asString(asRecord(node.attr).Num) === article);
  if (!articleNode) return null;
  const fullText = compactText(articleNode);
  if (!fullText) return null;
  return {
    sourceId: articleSourceId({ lawNum, provision, article }),
    lawNum,
    lawTitle,
    lawRevisionId,
    provision,
    article,
    paragraph: asString(locator?.paragraph),
    item: asString(locator?.item),
    text: fullText.slice(0, maxTextLength),
    truncated: fullText.length > maxTextLength,
    origin: 'article',
    verifiedCurrent: true,
  };
}

export function edgeToNextLocator(edge, direction) {
  const prefix = direction === 'incoming' ? 'source' : 'target';
  return {
    lawNum: asString(edge?.[`${prefix}_law_num`]),
    lawTitle: asString(edge?.[`${prefix}_law_title`]),
    provision: asString(edge?.[`${prefix}_provision`]) || 'MainProvision',
    article: asString(edge?.[`${prefix}_article`]),
    paragraph: asString(edge?.[`${prefix}_paragraph`]),
    item: asString(edge?.[`${prefix}_item`]),
  };
}

export function dedupeEdges(edges, direction, limit = 5, excludeArticleIds = new Set()) {
  const seen = new Set();
  const result = [];
  for (const edge of Array.isArray(edges) ? edges : []) {
    const next = edgeToNextLocator(edge, direction);
    const key = locatorKey(next);
    if (!next.lawNum || !next.article || seen.has(key) || excludeArticleIds.has(articleSourceId(next))) continue;
    seen.add(key);
    result.push({ ...edge, direction, nextLocator: next });
    if (result.length >= limit) break;
  }
  return result;
}

export function safeJsonParse(value, fallback = {}) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}
