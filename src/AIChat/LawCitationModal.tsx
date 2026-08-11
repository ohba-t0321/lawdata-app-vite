import { useEffect, useMemo, useState } from 'react';
import type { ChatCitation } from '../ai/types';
import { renderVNodes, type VNode } from '../LawDataContext';
import { useLawDataWorker } from '../hooks/useLawDataWorker';

interface LawCitationModalProps {
  citation: ChatCitation | null;
  onClose: () => void;
}

interface RefWorkerResult {
  vnode: VNode[] | null;
  text: string;
}

function articleLabel(citation: ChatCitation): string {
  const provision = citation.provision === 'SupplProvision'
    ? '附則'
    : (citation.provision === 'MainProvision' ? '' : `附則（${citation.provision}）`);
  const article = citation.article ? `第${citation.article.replaceAll('_', '条の')}条` : '';
  const paragraph = citation.paragraph ? `第${citation.paragraph}項` : '';
  const item = citation.item ? `第${citation.item}号` : '';
  return `${citation.lawTitle} ${provision}${article}${paragraph}${item}`.trim();
}

export const LawCitationModal = ({ citation, onClose }: LawCitationModalProps) => {
  const { fetchRefData } = useLawDataWorker();
  const [article, setArticle] = useState<RefWorkerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const label = useMemo(() => citation ? articleLabel(citation) : '', [citation]);

  useEffect(() => {
    if (!citation) return;
    setArticle(null);
    setError(null);
    setIsLoading(true);
    fetchRefData<RefWorkerResult>(
      {
        lawNum: citation.lawNum,
        provision: citation.provision,
        article: citation.article,
        paragraph: citation.paragraph ?? null,
        item: citation.item ?? null,
      },
      (data) => {
        setArticle(data);
        setIsLoading(false);
        if (!data?.text) setError('該当する条文本文を取得できませんでした。');
      },
      () => {
        setError('e-Govから条文本文を取得できませんでした。時間をおいて再度お試しください。');
        setIsLoading(false);
      },
    );
  }, [citation, fetchRefData]);

  useEffect(() => {
    if (!citation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [citation, onClose]);

  if (!citation) return null;

  return (
    <div className="citation-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="citation-modal" role="dialog" aria-modal="true" aria-labelledby="citation-modal-title">
        <header className="citation-modal-header">
          <div>
            <span className="citation-modal-kicker">回答の根拠条文</span>
            <h3 id="citation-modal-title">{label}</h3>
            <p>{citation.lawNum}</p>
          </div>
          <button type="button" className="citation-modal-close" onClick={onClose} aria-label="根拠条文を閉じる">×</button>
        </header>

        <div className="citation-modal-meta">
          {citation.lawRevisionId ? <span>法令履歴ID: {citation.lawRevisionId}</span> : null}
          {citation.retrievedAt ? <span>確認日時: {new Date(citation.retrievedAt).toLocaleString('ja-JP')}</span> : null}
        </div>

        <div className="citation-modal-body">
          {isLoading ? <div className="citation-modal-status">条文本文を取得しています…</div> : null}
          {error ? <div className="citation-modal-status error">{error}</div> : null}
          {!isLoading && article?.vnode ? (
            <article className="citation-modal-article">{renderVNodes(article.vnode)}</article>
          ) : null}
          {!isLoading && article?.text && !article.vnode ? (
            <article className="citation-modal-article plain">{article.text}</article>
          ) : null}
        </div>

        <footer className="citation-modal-footer">
          <a
            href={`https://laws.e-gov.go.jp/law/${encodeURIComponent(citation.lawNum)}`}
            target="_blank"
            rel="noreferrer"
          >
            e-Govで法令全体を確認
          </a>
          <button type="button" onClick={onClose}>閉じる</button>
        </footer>
      </section>
    </div>
  );
};
