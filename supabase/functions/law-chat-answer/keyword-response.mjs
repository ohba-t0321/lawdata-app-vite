/**
 * e-Gov 法令API v2 /keyword のレスポンスをチャット用根拠へ変換する。
 * APIでは法令情報とヒット文が親子に分かれているため、法令単位で文を展開する。
 */

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function parsePosition(value) {
  if (typeof value !== 'string') return { provision: 'MainProvision', article: '' };
  const provision = value.startsWith('SupplProvision') ? 'SupplProvision' : 'MainProvision';
  const article = value.match(/(?:^|-)Article_([^\-]+)/)?.[1] ?? '';
  return { provision, article };
}

function sentenceText(sentence) {
  const text = sentence.text ?? sentence.sentence;
  if (typeof text === 'string') return text.replace(/\s+/g, ' ').trim();
  if (Array.isArray(text)) return text.map(asString).filter(Boolean).join(' ');
  return '';
}

export function parseKeywordResponse(payload, limit = 8, maxTextLength = 4_000) {
  const root = asRecord(payload);
  const items = Array.isArray(root.items) ? root.items : [];
  const sources = [];

  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const lawInfo = asRecord(item.law_info);
    const revisionInfo = asRecord(item.revision_info);
    const lawNum = asString(lawInfo.law_num || lawInfo.law_id);
    const lawTitle = asString(revisionInfo.law_title || lawInfo.law_title) || lawNum;
    const sentences = Array.isArray(item.sentences) ? item.sentences : [];

    for (const rawSentence of sentences) {
      if (sources.length >= limit) return sources;
      const sentence = asRecord(rawSentence);
      const text = sentenceText(sentence);
      if (!lawNum || !text) continue;
      const position = parsePosition(sentence.position);
      const sourceId = `keyword:${lawNum}:${position.provision}:${position.article}:${sources.length}`;
      sources.push({
        sourceId,
        lawNum,
        lawTitle,
        provision: position.provision,
        article: position.article,
        text: text.slice(0, maxTextLength),
        origin: 'keyword',
      });
    }
  }
  return sources;
}
