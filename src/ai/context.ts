import type { ArticleIndexEntry, LawData, ReferenceArticleDetail } from '../LawDataContext';
import type { ChatSource, SuggestedLawCandidate } from './types';
import { rankByLawTitleSimilarity, rankByTextSimilarity } from '../utils/referenceSimilarity';

function sourceFromArticle(entry: ArticleIndexEntry, origin: ChatSource['origin']): ChatSource {
  return {
    sourceId: entry.sourceId,
    lawNum: entry.lawNum,
    lawTitle: entry.lawTitle,
    provision: entry.provision,
    article: entry.article,
    text: entry.text,
    origin,
    references: entry.references,
  };
}

export function buildVisibleSources(question: string, entries: ArticleIndexEntry[], limit = 6): ChatSource[] {
  const ranked = rankByTextSimilarity(question, entries, (entry) => `${entry.lawTitle} ${entry.text}`);
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => sourceFromArticle(item, 'visible'));
}

export function buildPinnedReferenceSource(detail: ReferenceArticleDetail | null): ChatSource | null {
  if (!detail) {
    return null;
  }
  const article = detail.target.article === null ? '' : String(detail.target.article);
  return {
    sourceId: `${detail.target.lawNum}:${detail.target.provision}:${article}`,
    lawNum: detail.target.lawNum,
    lawTitle: detail.lawTitle,
    provision: detail.target.provision,
    article,
    text: detail.text,
    origin: 'reference',
  };
}

export function dedupeSources(sources: ChatSource[]): ChatSource[] {
  const map = new Map<string, ChatSource>();
  sources.forEach((source) => {
    if (!map.has(source.sourceId)) {
      map.set(source.sourceId, source);
    }
  });
  return Array.from(map.values());
}

export function buildSuggestedLawCandidates(
  question: string,
  lawData: LawData[],
  visibleLawNums: string[],
  limit = 3,
): SuggestedLawCandidate[] {
  const visible = new Set(visibleLawNums);
  return rankByLawTitleSimilarity(question, lawData, (law) => law.current_revision_info.law_title ?? law.law_info.law_num)
    .sort((a, b) => b.score - a.score)
    .filter(({ item, score }) => !visible.has(item.law_info.law_num) && score > 0)
    .slice(0, limit)
    .map(({ item, score }) => ({
      lawNum: item.law_info.law_num,
      lawTitle: item.current_revision_info.law_title ?? item.law_info.law_num,
      score,
    }));
}
