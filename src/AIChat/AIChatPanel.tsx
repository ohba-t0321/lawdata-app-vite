import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../AuthContext';
import { buildPinnedReferenceSource, buildSuggestedLawCandidates, buildVisibleSources, dedupeSources } from '../ai/context';
import { readAgentEventStream } from '../ai/sse';
import type {
  AgentChatRequest,
  AgentProgressEvent,
  AgentRun,
  AgentRunSummary,
  ChatCitation,
  ChatMessage,
  ChatSource,
  ChatThread,
  GroundedChatRequest,
  GroundedChatResponse,
} from '../ai/types';
import { LawArticleContext, LawDataContext, ReferenceContext } from '../LawDataContext';
import { useLawDataWorker } from '../hooks/useLawDataWorker';
import { supabase } from '../supabaseClient';

interface AIChatPanelProps {
  onOpenCitation: (citation: ChatCitation) => void;
}

interface RefWorkerResult {
  vnode: unknown;
  text: string;
}

interface ProgressItem {
  key: string;
  message: string;
  kind: 'progress' | 'warning';
}

const agentEnabled = import.meta.env.VITE_LAW_AGENT_ENABLED !== 'false';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseThread(row: Record<string, unknown>): ChatThread {
  return {
    id: asString(row.id),
    title: asString(row.title),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
  };
}

