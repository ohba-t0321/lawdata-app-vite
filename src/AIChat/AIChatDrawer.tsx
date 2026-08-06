import { useContext } from 'react';
import './AIChatDrawer.css';
import { ReferenceContext, type RefArticle } from '../LawDataContext';
import type { ChatCitation } from '../ai/types';
import { AIChatPanel } from './AIChatPanel';

interface AIChatDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function citationToRefArticle(citation: ChatCitation): RefArticle {
  return {
    lawNum: citation.lawNum,
    provision: citation.provision,
    article: citation.article,
    paragraph: null,
    item: null,
  };
}

export const AIChatDrawer = ({ isOpen, onToggle, onClose }: AIChatDrawerProps) => {
  const { setClickedRefs, setRefArticleLoaded } = useContext(ReferenceContext);

  return (
    <>
      <button
        type="button"
        className={`ai-chat-toggle${isOpen ? ' open' : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="ai-chat-drawer"
      >
        AIチャット
      </button>

      <aside
        className={`ai-chat-drawer${isOpen ? ' open' : ''}`}
        id="ai-chat-drawer"
        aria-hidden={!isOpen}
      >
        <div className="ai-chat-drawer-header">
          <div className="ai-chat-drawer-heading">
            <span className="ai-chat-drawer-title">AIチャット</span>
            <span className="ai-chat-drawer-description">法令の参照先・被参照元を巡回し、確認した条文を根拠に回答します。</span>
          </div>
          <button
            type="button"
            className="ai-chat-drawer-close"
            onClick={onClose}
            aria-label="AIチャットを閉じる"
          >
            閉じる
          </button>
        </div>

        <div className="ai-chat-drawer-body">
          <AIChatPanel
            onOpenCitation={(citation) => {
              setClickedRefs([citationToRefArticle(citation)]);
              setRefArticleLoaded(false);
            }}
          />
        </div>
      </aside>
    </>
  );
};
