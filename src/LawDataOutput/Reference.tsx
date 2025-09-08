import React,{useState, useContext, useEffect} from 'react';
import './Reference.css';
import { LawDataContext, LawArticleContext ,ReferenceContext } from '../LawDataContext';
import type { LawArticle,LawNode } from '../LawDataContext';
import { isSameDateInJapan } from '../LawDataContext';
import { getLawFromCache, saveLawToCache } from '../indexedDB'
import type { LawDataCache } from '../indexedDB';
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

function searchArticle(json : any): any[] {
    const articleList:any[] = [];
    json.children.forEach((item:any) => {
        if (item?.tag === 'Article') {
            articleList.push(item);
        } else if (typeof(item) === 'object' && item.children) {
            let subItem = searchArticle(item);
            if (subItem) {
                subItem.forEach(sub => {
                    articleList.push(sub);
                });
            }
        }
    });
    return articleList;
};

export const Reference:React.FC = () => {
    const [itemIndex,setItemIndex] = useState(0);
    const [refArticle,setRefArticle] = useState<LawArticle>({law_info:null,revision_info:null,law_full_text:null,attached_files_info:null});
    const [isOpen,setIsOpen] = useState(false);
    const [refItm,setRefItm] = useState<any>(null);
    const [refLawNum,setRefLawNum] = useState<string>('');  
    const [ refArticleData,setRefArticleData ] = useState<any>(null);
    const { lawData } = useContext(LawDataContext);
    const { getChildren } = useContext(LawArticleContext);
    const { clickedRefs,setClickedRefs,refArticleLoaded,setRefArticleLoaded } = useContext(ReferenceContext);

    const lenRef:number = clickedRefs.length;

    const fetchRefData = async (lawId:string)=>{
        try {
            let cached = await getLawFromCache(lawId);
            const now = Date.now();
            if (cached&&isSameDateInJapan(now, (cached as LawDataCache).timestamp)) {
                setRefArticle((cached as LawDataCache).lawArticle)
            } else {
                fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`)
                .then(res => res.json())
                .then(data => {
                    setRefArticle(data)
                    saveLawToCache(lawId,data)
                })
                .catch(err => console.error("法令データ取得エラー:", err));
            }
        } catch (err) {
            if (err instanceof Error) {
                console.log(`キャッシュからの法令データ取得エラー：${err.message}`);
            } else {
                console.log('キャッシュからの法令データ取得エラー：', err);
            }
        }
    }

    useEffect(()=>{
        setIsOpen(lenRef>0?true:false);
        setItemIndex(0);
    },[clickedRefs])

    useEffect(()=>{
        setRefArticleLoaded(false);
        setRefArticleData(null);
        setRefItm(clickedRefs[itemIndex]);
    },[clickedRefs,itemIndex])

    useEffect(()=>{
        if (refItm?.lawNum) {
            fetchRefData(refItm.lawNum);
        }
    },[refItm])

    useEffect(()=>{
        if (refArticle?.law_full_text) {
            // 法令データが取得できていれば、該当条文を表示
            let lawBody = (refArticle?.law_full_text as LawNode).children?.filter(child=>(typeof(child)==='object')&&(child?.tag==='LawBody'))[0]
            if (typeof(lawBody)==='object' && lawBody?.children){
                let refLawData = lawBody.children.filter(child=>typeof(child)==='object'&&child?.tag===refItm?.provision&&child?.attr?.AmendLawNum===undefined)[0]
                if (refLawData){
                    let refArticleNode = searchArticle(refLawData).filter(e=>e.attr.Num===refItm?.article)[0];
                    if (refArticleNode){
                        setRefArticleData(getChildren("ref",refArticleNode,refItm?.provision,refItm?.article,null,null,null));
                    } else {
                        setRefArticleData(<span>該当する条文が見つかりません。</span>);
                    }
                }
            }
        }
        setRefLawNum(lawData? lawData.filter(law=>law.law_info.law_num===refItm?.lawNum)[0]?.current_revision_info.law_title : refItm?.lawNum)
        setRefArticleLoaded(true);
    },[refArticle])

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

