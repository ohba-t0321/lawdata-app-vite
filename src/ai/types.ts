import type { RefArticle } from '../LawDataContext';

export type UserRole = 'admin' | 'pro';

export interface AuthProfile {
  id: string;
  email: string;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface ChatSource {
  sourceId: string;
  lawNum: string;
  lawTitle: string;
  provision: string;
  article: string;
  text: string;
  origin: 'visible' | 'reference' | 'expanded' | 'keyword';
  references?: RefArticle[];
}

export interface ChatCitation {
  sourceId: string;
  lawNum: string;
  lawTitle: string;
  provision: string;
  article: string;
  reason?: string;
  paragraph?: string;
  item?: string;
  lawRevisionId?: string;
  retrievedAt?: string;
  direction?: 'seed' | 'outgoing' | 'incoming' | 'keyword';
  path?: AgentPathStep[];
}

export interface AgentPathStep {
  lawNum: string;
  lawTitle: string;
  provision: string;
  article: string;
  direction: 'seed' | 'outgoing' | 'incoming' | 'keyword';
}

export interface SuggestedLawCandidate {
  lawNum: string;
  lawTitle: string;
  score: number;
}

export interface SuggestedLaw {
  lawNum: string;
  lawTitle: string;
  reason?: string;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GroundedChatRequest {
  threadId: string | null;
  question: string;
  visibleSources: ChatSource[];
  pinnedReferenceSource: ChatSource | null;
  expandedReferenceSources: ChatSource[];
  suggestedLawCandidates: SuggestedLawCandidate[];
  recentMessages: ChatHistoryMessage[];
}

export interface GroundedChatResponse {
  threadId: string;
  assistantMessage: string;
  citations: ChatCitation[];
  suggestedLaws: SuggestedLaw[];
  insufficientContext: boolean;
  model: string;
  usage: Record<string, number | null> | null;
  searchKeywords: string[];
  searchedSources: ChatSource[];
}

export interface AgentStartContext {
  visibleSources: ChatSource[];
  pinnedReferenceSource: ChatSource | null;
}

export interface AgentChatRequest {
  requestId: string;
  threadId: string | null;
  question: string;
  startContext: AgentStartContext;
  recentMessages: ChatHistoryMessage[];
}

export interface AgentRunSummary {
  visitedLawCount: number;
  retrievedArticleCount: number;
  traversalDepth: number;
  toolCallCount: number;
  durationMs: number;
  partial: boolean;
  paths: AgentPathStep[][];
  warnings: string[];
}

export interface AgentRun {
  id: string;
  thread_id: string;
  status: 'queued' | 'running' | 'cancel_requested' | 'completed' | 'partial' | 'failed' | 'cancelled';
  summary_json: AgentRunSummary | null;
  error_text: string | null;
  created_at: string;
  completed_at: string | null;
}

export type AgentProgressEvent =
  | { type: 'run_created'; runId: string; threadId: string }
  | { type: 'progress'; seq: number; phase: string; message: string; lawNum?: string; article?: string }
  | { type: 'source'; source: ChatSource; direction: 'seed' | 'outgoing' | 'incoming' | 'keyword' }
  | { type: 'warning'; message: string }
  | {
      type: 'completed';
      threadId: string;
      runId: string;
      status: 'completed' | 'partial';
      assistantMessage: string;
      citations: ChatCitation[];
      insufficientContext: boolean;
      model: string;
      usage: Record<string, number | null> | null;
      summary: AgentRunSummary;
    }
  | { type: 'error'; runId?: string; message: string; retryable: boolean };

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  citations_json?: ChatCitation[] | null;
  source_snapshot_json?: GroundedChatRequest | AgentStartContext | null;
  model?: string | null;
  usage_json?: Record<string, number | null> | null;
  error_text?: string | null;
  agent_run_id?: string | null;
}
