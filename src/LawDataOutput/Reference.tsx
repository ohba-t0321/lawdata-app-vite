import React,{useState, useContext, useEffect, useMemo, useCallback} from 'react';
import './Reference.css';
import { LawDataContext, ReferenceContext, renderVNodes } from '../LawDataContext';
import type { VNode, RefArticle } from '../LawDataContext';
import { useLawDataWorker } from '../hooks/useLawDataWorker';
function convertToArticleFormat(input: string): string {
    // アンダースコアで分割して配列にする
    if (input){
        const parts = input.split('_');
        // 最初の部分を「第◯条」に変換
        let result = `第${parts[0]}条`;
        // 残りの部分があれば「の◯」を追加
        for (let i = 1; i < parts.length; i++) {
            result += `の${parts[i]}`;
        }
        return result;
    } else {
        return '';
    }
}

export const Reference:React.FC = () => {
    const [itemIndex,setItemIndex] = useState(0);
    const [refArticle,setRefArticle] = useState<VNode | VNode[] | string | null>(null);
    const [isOpen,setIsOpen] = useState(false);
    const [refItm,setRefItm] = useState<RefArticle | null>(null);
    const [refLawNum,setRefLawNum] = useState<string>('');  
    const [refArticleData,setRefArticleData] = useState<React.ReactNode>(null);
    const { lawData } = useContext(LawDataContext);
    const lawTitleMap = useMemo(
        () => new Map(lawData?.map((law) => [law.law_info.law_num, law.current_revision_info.law_title]) ?? []),
        [lawData],
    );
    const { clickedRefs,setClickedRefs,refArticleLoaded,setRefArticleLoaded } = useContext(ReferenceContext);
    const { fetchRefData } = useLawDataWorker();
    const lenRef:number = clickedRefs.length;

    const RefDataLoad = useCallback(async (refItm: RefArticle)=>{
        try {
            fetchRefData<VNode | VNode[] | string | null>(refItm, (data) => {
                setRefArticle(data);
            });
        } catch (err) {
            if (err instanceof Error) {
                console.log(`キャッシュからの法令データ取得エラー：${err.message}`);
            } else {
                console.log('キャッシュからの法令データ取得エラー：', err);
            }
        }
    }, [fetchRefData])

    useEffect(()=>{
        setIsOpen(lenRef>0?true:false);
        setItemIndex(0);
    },[lenRef])

    useEffect(()=>{
        setRefArticleLoaded(false);
        setRefArticleData(null);
        setRefItm(clickedRefs[itemIndex] ?? null);
    },[clickedRefs,itemIndex, setRefArticleLoaded])

    useEffect(()=>{
        if (refItm?.lawNum) {
            RefDataLoad(refItm);
        }
    },[RefDataLoad, refItm])

    useEffect(()=>{
        if (typeof refArticle === 'string') {
            setRefArticleData(refArticle);
        } else if (refArticle) {
            setRefArticleData(renderVNodes(refArticle));
        } else {
            setRefArticleData(null);
        }
        setRefLawNum(lawTitleMap.get(refItm?.lawNum) ?? refItm?.lawNum)
        setRefArticleLoaded(true);
    },[lawTitleMap, refArticle, refItm?.lawNum, setRefArticleLoaded])

    return (
        <div className={`reference${isOpen?' active':''}`}> 
            <button type="submit" 
                    className="btn-secondary btn-sm" 
                    id="closeButton" 
                    onClick={()=>{
                        setIsOpen(false);
                        setClickedRefs([]);
                        setItemIndex(0);
                        setRefArticleLoaded(false);
                    }}
            >
                閉じる
            </button>
            <span className="ref-buttons" style={{ display: (lenRef <= 1) ? 'none' : 'block' }}>
                <span className="ref-item-index">{`${itemIndex+1} / ${lenRef}`}</span>
                <button id="ref-previous" onClick={()=>{setRefArticleLoaded(false);setItemIndex(itemIndex<=0? lenRef-1 : itemIndex-1);}}>◀</button>
                <button id="ref-next" onClick={()=>{setRefArticleLoaded(false);setItemIndex((itemIndex>=lenRef-1)? 0 : itemIndex+1);}}>▶</button>
            </span>
            <div className="article-num" id="ref-article-num">
                {!refArticleLoaded&&'読み込み中...'}
                {refArticleLoaded&&(refLawNum + ' ' + (refItm?.provision==='SupplProvision'?'附則':(refItm?.provision==='MainProvision'?'':'（'+refItm?.provision+'）')) + (typeof(refItm?.article)==='string'?convertToArticleFormat(refItm?.article as string):''))}
            </div>
            <div className="law-content" id="ref-law-content">{refArticleLoaded&&refArticleData}</div> 
        </div>
    )
}

