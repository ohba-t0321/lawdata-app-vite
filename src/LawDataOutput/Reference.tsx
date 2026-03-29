import React, { useState, useContext, useEffect, useMemo, useCallback } from 'react';
import './Reference.css';
import { LawDataContext, ReferenceContext, renderVNodes } from '../LawDataContext';
import type { VNode, RefArticle } from '../LawDataContext';
import { useLawDataWorker } from '../hooks/useLawDataWorker';
import { rankByLawTitleSimilarity } from '../utils/referenceSimilarity';

interface RefArticleWorkerResult {
    vnode: VNode[] | null;
    text: string;
}

function refKey(item: Pick<RefArticle, 'lawNum' | 'provision' | 'article' | 'paragraph' | 'item'>): string {
    return `${item.lawNum}-${item.provision}-${item.article ?? ''}-${item.paragraph ?? ''}-${item.item ?? ''}`;
}

function comparableSimilarityScore(item: Pick<RefArticle, 'similarityScore'>): number {
    return typeof item.similarityScore === 'number' && Number.isFinite(item.similarityScore)
        ? item.similarityScore
        : -1;
}

function formatSimilarityScore(item: Pick<RefArticle, 'similarityScore'>): string | null {
    if (comparableSimilarityScore(item) < 0) {
        return null;
    }
    return `${Math.round(Math.max(0, Math.min(1, item.similarityScore ?? 0)) * 100)}%`;
}

function convertToArticleFormat(input: string): string {
    if (input) {
        const parts = input.split('_');
        let result = `第${parts[0]}条`;
        for (let i = 1; i < parts.length; i++) {
            result += `の${parts[i]}`;
        }
        return result;
    }
    return '';
}

function formatRefLocation(item: RefArticle | null): string {
    if (!item) {
        return '';
    }

    const provision = item.provision === 'SupplProvision'
        ? '附則'
        : (item.provision === 'MainProvision' ? '' : `（${item.provision}）`);
    const article = item.article !== null && item.article !== undefined
        ? convertToArticleFormat(String(item.article))
        : '';
    const paragraph = item.paragraph && item.paragraph !== '0' ? `第${item.paragraph}項` : '';
    const subItem = item.item && item.item !== '0' ? `第${item.item}号` : '';

    return `${provision}${article}${paragraph}${subItem}`;
}

