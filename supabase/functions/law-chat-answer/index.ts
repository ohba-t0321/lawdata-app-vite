import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Source = {
  sourceId: string;
  lawNum: string;
  lawTitle: string;
  provision: string;
  article: string;
  text: string;
  origin: 'visible' | 'reference' | 'expanded' | 'keyword';
};

type RequestBody = {
  threadId: string | null;
  question: string;
  visibleSources: Source[];
  pinnedReferenceSource: Source | null;
  expandedReferenceSources: Source[];
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const E_GOV_API = 'https://laws.e-gov.go.jp/api/2';
const MAX_KEYWORDS = 3;
const MAX_SEARCH_SOURCES = 8;
const MAX_SOURCE_CHARS = 4_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function compactText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(compactText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return compactText(record.text);
    if (Array.isArray(record.children)) return compactText(record.children);
  }
  return '';
}

function stringAt(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function collectKeywordSources(value: unknown, keyword: string, output: Source[]): void {
  if (output.length >= MAX_SEARCH_SOURCES || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeywordSources(item, keyword, output);
    return;
  }

  const record = value as Record<string, unknown>;
  const lawInfo = record.law_info && typeof record.law_info === 'object'
    ? record.law_info as Record<string, unknown>
    : record;
  const revisionInfo = lawInfo.current_revision_info && typeof lawInfo.current_revision_info === 'object'
    ? lawInfo.current_revision_info as Record<string, unknown>
    : lawInfo;
  const sentence = record.sentence && typeof record.sentence === 'object'
    ? record.sentence as Record<string, unknown>
    : record;
  const text = compactText(sentence.text ?? sentence.sentence ?? record.text);
  const lawNum = stringAt(lawInfo, ['law_num', 'law_id']) || stringAt(record, ['law_num', 'law_id']);

  if (lawNum && text) {
    const position = sentence.position && typeof sentence.position === 'object'
      ? sentence.position as Record<string, unknown>
      : sentence;
    const provision = stringAt(position, ['provision']) || 'MainProvision';
    const article = stringAt(position, ['article', 'article_num', 'num']);
    const lawTitle = stringAt(revisionInfo, ['law_title']) || stringAt(record, ['law_title']) || lawNum;
    const sourceId = `keyword:${lawNum}:${provision}:${article}:${output.length}`;
    if (!output.some((source) => source.lawNum === lawNum && source.text === text)) {
      output.push({ sourceId, lawNum, lawTitle, provision, article, text: text.slice(0, MAX_SOURCE_CHARS), origin: 'keyword' });
    }
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === 'object') collectKeywordSources(child, keyword, output);
  }
}

async function callOpenAI(apiKey: string, model: string, messages: unknown[], schemaName: string, schema: unknown) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenAI API returned no message');
  return { value: JSON.parse(content), model: payload.model ?? model, usage: payload.usage ?? null };
}

async function extractKeywords(apiKey: string, model: string, question: string): Promise<string[]> {
  const result = await callOpenAI(apiKey, model, [
    { role: 'system', content: '日本法の質問から、e-Gov法令検索に適した主題語を1〜3個抽出してください。条文番号や一般的すぎる語は避け、法令本文に現れそうな短い語句にします。' },
    { role: 'user', content: question },
  ], 'law_search_keywords', {
    type: 'object',
    properties: { keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_KEYWORDS } },
    required: ['keywords'],
    additionalProperties: false,
  });
  return [...new Set((result.value.keywords as unknown[])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim()).filter(Boolean))].slice(0, MAX_KEYWORDS);
}

async function searchLaws(keywords: string[]): Promise<Source[]> {
  const settled = await Promise.allSettled(keywords.map(async (keyword) => {
    const url = new URL(`${E_GOV_API}/keyword`);
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('limit', String(MAX_SEARCH_SOURCES));
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`e-Gov keyword API error (${response.status})`);
    return { keyword, payload: await response.json() };
  }));
  const sources: Source[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') collectKeywordSources(result.value.payload, result.value.keyword, sources);
  }
  return sources.slice(0, MAX_SEARCH_SOURCES);
}

