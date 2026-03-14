import React, { useState, useContext, useEffect, useMemo, useCallback } from 'react';
import './Reference.css';
import { LawDataContext, ReferenceContext, renderVNodes } from '../LawDataContext';
import type { VNode, RefArticle } from '../LawDataContext';
import { useLawDataWorker } from '../hooks/useLawDataWorker';
import { rankByLawTitleSimilarity } from '../utils/referenceSimilarity';

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
    const [refArticle, setRefArticle] = useState<VNode | VNode[] | string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [refLawNum, setRefLawNum] = useState<string>('');
    const [refArticleData, setRefArticleData] = useState<React.ReactNode>(null);

    const { lawData } = useContext(LawDataContext);
    const lawTitleMap = useMemo(
        () => new Map(lawData?.map((law) => [law.law_info.law_num, law.current_revision_info.law_title]) ?? []),
        [lawData],
    );
    const { clickedRefs, clickedRefSource, setClickedRefs, refArticleLoaded, setRefArticleLoaded } = useContext(ReferenceContext);
    const { fetchRefData } = useLawDataWorker();
    const sourceLawTitle = useMemo(
        () => (clickedRefSource?.lawNum ? (lawTitleMap.get(clickedRefSource.lawNum) ?? clickedRefSource.lawNum) : ''),
        [clickedRefSource, lawTitleMap],
    );

    const refLabel = useCallback((item: RefArticle) => {
        const title = lawTitleMap.get(item.lawNum) ?? item.lawNum;
        return `${title} ${formatRefLocation(item)}`.trim();
    }, [lawTitleMap]);

    const rankedRefs = useMemo(() => {
        const uniqueRefs = clickedRefs.reduce<Array<{ item: RefArticle; originalIndex: number }>>((items, item, index) => {
            const key = `${item.lawNum}-${item.provision}-${item.article ?? ''}-${item.paragraph ?? ''}-${item.item ?? ''}`;
            if (items.some((entry) => (
                `${entry.item.lawNum}-${entry.item.provision}-${entry.item.article ?? ''}-${entry.item.paragraph ?? ''}-${entry.item.item ?? ''}`
                === key
            ))) {
                return items;
            }
            items.push({ item, originalIndex: index });
            return items;
        }, []);

        const ranked = rankByLawTitleSimilarity(
            sourceLawTitle,
            uniqueRefs,
            ({ item }) => lawTitleMap.get(item.lawNum) ?? item.lawNum,
        );

        return ranked
            .sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                return a.item.originalIndex - b.item.originalIndex;
            })
            .map(({ item }) => item.item);
    }, [clickedRefs, lawTitleMap, sourceLawTitle]);

    const lenRef = rankedRefs.length;
    const refItm = itemIndex === null ? null : (rankedRefs[itemIndex] ?? null);
    const showListView = lenRef > 1 && itemIndex === null;
    const showDetailView = itemIndex !== null;

    const loadRefData = useCallback((target: RefArticle) => {
        fetchRefData<VNode | VNode[] | string | null>(
            target,
            (data) => {
                setRefArticle(data);
            },
            (error) => {
                setRefArticle(error || '参照条文の取得に失敗しました。');
            },
        );
    }, [fetchRefData]);

    useEffect(() => {
        setIsOpen(rankedRefs.length > 0);
        setItemIndex(rankedRefs.length === 1 ? 0 : null);
        setRefArticle(null);
        setRefArticleData(null);
        setRefLawNum('');
        setRefArticleLoaded(false);
    }, [clickedRefs, rankedRefs.length, setRefArticleLoaded]);

    useEffect(() => {
        setRefArticleLoaded(false);
        setRefArticle(null);
        setRefArticleData(null);
        if (!refItm?.lawNum) {
            setRefLawNum('');
            return;
        }
        loadRefData(refItm);
    }, [loadRefData, refItm, setRefArticleLoaded]);

    useEffect(() => {
        if (!refItm?.lawNum) {
            setRefLawNum('');
            setRefArticleData(null);
            setRefArticleLoaded(false);
            return;
        }
        if (refArticle === null) {
            return;
        }
        if (typeof refArticle === 'string') {
            setRefArticleData(refArticle);
        } else if (refArticle) {
            setRefArticleData(renderVNodes(refArticle));
        } else {
            setRefArticleData(null);
        }
        setRefLawNum(lawTitleMap.get(refItm.lawNum) ?? refItm.lawNum);
        setRefArticleLoaded(true);
    }, [lawTitleMap, refArticle, refItm, setRefArticleLoaded]);

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
                    }}
                >
                    閉じる
                </button>
            </div>
            {showListView && (
                <div className="ref-list-wrap">
                    <div className="ref-list-title">参照先一覧（類似度順）</div>
                    {sourceLawTitle && (
                        <div className="ref-list-description">
                            {sourceLawTitle} に近い法令から表示しています。
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
                                    {refLabel(item)}
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