export const Reference: React.FC = () => {
    const [itemIndex, setItemIndex] = useState<number | null>(null);
    const [refArticle, setRefArticle] = useState<RefArticleWorkerResult | null>(null);
    const [refArticleError, setRefArticleError] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [refLawNum, setRefLawNum] = useState<string>('');
    const [refArticleData, setRefArticleData] = useState<React.ReactNode>(null);

    const { lawData } = useContext(LawDataContext);
    const lawTitleMap = useMemo(
        () => new Map(lawData?.map((law) => [law.law_info.law_num, law.current_revision_info.law_title]) ?? []),
        [lawData],
    );
    const { clickedRefs, clickedRefSource, setClickedRefs, refArticleLoaded, setRefArticleLoaded, setSelectedReferenceDetail } = useContext(ReferenceContext);
    const { fetchRefData } = useLawDataWorker();
    const sourceLawTitle = useMemo(
        () => (clickedRefSource?.lawNum ? (lawTitleMap.get(clickedRefSource.lawNum) ?? clickedRefSource.lawNum) : ''),
        [clickedRefSource, lawTitleMap],
    );

    const refLabel = useCallback((item: RefArticle) => {
        const title = lawTitleMap.get(item.lawNum) ?? item.lawNum;
        return `${title} ${formatRefLocation(item)}`.trim();
    }, [lawTitleMap]);

    const rankedRefEntries = useMemo(() => {
        const uniqueRefMap = clickedRefs.reduce<Map<string, { item: RefArticle; originalIndex: number }>>((items, item, index) => {
            const key = refKey(item);
            const existing = items.get(key);
            if (!existing) {
                items.set(key, { item, originalIndex: index });
                return items;
            }

            const existingScore = comparableSimilarityScore(existing.item);
            const nextScore = comparableSimilarityScore(item);
            if (nextScore > existingScore) {
                items.set(key, { item, originalIndex: existing.originalIndex });
            }
            return items;
        }, new Map());
        const uniqueRefs = Array.from(uniqueRefMap.values());

        const titleRanked = rankByLawTitleSimilarity(
            sourceLawTitle,
            uniqueRefs,
            ({ item }) => lawTitleMap.get(item.lawNum) ?? item.lawNum,
        );
        const titleScoreByKey = new Map(
            titleRanked.map(({ item, score }) => [refKey(item.item), score]),
        );

        return uniqueRefs.sort((a, b) => {
            const similarityDiff = comparableSimilarityScore(b.item) - comparableSimilarityScore(a.item);
            if (similarityDiff !== 0) {
                return similarityDiff;
            }

            const titleScoreDiff = (titleScoreByKey.get(refKey(b.item)) ?? 0) - (titleScoreByKey.get(refKey(a.item)) ?? 0);
            if (titleScoreDiff !== 0) {
                return titleScoreDiff;
            }

            return a.originalIndex - b.originalIndex;
        });
    }, [clickedRefs, lawTitleMap, sourceLawTitle]);

    const rankedRefs = useMemo(
        () => rankedRefEntries.map((entry) => entry.item),
        [rankedRefEntries],
    );
    const hasSimilarityScores = useMemo(
        () => rankedRefs.some((item) => comparableSimilarityScore(item) >= 0),
        [rankedRefs],
    );

    const lenRef = rankedRefs.length;
    const refItm = itemIndex === null ? null : (rankedRefs[itemIndex] ?? null);
    const showListView = lenRef > 1 && itemIndex === null;
    const showDetailView = itemIndex !== null;

    const loadRefData = useCallback((target: RefArticle) => {
        fetchRefData<RefArticleWorkerResult>(
            target,
            (data) => {
                setRefArticleError(null);
                setRefArticle(data);
            },
            (error) => {
                setRefArticle(null);
                setRefArticleError(error || '参照条文の取得に失敗しました。');
            },
        );
    }, [fetchRefData]);

    useEffect(() => {
        setIsOpen(rankedRefs.length > 0);
        setItemIndex(rankedRefs.length === 1 ? 0 : null);
        setRefArticle(null);
        setRefArticleError(null);
        setRefArticleData(null);
        setRefLawNum('');
        setRefArticleLoaded(false);
        setSelectedReferenceDetail(null);
    }, [clickedRefs, rankedRefs.length, setRefArticleLoaded, setSelectedReferenceDetail]);

    useEffect(() => {
        setRefArticleLoaded(false);
        setRefArticle(null);
        setRefArticleError(null);
        setRefArticleData(null);
        setSelectedReferenceDetail(null);
        if (!refItm?.lawNum) {
            setRefLawNum('');
            return;
        }
        loadRefData(refItm);
    }, [loadRefData, refItm, setRefArticleLoaded, setSelectedReferenceDetail]);

    useEffect(() => {
        if (!refItm?.lawNum) {
            setRefLawNum('');
            setRefArticleData(null);
            setRefArticleLoaded(false);
            setSelectedReferenceDetail(null);
            return;
        }
        if (refArticle === null && refArticleError === null) {
            return;
        }
        if (refArticleError) {
            setRefArticleData(refArticleError);
            setSelectedReferenceDetail(null);
        } else if (refArticle?.vnode) {
            setRefArticleData(renderVNodes(refArticle.vnode));
            setSelectedReferenceDetail({
                target: refItm,
                lawTitle: lawTitleMap.get(refItm.lawNum) ?? refItm.lawNum,
                text: refArticle.text,
                vnode: refArticle.vnode,
            });
        } else {
            setRefArticleData('該当条文が見つかりませんでした');
            setSelectedReferenceDetail(null);
        }
        setRefLawNum(lawTitleMap.get(refItm.lawNum) ?? refItm.lawNum);
        setRefArticleLoaded(true);
    }, [lawTitleMap, refArticle, refArticleError, refItm, setRefArticleLoaded, setSelectedReferenceDetail]);

    return (
        <div className={`reference${isOpen ? ' active' : ''}`}>
            <div className="reference-header">
                <div className="reference-title">
                    {showListView ? '参照先一覧' : '参照条文'}
                </div>
                <button
                    type="button"
                    className="btn-secondary btn-sm"
                    id="closeButton"
                    onClick={() => {
                        setIsOpen(false);
                        setClickedRefs([]);
                        setItemIndex(null);
                        setRefArticleLoaded(false);
                        setSelectedReferenceDetail(null);
                    }}
                >
                    閉じる
                </button>
            </div>
            {showListView && (
                <div className="ref-list-wrap">
                    <div className="ref-list-title">
                        {hasSimilarityScores ? '参照先一覧（条文類似度順）' : '参照先一覧（法令名類似度順）'}
                    </div>
                    {(hasSimilarityScores || sourceLawTitle) && (
                        <div className="ref-list-description">
                            {hasSimilarityScores
                                ? '参照元条文に近い候補から表示しています。'
                                : `${sourceLawTitle} に近い法令から表示しています。`}
                        </div>
                    )}
                    <ul className="ref-list">
                        {rankedRefs.map((item, index) => (
                            <li key={`${item.lawNum}-${item.provision}-${item.article}-${item.paragraph}-${item.item}-${index}`}>
                                <button
                                    type="button"
                                    className="ref-list-button"
                                    onClick={() => {
                                        setRefArticleLoaded(false);
                                        setItemIndex(index);
                                    }}
                                >
                                    <span className="ref-list-label">{refLabel(item)}</span>
                                    {formatSimilarityScore(item) && (
                                        <span className="ref-list-score">{formatSimilarityScore(item)}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {showDetailView && lenRef > 1 && (
                <div className="ref-detail-toolbar">
                    <button
                        type="button"
                        className="ref-back-button"
                        onClick={() => {
                            setItemIndex(null);
                            setRefArticleLoaded(false);
                        }}
                    >
                        一覧に戻る
                    </button>
                    <span className="ref-item-index">
                        {itemIndex + 1} / {lenRef}
                    </span>
                </div>
            )}
            <div className="article-num" id="ref-article-num">
                {showListView && '参照先一覧から表示する条文を選択してください。'}
                {showDetailView && !refArticleLoaded && '読み込み中...'}
                {showDetailView && refArticleLoaded
                    && `${refLawNum} ${formatRefLocation(refItm)}`.trim()}
            </div>
            <div className="law-content" id="ref-law-content">
                {showDetailView && refArticleLoaded && refArticleData}
            </div>
        </div>
    );
};
