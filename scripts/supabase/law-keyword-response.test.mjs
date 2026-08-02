import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKeywordResponse } from '../../supabase/functions/law-chat-answer/keyword-response.mjs';

test('e-Gov keyword response keeps parent law metadata on each sentence', () => {
  const sources = parseKeywordResponse({
    total_count: 1,
    items: [{
      law_info: { law_type: 'Act', law_id: '129AC0000000089', law_num: '平成十六年法律第八十九号' },
      revision_info: { law_title: '架空取引適正化法' },
      sentences: [{
        position: 'MainProvision-Article_12-Paragraph_1',
        text: '事業者は、取引条件を明示しなければならない。',
      }],
    }],
  });

  assert.deepEqual(sources, [{
    sourceId: 'keyword:平成十六年法律第八十九号:MainProvision:12:0',
    lawNum: '平成十六年法律第八十九号',
    lawTitle: '架空取引適正化法',
    provision: 'MainProvision',
    article: '12',
    text: '事業者は、取引条件を明示しなければならない。',
    origin: 'keyword',
  }]);
});

test('parser supports supplementary provisions and enforces source limits', () => {
  const sources = parseKeywordResponse({
    items: [{
      law_info: { law_num: '令和元年法律第一号' },
      revision_info: { law_title: 'テスト法' },
      sentences: [
        { position: 'SupplProvision-Article_2-Paragraph_1', sentence: '附則の文' },
        { position: 'MainProvision-Article_3', text: '上限を超える文' },
      ],
    }],
  }, 1);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].provision, 'SupplProvision');
  assert.equal(sources[0].article, '2');
});