function formatSources(sources: Source[]): string {
  return sources.map((source) => [
    `[${source.sourceId}] ${source.lawTitle}（${source.lawNum}） ${source.provision} 第${source.article || '?'}条`,
    source.text.slice(0, MAX_SOURCE_CHARS),
  ].join('\n')).join('\n\n');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
    const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
    if (!supabaseUrl || !anonKey || !apiKey) return json({ error: 'Server secrets are not configured' }, 500);

    const authHeader = request.headers.get('Authorization') ?? '';
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await request.json() as RequestBody;
    const question = body.question?.trim();
    if (!question || question.length > 4_000) return json({ error: 'Invalid question' }, 400);

    let threadId = body.threadId;
    if (threadId) {
      const { data } = await supabase.from('chat_threads').select('id').eq('id', threadId).eq('user_id', user.id).maybeSingle();
      if (!data) return json({ error: 'Thread not found' }, 404);
    } else {
      const { data, error } = await supabase.from('chat_threads').insert({
        user_id: user.id,
        title: question.slice(0, 50),
      }).select('id').single();
      if (error || !data) throw error ?? new Error('Could not create thread');
      threadId = data.id;
    }

    const keywords = await extractKeywords(apiKey, model, question);
    const searchedSources = await searchLaws(keywords);
    const suppliedSources = [
      ...(Array.isArray(body.visibleSources) ? body.visibleSources : []),
      ...(body.pinnedReferenceSource ? [body.pinnedReferenceSource] : []),
      ...(Array.isArray(body.expandedReferenceSources) ? body.expandedReferenceSources : []),
    ];
    const allSources = [...suppliedSources, ...searchedSources];
    if (allSources.length === 0) return json({ error: 'No legal sources were found' }, 422);

    const answer = await callOpenAI(apiKey, model, [
      {
        role: 'system',
        content: 'あなたは日本法令の調査補助AIです。提供された根拠だけを使い、断定できない点は明示してください。回答には根拠のsourceIdを対応付け、検索結果は文脈が省略され得るため慎重に扱ってください。法的助言ではなく調査補助である旨を必要に応じて示します。',
      },
      ...((body.recentMessages ?? []).slice(-6)),
      { role: 'user', content: `質問:\n${question}\n\n根拠候補:\n${formatSources(allSources)}` },
    ], 'grounded_law_answer', {
      type: 'object',
      properties: {
        assistantMessage: { type: 'string' },
        citationSourceIds: { type: 'array', items: { type: 'string' } },
        insufficientContext: { type: 'boolean' },
      },
      required: ['assistantMessage', 'citationSourceIds', 'insufficientContext'],
      additionalProperties: false,
    });

    const citedIds = new Set(answer.value.citationSourceIds as string[]);
    const citations = allSources.filter((source) => citedIds.has(source.sourceId)).map(({ sourceId, lawNum, lawTitle, provision, article }) => ({
      sourceId, lawNum, lawTitle, provision, article,
    }));
    const snapshot = { ...body, searchKeywords: keywords, searchedSources };
    const { error: userInsertError } = await supabase.from('chat_messages').insert({
      thread_id: threadId, user_id: user.id, role: 'user', content: question, source_snapshot_json: snapshot,
    });
    if (userInsertError) throw userInsertError;
    const { error: answerInsertError } = await supabase.from('chat_messages').insert({
      thread_id: threadId, user_id: user.id, role: 'assistant', content: answer.value.assistantMessage,
      citations_json: citations, source_snapshot_json: snapshot, model: answer.model, usage_json: answer.usage,
    });
    if (answerInsertError) throw answerInsertError;
    await supabase.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);

    return json({
      threadId,
      assistantMessage: answer.value.assistantMessage,
      citations,
      suggestedLaws: [],
      insufficientContext: answer.value.insufficientContext,
      model: answer.model,
      usage: answer.usage,
      searchKeywords: keywords,
      searchedSources,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
