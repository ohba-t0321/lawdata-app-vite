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
  origin: 'visible' | 'reference' | 'expanded';
  references?: RefArticle[];
}

export interface ChatCitation {
  sourceId: string;
  lawNum: string;
  lawTitle: string;
  provision: string;
  article: string;
  reason?: string;
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
}

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
  source_snapshot_json?: GroundedChatRequest | null;
  model?: string | null;
  usage_json?: Record<string, number | null> | null;
  error_text?: string | null;
}
