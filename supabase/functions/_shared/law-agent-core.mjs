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
      const text = compactText(sentence.text ?? sentence.sentence);
      if (!lawNum || !text) continue;
      const position = parsePosition(sentence.position);
      sources.push({
        sourceId: `keyword:${lawNum}:${position.provision}:${position.article}:${sources.length}`,
        lawNum,
        lawTitle,
        lawRevisionId,
        ...position,
        text: text.slice(0, maxTextLength),
        origin: 'keyword',
        verifiedCurrent: false,
      });
    }
  }
  return sources;
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

export function extractLawArticle(payload, locator, maxTextLength = 6_000) {
  const root = asRecord(payload);
  const lawInfo = asRecord(root.law_info);
  const revisionInfo = asRecord(root.revision_info);
  const currentRevisionInfo = asRecord(root.current_revision_info);
  const lawNum = asString(lawInfo.law_num) || asString(locator?.lawNum);
  const lawTitle = asString(currentRevisionInfo.law_title || revisionInfo.law_title) || lawNum;
  const lawRevisionId = asString(currentRevisionInfo.law_revision_id || revisionInfo.law_revision_id);
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
