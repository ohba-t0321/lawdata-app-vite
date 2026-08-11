import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articleSourceId,
  dedupeEdges,
  edgeToNextLocator,
  extractLawArticle,
  keywordPlainText,
  locatorKey,
  parseLawListResponse,
  parseKeywordResponse,
  resolveKeywordSource,
} from '../../supabase/functions/_shared/law-agent-core.mjs';

test('reference edges preserve outgoing and incoming direction', () => {
  const edge = {
    source_law_num: '法A', source_law_title: '法A題', source_provision: 'MainProvision', source_article: '1',
    target_law_num: '法B', target_law_title: '法B題', target_provision: 'MainProvision', target_article: '2',
  };
  assert.equal(edgeToNextLocator(edge, 'outgoing').lawNum, '法B');
  assert.equal(edgeToNextLocator(edge, 'incoming').lawNum, '法A');
  assert.equal(dedupeEdges([edge, edge], 'outgoing').length, 1);
  assert.equal(dedupeEdges([edge], 'outgoing', 5, new Set(['law:法B:MainProvision:2'])).length, 0);
});

test('reference edge pruning enforces fan-out limits', () => {
  const edges = Array.from({ length: 10 }, (_, index) => ({
    source_law_num: '法A', source_provision: 'MainProvision', source_article: '1',
    target_law_num: `法${index}`, target_provision: 'MainProvision', target_article: String(index + 1),
  }));
  assert.equal(dedupeEdges(edges, 'outgoing', 3).length, 3);
});

test('keyword sources become unverified traversal seeds', () => {
  const sources = parseKeywordResponse({ items: [{
    law_info: { law_num: '法A' },
    revision_info: { law_title: '法A題', law_revision_id: 'rev-a' },
    sentences: [{ position: 'MainProvision-Article_3-Paragraph_1', text: '検索結果本文' }],
  }] });
  assert.equal(sources[0].article, '3');
  assert.equal(sources[0].paragraph, '1');
  assert.equal(sources[0].verifiedCurrent, false);
});

test('keyword snippets are plain text and broad positions resolve against the same revision body', () => {
  const payload = {
    law_info: { law_num: '法A' },
    revision_info: { law_title: '法A題', law_revision_id: 'rev-a' },
    current_revision_info: { law_title: '将来の法A題', law_revision_id: 'rev-future' },
    law_full_text: { tag: 'Law', children: [{ tag: 'LawBody', children: [
      { tag: 'MainProvision', children: [
        { tag: 'Article', attr: { Num: '1' }, children: ['この条文は検索対象ではない。'] },
        { tag: 'Article', attr: { Num: '2' }, children: ['事業者は、個人情報を適正に取り扱わなければならない。'] },
      ] },
    ] }] },
  };
  const [source] = parseKeywordResponse({ items: [{
    law_info: { law_num: '法A' },
    revision_info: { law_title: '法A題', law_revision_id: 'rev-a' },
    sentences: [{ position: 'mainprovision', text: '事業者は、<mark>個人情報</mark>を適正に取り扱わなければならない。' }],
  }] });
  const resolved = resolveKeywordSource(payload, source);
  assert.equal(source.text.includes('<mark>'), false);
  assert.equal(resolved.article, '2');
  assert.equal(resolved.lawRevisionId, 'rev-a');
  assert.equal(resolved.lawTitle, '法A題');
  assert.equal(keywordPlainText('&lt;表示&gt; <em>根拠</em>'), '<表示> 根拠');
});

test('law title search candidates preserve identifiers', () => {
  const candidates = parseLawListResponse({ laws: [{
    law_info: { law_id: '405AC0000000088', law_num: '平成五年法律第八十八号', promulgation_date: '1993-11-12' },
    revision_info: { law_title: '旧題名', law_revision_id: 'old-revision' },
    current_revision_info: { law_title: '行政手続法', law_revision_id: 'current-revision', law_type: 'Act' },
  }] });
  assert.deepEqual(candidates[0], {
    lawNum: '平成五年法律第八十八号',
    lawId: '405AC0000000088',
    lawTitle: '行政手続法',
    lawRevisionId: 'current-revision',
    lawType: 'Act',
    promulgationDate: '1993-11-12',
  });
});

test('article extractor resolves main and supplementary provisions', () => {
  const article = (num, value) => ({ tag: 'Article', attr: { Num: num }, children: [{ tag: 'Paragraph', children: [value] }] });
  const payload = {
    law_info: { law_num: '法A' },
    revision_info: { law_title: '法A題', law_revision_id: 'rev-a' },
    law_full_text: { tag: 'Law', children: [{ tag: 'LawBody', children: [
      { tag: 'MainProvision', children: [article('1', '本則本文')] },
      { tag: 'SupplProvision', children: [article('2', '附則本文')] },
      { tag: 'SupplProvision', attr: { AmendLawNum: '改正法X' }, children: [article('3', '改正附則本文')] },
    ] }] },
  };
  assert.equal(extractLawArticle(payload, { lawNum: '法A', provision: 'MainProvision', article: '1' }).text, '本則本文');
  assert.equal(extractLawArticle(payload, { lawNum: '法A', provision: 'SupplProvision', article: '2' }).text, '附則本文');
  assert.equal(extractLawArticle(payload, { lawNum: '法A', provision: '改正法X', article: '3' }).text, '改正附則本文');
  assert.equal(articleSourceId({ lawNum: '法A', provision: 'MainProvision', article: '1' }), 'law:法A:MainProvision:1');
  assert.equal(locatorKey({ lawNum: '法A', provision: 'MainProvision', article: '1' }), '法A:MainProvision:1::');
});
