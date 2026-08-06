import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articleSourceId,
  dedupeEdges,
  edgeToNextLocator,
  extractLawArticle,
  locatorKey,
  parseKeywordResponse,
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
