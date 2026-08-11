import { useState } from 'react';
import type { ChatCitation } from '../ai/types';
import { AIChatPanel } from './AIChatPanel';
import { LawCitationModal } from './LawCitationModal';
import './FullChatPage.css';

export const FullChatPage = () => {
  const [activeCitation, setActiveCitation] = useState<ChatCitation | null>(null);

  return (
    <main className="full-chat-page">
      <div className="full-chat-intro">
        <div>
          <span className="full-chat-eyebrow">LAW RESEARCH ASSISTANT</span>
          <h2>法令について、会話から調べる</h2>
        </div>
        <p>
          質問に応じて法令名と条文を検索し、e-Govの本文で確認できた根拠だけを回答に添えます。
        </p>
      </div>

      <div className="full-chat-workspace">
        <AIChatPanel variant="full" onOpenCitation={setActiveCitation} />
      </div>

      <LawCitationModal citation={activeCitation} onClose={() => setActiveCitation(null)} />
    </main>
  );
};