function parseMessage(row: Record<string, unknown>): ChatMessage {
  const citations = Array.isArray(row.citations_json) ? (row.citations_json as ChatCitation[]) : null;
  const sourceSnapshot = row.source_snapshot_json && typeof row.source_snapshot_json === 'object'
    ? (row.source_snapshot_json as GroundedChatRequest)
    : null;
  const usage = row.usage_json && typeof row.usage_json === 'object'
    ? (row.usage_json as Record<string, number | null>)
    : null;
  return {
    id: asString(row.id),
    thread_id: asString(row.thread_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: asString(row.content),
    created_at: asString(row.created_at),
    citations_json: citations,
    source_snapshot_json: sourceSnapshot,
    model: typeof row.model === 'string' ? row.model : null,
    usage_json: usage,
    error_text: typeof row.error_text === 'string' ? row.error_text : null,
    agent_run_id: typeof row.agent_run_id === 'string' ? row.agent_run_id : null,
  };
}

function parseRun(row: Record<string, unknown>): AgentRun {
  const allowedStatuses = new Set<AgentRun['status']>([
    'queued', 'running', 'cancel_requested', 'completed', 'partial', 'failed', 'cancelled',
  ]);
  const rawStatus = asString(row.status) as AgentRun['status'];
  return {
    id: asString(row.id),
    thread_id: asString(row.thread_id),
    status: allowedStatuses.has(rawStatus) ? rawStatus : 'failed',
    summary_json: row.summary_json && typeof row.summary_json === 'object'
      ? row.summary_json as AgentRunSummary
      : null,
    error_text: typeof row.error_text === 'string' ? row.error_text : null,
    created_at: asString(row.created_at),
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
  };
}

function citationLabel(citation: ChatCitation): string {
  const provision = citation.provision === 'SupplProvision'
    ? '附則'
    : (citation.provision === 'MainProvision' ? '' : `（${citation.provision}）`);
  const article = citation.article ? `第${citation.article.replaceAll('_', '条の')}条` : '';
  const paragraph = citation.paragraph ? `第${citation.paragraph}項` : '';
  return `${citation.lawTitle} ${provision}${article}${paragraph}`.trim();
}

function pathLabel(summary: AgentRunSummary): string[] {
  return summary.paths.slice(0, 4).map((path) => path.map((step) => (
    `${step.lawTitle || step.lawNum} 第${step.article.replaceAll('_', '条の')}条`
  )).join(' → '));
}

export const AIChatPanel = ({ onOpenCitation }: AIChatPanelProps) => {
  const { isConfigured, session } = useContext(AuthContext);
  const { lawData } = useContext(LawDataContext);
  const { selectedLaws, articleIndexByPane } = useContext(LawArticleContext);
  const { selectedReferenceDetail } = useContext(ReferenceContext);
  const { fetchRefData } = useLawDataWorker();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runsById, setRunsById] = useState<Map<string, AgentRun>>(new Map());
  const [draft, setDraft] = useState('');
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchKeywords, setLastSearchKeywords] = useState<string[]>([]);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lawTitleMap = useMemo(
    () => new Map(lawData?.map((law) => [law.law_info.law_num, law.current_revision_info.law_title ?? law.law_info.law_num]) ?? []),
    [lawData],
  );
  const visibleLawNums = useMemo(
    () => [selectedLaws.left, selectedLaws.right].filter((value): value is string => Boolean(value)),
    [selectedLaws.left, selectedLaws.right],
  );
  const hasVisibleLawContext = articleIndexByPane.left.length > 0 || articleIndexByPane.right.length > 0 || Boolean(selectedReferenceDetail);

  const loadThreads = useCallback(async (preferredThreadId?: string | null) => {
    if (!session || !supabase) {
      setThreads([]);
      setActiveThreadId(null);
      return;
    }
    setIsLoadingThreads(true);
    const { data, error: threadError } = await supabase
      .from('chat_threads')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false });
    setIsLoadingThreads(false);
    if (threadError) {
      setError(threadError.message);
      return;
    }
    const nextThreads = Array.isArray(data)
      ? data.map((row) => parseThread(row as Record<string, unknown>)).filter((row) => row.id)
      : [];
    setThreads(nextThreads);
    if (preferredThreadId) {
      setActiveThreadId(preferredThreadId);
      return;
    }
    setActiveThreadId((current) => (
      current && nextThreads.some((thread) => thread.id === current) ? current : (nextThreads[0]?.id ?? null)
    ));
  }, [session]);

  const loadMessages = useCallback(async (threadId: string | null) => {
    if (!threadId || !supabase) {
      setMessages([]);
      setRunsById(new Map());
      return;
    }
    setIsLoadingMessages(true);
    const messagePromise = supabase
      .from('chat_messages')
      .select('id, thread_id, role, content, created_at, citations_json, source_snapshot_json, model, usage_json, error_text, agent_run_id')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    const runPromise = agentEnabled
      ? supabase
          .from('agent_runs')
          .select('id, thread_id, status, summary_json, error_text, created_at, completed_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null });
    const [messageResult, runResult] = await Promise.all([messagePromise, runPromise]);
    setIsLoadingMessages(false);
    if (messageResult.error) {
      setError(messageResult.error.message);
      return;
    }
    setMessages(Array.isArray(messageResult.data)
      ? messageResult.data.map((row) => parseMessage(row as Record<string, unknown>))
      : []);
    if (!runResult.error && Array.isArray(runResult.data)) {
      setRunsById(new Map(runResult.data.map((row) => {
        const run = parseRun(row as Record<string, unknown>);
        return [run.id, run];
      })));
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setThreads([]);
      setMessages([]);
      setActiveThreadId(null);
      return;
    }
    void loadThreads();
  }, [loadThreads, session]);

  useEffect(() => {
    if (!session) return;
    void loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages, session]);

  const fetchExpandedSource = useCallback((source: ChatSource) => new Promise<ChatSource | null>((resolve) => {
    fetchRefData<RefWorkerResult>(
      { lawNum: source.lawNum, provision: source.provision, article: source.article, paragraph: null, item: null },
      (data) => resolve(data?.text ? { ...source, text: data.text } : null),
      () => resolve(null),
    );
  }), [fetchRefData]);

  const requestContext = useCallback((question: string) => {
    const visibleEntries = [...articleIndexByPane.left, ...articleIndexByPane.right];
    return {
      visibleSources: dedupeSources(buildVisibleSources(question, visibleEntries, 6)),
      pinnedReferenceSource: buildPinnedReferenceSource(selectedReferenceDetail),
    };
  }, [articleIndexByPane.left, articleIndexByPane.right, selectedReferenceDetail]);

  const buildAgentRequest = useCallback((question: string): AgentChatRequest => ({
    requestId: crypto.randomUUID(),
    threadId: activeThreadId,
    question,
    startContext: requestContext(question),
    recentMessages: messages.slice(-6).map((message) => ({ role: message.role, content: message.content })),
  }), [activeThreadId, messages, requestContext]);

  const buildGroundedRequest = useCallback(async (question: string): Promise<GroundedChatRequest | null> => {
    const { visibleSources, pinnedReferenceSource } = requestContext(question);
    const outgoingRefs = dedupeSources(visibleSources.flatMap((source) => source.references ?? []).map((ref) => ({
      sourceId: `${ref.lawNum}:${ref.provision}:${String(ref.article ?? '')}`,
      lawNum: ref.lawNum,
      lawTitle: lawTitleMap.get(ref.lawNum) ?? ref.lawNum,
      provision: ref.provision,
      article: String(ref.article ?? ''),
      text: '',
      origin: 'expanded' as const,
    }))).slice(0, 3);
    const expandedReferenceSources: ChatSource[] = [];
    for (const outgoingRef of outgoingRefs) {
      const resolved = await fetchExpandedSource(outgoingRef);
      if (resolved) expandedReferenceSources.push(resolved);
    }
    if (visibleSources.length === 0 && !pinnedReferenceSource) return null;
    return {
      threadId: activeThreadId,
      question,
      visibleSources,
      pinnedReferenceSource,
      expandedReferenceSources,
      suggestedLawCandidates: lawData ? buildSuggestedLawCandidates(question, lawData, visibleLawNums, 3) : [],
      recentMessages: messages.slice(-6).map((message) => ({ role: message.role, content: message.content })),
    };
  }, [activeThreadId, fetchExpandedSource, lawData, lawTitleMap, messages, requestContext, visibleLawNums]);

  const addProgress = useCallback((item: ProgressItem) => {
    setProgressItems((current) => [...current, item].slice(-12));
  }, []);

  const sendAgentRequest = useCallback(async (requestBody: AgentChatRequest): Promise<string> => {
    if (!session) throw new Error('ログイン後にAIチャットを利用できます。');
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
    if (!supabaseUrl || !anonKey) throw new Error('Supabaseの接続情報がありません。');
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await fetch(`${supabaseUrl}/functions/v1/law-agent-answer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || `巡回エージェントの開始に失敗しました (${response.status})`);
    }
    if (!response.body) throw new Error('巡回エージェントの進捗を受信できません。');
    let resultThreadId = requestBody.threadId;
    let streamError: string | null = null;
    await readAgentEventStream(response.body, (event: AgentProgressEvent) => {
      if (event.type === 'run_created') {
        setActiveRunId(event.runId);
        resultThreadId = event.threadId;
        setActiveThreadId(event.threadId);
      } else if (event.type === 'progress') {
        addProgress({ key: `step-${event.seq}`, message: event.message, kind: 'progress' });
      } else if (event.type === 'warning') {
        addProgress({ key: `warning-${Date.now()}`, message: event.message, kind: 'warning' });
      } else if (event.type === 'completed') {
        resultThreadId = event.threadId;
        setRunsById((current) => new Map(current).set(event.runId, {
          id: event.runId,
          thread_id: event.threadId,
          status: event.status,
          summary_json: event.summary,
          error_text: null,
          created_at: '',
          completed_at: new Date().toISOString(),
        }));
      } else if (event.type === 'error') {
        streamError = event.message;
      }
    });
    if (streamError) throw new Error(streamError);
    if (!resultThreadId) throw new Error('会話スレッドを作成できませんでした。');
    return resultThreadId;
  }, [addProgress, session]);

  const handleSend = async () => {
    if (!session || !supabase) {
      setError('ログイン後にAIチャットを利用できます。');
      return;
    }
    const question = draft.trim();
    if (!question) return;
    if (!agentEnabled && !hasVisibleLawContext) {
      setError('AIチャットを使う前に法令または参照条文を表示してください。');
      return;
    }
    setIsSending(true);
    setError(null);
    setLastSearchKeywords([]);
    setProgressItems([]);
    setActiveRunId(null);
    setDraft('');
    const optimisticMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      thread_id: activeThreadId ?? 'pending',
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    try {
      if (agentEnabled) {
        const threadId = await sendAgentRequest(buildAgentRequest(question));
        await loadThreads(threadId);
        await loadMessages(threadId);
        setActiveThreadId(threadId);
      } else {
        const request = await buildGroundedRequest(question);
        if (!request) throw new Error('質問に使える条文コンテキストが見つかりませんでした。');
        const { data, error: invokeError } = await supabase.functions.invoke<GroundedChatResponse>('law-chat-answer', { body: request });
        if (invokeError || !data) throw new Error(invokeError?.message ?? 'AI回答の生成に失敗しました。');
        await loadThreads(data.threadId);
        await loadMessages(data.threadId);
        setActiveThreadId(data.threadId);
        setLastSearchKeywords(data.searchKeywords ?? []);
      }
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === 'AbortError') {
        setError('調査を停止しました。');
      } else {
        setError(sendError instanceof Error ? sendError.message : 'AI回答の生成に失敗しました。');
        setDraft(question);
      }
      await loadMessages(activeThreadId);
    } finally {
      abortRef.current = null;
      setActiveRunId(null);
      setIsSending(false);
    }
  };

  const handleStop = async () => {
    if (activeRunId && supabase) {
      await supabase.from('agent_runs').update({ status: 'cancel_requested' }).eq('id', activeRunId);
    }
    abortRef.current?.abort();
  };

  if (!isConfigured) return <div className="chat-empty">Supabase Auth が未設定のため、AIチャットは利用できません。</div>;
  if (!session) return <div className="chat-empty">招待済みアカウントでログインすると、会話履歴付きAIチャットを利用できます。</div>;

  return (
    <div className="chat-panel">
      <aside className="chat-thread-list">
        <div className="chat-thread-header">
          <strong>会話履歴</strong>
          <button type="button" className="chat-secondary-button" disabled={isSending} onClick={() => {
            setActiveThreadId(null);
            setMessages([]);
            setRunsById(new Map());
            setError(null);
          }}>
            新規
          </button>
        </div>
        {isLoadingThreads ? <div className="chat-empty">読み込み中...</div> : null}
        {threads.map((thread) => (
          <button
            type="button"
            key={thread.id}
            className={`chat-thread-item${thread.id === activeThreadId ? ' active' : ''}`}
            disabled={isSending}
            onClick={() => setActiveThreadId(thread.id)}
          >
            <span className="chat-thread-title">{thread.title || '無題のスレッド'}</span>
            <span className="chat-thread-date">{new Date(thread.updated_at).toLocaleString('ja-JP')}</span>
          </button>
        ))}
        {!isLoadingThreads && threads.length === 0 ? <div className="chat-empty">まだ会話履歴はありません。</div> : null}
      </aside>

      <section className="chat-main">
        <div className="chat-context-summary">
          {agentEnabled ? (
            <span>表示中の条文またはキーワード検索を起点に、現行法令の参照先・被参照元を最大2段調査します。</span>
          ) : (
            <span>質問からキーワードを抽出し、e-Gov 法令APIの検索結果と表示中の法令を根拠候補として使用します。</span>
          )}
          {selectedReferenceDetail ? <span>開いている参照条文を優先起点にします。</span> : null}
          {lastSearchKeywords.length > 0 ? <span>検索キーワード: {lastSearchKeywords.join(' / ')}</span> : null}
        </div>

        {isSending && agentEnabled ? (
          <div className="chat-agent-progress" role="status" aria-live="polite">
            <strong>法令を巡回しています</strong>
            <ol>
              {progressItems.map((item) => <li key={item.key} className={item.kind}>{item.message}</li>)}
            </ol>
          </div>
        ) : null}

        <div className="chat-messages">
          {isLoadingMessages ? <div className="chat-empty">メッセージを読み込み中...</div> : null}
          {!isLoadingMessages && messages.length === 0 ? <div className="chat-empty">質問すると、このスレッドに回答と調査経路が保存されます。</div> : null}
          {messages.map((message) => {
            const run = message.agent_run_id ? runsById.get(message.agent_run_id) : null;
            const summary = run?.summary_json;
            return (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-message-role">{message.role === 'assistant' ? 'AI' : 'You'}</div>
                <div className="chat-message-body">{message.content}</div>
                {message.role === 'assistant' && message.citations_json?.length ? (
                  <div className="chat-citations">
                    {message.citations_json.map((citation) => (
                      <button
                        type="button"
                        key={`${message.id}-${citation.sourceId}`}
                        className="chat-citation"
                        onClick={() => onOpenCitation(citation)}
                      >
                        {citationLabel(citation)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.role === 'assistant' && summary ? (
                  <details className="chat-agent-summary">
                    <summary>
                      調査経路: {summary.visitedLawCount}法令・{summary.retrievedArticleCount}条文・深度{summary.traversalDepth}
                      {summary.partial ? '（部分回答）' : ''}
                    </summary>
                    {pathLabel(summary).map((label, index) => <div key={`${message.id}-path-${index}`}>{label}</div>)}
                    {summary.warnings.map((warning, index) => <div className="warning" key={`${message.id}-warning-${index}`}>{warning}</div>)}
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        {error ? <div className="chat-error">{error}</div> : null}

        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={agentEnabled ? '法令について質問してください（法令未表示でも調査できます）' : '質問を入力してください（関連法令も自動で検索します）'}
            className="chat-textarea"
            rows={4}
            disabled={isSending}
          />
          <div className="chat-actions">
            {isSending && agentEnabled ? (
              <button type="button" className="chat-secondary-button" onClick={() => { void handleStop(); }}>停止</button>
            ) : (
              <button
                type="button"
                className="chat-primary-button"
                disabled={!agentEnabled && !hasVisibleLawContext}
                onClick={() => { void handleSend(); }}
              >
                質問する
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
