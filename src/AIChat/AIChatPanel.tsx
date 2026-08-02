import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../AuthContext';
import { buildPinnedReferenceSource, buildSuggestedLawCandidates, buildVisibleSources, dedupeSources } from '../ai/context';
import type { ChatCitation, ChatMessage, ChatSource, ChatThread, GroundedChatRequest, GroundedChatResponse } from '../ai/types';
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
  };
}

function citationLabel(citation: ChatCitation): string {
  const provision = citation.provision === 'SupplProvision'
    ? '附則'
    : (citation.provision === 'MainProvision' ? '' : `（${citation.provision}）`);
  const article = citation.article ? `第${citation.article.replaceAll('_', '条の')}条` : '';
  return `${citation.lawTitle} ${provision}${article}`.trim();
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
  const [draft, setDraft] = useState('');
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchKeywords, setLastSearchKeywords] = useState<string[]>([]);

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
    setActiveThreadId((current) => {
      if (current && nextThreads.some((thread) => thread.id === current)) {
        return current;
      }
      return nextThreads[0]?.id ?? null;
    });
  }, [session]);

  const loadMessages = useCallback(async (threadId: string | null) => {
    if (!threadId || !supabase) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    const { data, error: messageError } = await supabase
      .from('chat_messages')
      .select('id, thread_id, role, content, created_at, citations_json, source_snapshot_json, model, usage_json, error_text')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    setIsLoadingMessages(false);
    if (messageError) {
      setError(messageError.message);
      return;
    }
    const nextMessages = Array.isArray(data)
      ? data.map((row) => parseMessage(row as Record<string, unknown>))
      : [];
    setMessages(nextMessages);
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
      {
        lawNum: source.lawNum,
        provision: source.provision,
        article: source.article,
        paragraph: null,
        item: null,
      },
      (data) => {
        if (!data?.text) {
          resolve(null);
          return;
        }
        resolve({
          ...source,
          text: data.text,
        });
      },
      () => resolve(null),
    );
  }), [fetchRefData]);

  const buildRequest = useCallback(async (question: string): Promise<GroundedChatRequest | null> => {
    const visibleEntries = [...articleIndexByPane.left, ...articleIndexByPane.right];
    const visibleSources = dedupeSources(buildVisibleSources(question, visibleEntries, 6));
    const pinnedReferenceSource = buildPinnedReferenceSource(selectedReferenceDetail);
    const outgoingRefs = dedupeSources(
      visibleSources.flatMap((source) => (
        source.references ?? []
      )).map((ref) => ({
        sourceId: `${ref.lawNum}:${ref.provision}:${String(ref.article ?? '')}`,
        lawNum: ref.lawNum,
        lawTitle: lawTitleMap.get(ref.lawNum) ?? ref.lawNum,
        provision: ref.provision,
        article: String(ref.article ?? ''),
        text: '',
        origin: 'expanded' as const,
      })),
    ).slice(0, 3);

    const expandedReferenceSources: ChatSource[] = [];
    for (const outgoingRef of outgoingRefs) {
      const resolved = await fetchExpandedSource(outgoingRef);
      if (resolved) {
        expandedReferenceSources.push(resolved);
      }
    }

    if (visibleSources.length === 0 && !pinnedReferenceSource) {
      return null;
    }

    return {
      threadId: activeThreadId,
      question,
      visibleSources,
      pinnedReferenceSource,
      expandedReferenceSources,
      suggestedLawCandidates: lawData
        ? buildSuggestedLawCandidates(question, lawData, visibleLawNums, 3)
        : [],
      recentMessages: messages.slice(-6).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
  }, [activeThreadId, articleIndexByPane.left, articleIndexByPane.right, fetchExpandedSource, lawData, lawTitleMap, messages, selectedReferenceDetail, visibleLawNums]);

  const handleSend = async () => {
    if (!session || !supabase) {
      setError('ログイン後にAIチャットを利用できます。');
      return;
    }
    const question = draft.trim();
    if (!question) {
      return;
    }
    if (!hasVisibleLawContext) {
      setError('AIチャットを使う前に法令または参照条文を表示してください。');
      return;
    }

    setIsSending(true);
    setError(null);
    setLastSearchKeywords([]);
    setDraft('');

    const request = await buildRequest(question);
    if (!request) {
      setIsSending(false);
      setError('質問に使える条文コンテキストが見つかりませんでした。');
      setDraft(question);
      return;
    }

    const optimisticMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      thread_id: activeThreadId ?? 'pending',
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    const { data, error: invokeError } = await supabase.functions.invoke<GroundedChatResponse>('law-chat-answer', {
      body: request,
    });

    if (invokeError || !data) {
      setIsSending(false);
      setError(invokeError?.message ?? 'AI回答の生成に失敗しました。');
      setDraft(question);
      void loadMessages(activeThreadId);
      return;
    }

    await loadThreads(data.threadId);
    await loadMessages(data.threadId);
    setActiveThreadId(data.threadId);
    setLastSearchKeywords(data.searchKeywords ?? []);
    setIsSending(false);
  };

  if (!isConfigured) {
    return <div className="chat-empty">Supabase Auth が未設定のため、AIチャットは利用できません。</div>;
  }

  if (!session) {
    return <div className="chat-empty">招待済みアカウントでログインすると、会話履歴付きAIチャットを利用できます。</div>;
  }

  return (
    <div className="chat-panel">
      <aside className="chat-thread-list">
        <div className="chat-thread-header">
          <strong>会話履歴</strong>
          <button type="button" className="chat-secondary-button" onClick={() => {
            setActiveThreadId(null);
            setMessages([]);
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
            onClick={() => setActiveThreadId(thread.id)}
          >
            <span className="chat-thread-title">{thread.title || '無題のスレッド'}</span>
            <span className="chat-thread-date">{new Date(thread.updated_at).toLocaleString('ja-JP')}</span>
          </button>
        ))}
        {!isLoadingThreads && threads.length === 0 ? (
          <div className="chat-empty">まだ会話履歴はありません。</div>
        ) : null}
      </aside>

      <section className="chat-main">
        <div className="chat-context-summary">
          <span>質問からキーワードを抽出し、e-Gov 法令APIの検索結果と表示中の法令を根拠候補として使用します。</span>
          {selectedReferenceDetail ? <span>開いている参照条文も優先して参照します。</span> : null}
          {isSending ? <span>関連法令を検索して回答を作成しています...</span> : null}
          {lastSearchKeywords.length > 0 ? (
            <span>検索キーワード: {lastSearchKeywords.join(' / ')}</span>
          ) : null}
        </div>

        <div className="chat-messages">
          {isLoadingMessages ? <div className="chat-empty">メッセージを読み込み中...</div> : null}
          {!isLoadingMessages && messages.length === 0 ? (
            <div className="chat-empty">質問すると、このスレッドに回答履歴が保存されます。</div>
          ) : null}
          {messages.map((message) => (
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
            </div>
          ))}
        </div>

        {error ? <div className="chat-error">{error}</div> : null}

        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="質問を入力してください（関連法令も自動で検索します）"
            className="chat-textarea"
            rows={4}
          />
          <div className="chat-actions">
            <button
              type="button"
              className="chat-primary-button"
              disabled={isSending || !hasVisibleLawContext}
              onClick={() => { void handleSend(); }}
            >
              {isSending ? '送信中...' : '質問する'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
