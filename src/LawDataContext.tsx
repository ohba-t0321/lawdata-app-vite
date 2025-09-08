import React, { createContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { saveLawToCache, getLawFromCache, saveLawListToCache, getLawListFromCache } from './indexedDB'
import type { LawListCache,LawDataCache } from "./indexedDB";
export interface LawData {
  law_info: any;
  revision_info: any;
  current_revision_info: any;
}

interface LawDataContextType {
  lawData: LawData[] | null;
  isDataLoaded: boolean;
  fetchLawData: () => Promise<void>;
}

export interface LawArticle {
  law_info:Object | null;
  revision_info:Object | null;
  law_full_text:Object | null;
  attached_files_info:Object | null;
}
export interface RefData {
  match:string | null;
  ref:RefDatadetail | null;
  referred:RefDatadetail | null;
}
interface RefDatadetail {
  lawNum: string;
  lawArticle: {
    provision: string;
    article: string;
    paragraph: string;
    item: string;
  };
  text: string;
}
export interface LawNode {
  tag: string;
  attr?: { [key: string]: string | number };
  children?: (LawNode | string)[];
}

interface LawArticleContextType {
  selectedLaws: {left: string | null, right: string | null};
  setSelectedLaws: (selectedLaws: {left: string | null, right: string | null}) => void;
  lawArticle: {left:LawArticle, right:LawArticle};
  setLawArticle: (lawArticle: {left:LawArticle, right:LawArticle})=> void;
  isArticleLoaded: {left:boolean, right:boolean};
  setIsArticleLoaded: (isArticleLoaded: {left:boolean, right:boolean}) => void;
  fetchLawArticle: (pane:'left'|'right',lawId:string) => Promise<void>;
  getChildren: (pane:'left'|'right'|'ref',
                json : LawNode|string, 
                provision : string|number|null, 
                articleNo : number|string|null, 
                paragraphNo : number|string|null, 
                itemNo : number|string|null, 
                articleTitle : number|string|null) => React.ReactNode;
}

export interface RefArticle {
  lawNum : string;
  provision: string;
  article: string|number|null
}

interface ReferenceContextType {
  clickedRefs: RefArticle[];
  setClickedRefs: (refLaws:RefArticle[]) => void;
  refArticleLoaded: boolean;
  setRefArticleLoaded: (loaded:boolean) => void;
  refLinkClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}


const brackets: Record<string, string> = {
  "（":"）",
  "「":"」",
}

type Props = { children: React.ReactNode };

export function isSameDateInJapan(ts1:number, ts2:number) {
    // 日本時間で日付を比較するため、タイムゾーンを指定してフォーマット
    // ts1とts2はミリ秒単位のタイムスタンプ
    // indexedDBのタイムスタンプが同日だった場合、取得済としてindexedDBから取得する
    const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };

    const date1 = new Date(ts1).toLocaleDateString('ja-JP', options);
    const date2 = new Date(ts2).toLocaleDateString('ja-JP', options);

    return date1 === date2;
}

const flattenText = (node: React.ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (React.isValidElement(node)) return flattenText((node.props as any).children);
  return "";
};

// 子要素を走査して [before部分, マッチ部分, after部分] に振り分ける
const splitNodes = (node: React.ReactNode,
                    textPos = { pos: 0 },
                    splitStart: number, // idx
                    splitEnd: number, // idx + keyword.length
                  ): {
  before: React.ReactNode[];
  match: React.ReactNode[];
  after: React.ReactNode[];
} => {
  const result = { before: [] as React.ReactNode[], match: [] as React.ReactNode[], after: [] as React.ReactNode[] };

  const helper = (n: React.ReactNode): React.ReactNode => {
    if (typeof n === "string") {
      const start = textPos.pos;
      const end = textPos.pos + n.length;

      if (end <= splitStart) {
        result.before.push(n);
      } else if (start >= splitEnd) {
        result.after.push(n);
      } else {
        // 部分的にかぶる場合を処理
        if (start < splitStart) {
          result.before.push(n.slice(0, splitStart - start));
        }
        const matchPart = n.slice(Math.max(0, splitStart - start), Math.min(n.length, splitEnd - start));
        if (matchPart) result.match.push(matchPart);
        if (end > splitEnd) {
          result.after.push(n.slice(splitEnd - start));
        }
      }

      textPos.pos += n.length;
      return null;
    }

    if (Array.isArray(n)) {
      n.forEach(helper);
    } else if (React.isValidElement<{ children?: React.ReactNode }>(n)) {
      const childResult = splitNodes(n.props.children, textPos,splitStart,splitEnd);
      // 各パートをそのまま同じ要素で包み直す
      if (childResult.before.length)
        result.before.push(React.cloneElement(n, {key:`before-${textPos.pos}-${splitStart}`}, childResult.before));
      if (childResult.match.length)
        result.match.push(React.cloneElement(n, {key:`match-${textPos.pos}-${splitStart}`}, childResult.match));
      if (childResult.after.length)
        result.after.push(React.cloneElement(n, {key:`after-${textPos.pos}-${splitStart}`}, childResult.after));
    }
    return null;
  };

  helper(node);
  return result;
};

function BracketHighlighter( {children} : Props ) : React.ReactNode[] {
  const text = flattenText(children);
  // カッコの位置と階層を記録する
  const bracketLevelBuffer: { textPos:number; level:number; bracket:string }[] = [];
  // 最終的な階層情報：textPos…開きカッコであればカッコの位置 閉じカッコであればその次、level...textPosからの階層
  const bracketLevel: { splitStart:number; splitEnd:number; level:number; bracket:string }[] = []; 
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char in brackets) {
      // 新しい階層を開始
      const newLevel = { textPos:i,level:bracketLevelBuffer.length+1,bracket:char};
      bracketLevelBuffer.push(newLevel);
    } else if ((bracketLevelBuffer.length>0)&&(char === brackets[bracketLevelBuffer[bracketLevelBuffer.length-1].bracket])) {
      // 閉じるとき
      const last = bracketLevelBuffer.pop();
      if (!last) {
        // 対応する開きがない場合（エラー表示）
        // console.log('Error: no matching opening bracket for ', char);
        continue;
      }
      bracketLevel.push({splitStart:last!.textPos,splitEnd:i+1 , level:last!.level, bracket:last!.bracket});
    }
  }
  // 閉じ忘れがある場合
  while (bracketLevelBuffer.length > 0) {
    // console.log('Error: no matching closing bracket for ', bracketLevelBuffer[bracketLevelBuffer.length-1].bracket);
    bracketLevelBuffer.pop();
  }
  // 階層情報をレベルが大きい順でソート
  bracketLevel.sort((a,b)=>(b.level !== a.level)? (b.level - a.level) : (a.splitStart - b.splitStart)); // レベルが同じ場合は開始位置でソート
  // 階層情報を元にテキストを分割してNodeに格納
  const result: React.ReactNode[] = [];
  if (bracketLevel.length === 0) {
    // カッコがない場合はそのまま返す
    result.push(text);
    return result;
  }
  let loopingChildren: React.ReactNode = children;
  for (let i=0; i<bracketLevel.length; i++) {
    const {before: beforeNodes, match: matchNodes, after: afterNodes} = splitNodes(loopingChildren, {pos:0}, bracketLevel[i].splitStart, bracketLevel[i].splitEnd);
    loopingChildren = (<React.Fragment key={`${i}_lv${bracketLevel[i].level}_${bracketLevel[i].splitStart}_${bracketLevel[i].splitEnd}`}>
      {beforeNodes}
      <span className={`annotation lv${(bracketLevel[i].level-1)%5 + 1}`}>
        {matchNodes}
      </span>
      {afterNodes}
    </React.Fragment>);
  }
  return loopingChildren as React.ReactNode[];
};

const LinkifyWithWrap: React.FC<{children: React.ReactNode, refTextData: RefData[]}> = ({children, refTextData}) => {
  let loopingChildren: React.ReactNode = children;
  // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
  const fullText = flattenText(loopingChildren);
  refTextData = Array.from(new Set(refTextData)); // 重複削除
  // let refTextDataNomatch = refTextData.filter(data => data.match==="★引用個所不明★"); // マッチしないものを抽出
  refTextData = refTextData.filter(data => data.match&&data.match !== "★引用個所不明★"); // マッチするものだけ抽出
  // マッチするテキストがあるものを先に処理する
  refTextData.sort((a,b)=>{
    if (a.match && b.match) {
      return fullText.indexOf(a.match) - fullText.indexOf(b.match); // マッチ位置が早い順
    } else if (a.match) {
      return -1;
    } else if (b.match) {
      return 1;
    } else {
      return 0;
    }
  });

  refTextData.forEach((data:RefData,i)=>{
    if (data.match) {
      const keyword = data.match;
      const idx = fullText.indexOf(keyword);
      if (idx > -1) { // マッチしなければそのまま返す
        const { before: beforeNodes, match: matchNodes, after: afterNodes } = splitNodes(loopingChildren, {pos:0}, idx, idx+keyword.length);
        loopingChildren = (
          <React.Fragment key={i}>
            {beforeNodes}
            <span className="refLink" data-law-num={data.ref?.lawNum} data-provision={data.ref?.lawArticle.provision} data-article={data.ref?.lawArticle.article} data-paragraph={data.ref?.lawArticle.paragraph}>
              {matchNodes}
            </span>
            {afterNodes}
          </React.Fragment>
        );
      };
    }
  });
  return (<>{loopingChildren}</>)
  // if (refTextDataNomatch.length === 0) return (<>{loopingChildren}</>);
  // let noMatchLink:React.ReactNode = <>{'★引用条文★'}</>;
  // refTextDataNomatch.forEach((data:RefData,i)=>{
  //   if (data.match) {
  //     noMatchLink = (
  //       <span className="refLink" data-law-num={data.ref?.lawNum} data-provision={data.ref?.lawArticle.provision} data-article={data.ref?.lawArticle.article} data-paragraph={data.ref?.lawArticle.paragraph} key={i}>
  //         {noMatchLink}
  //       </span>
  //     );
  //   }
  // });
  // console.log('No match link added:', noMatchLink);
  // return (<>{loopingChildren}{noMatchLink}</>);
}

const LinkifyNoMatch: React.FC<{refTextData: RefData[]}> = ({refTextData}) => {
  // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
  refTextData = Array.from(new Set(refTextData)); // 重複削除
  let refTextDataNomatch = refTextData.filter(data => data.match==="★引用個所不明★"); // マッチしないものを抽出
  // マッチするテキストがあるものを先に処理する

  if (refTextDataNomatch.length === 0) return (<></>);
  let noMatchLink:React.ReactNode = <>{'★引用条文★'}</>;
  refTextDataNomatch.forEach((data:RefData,i)=>{
    if (data.match) {
      noMatchLink = (
        <span className="refLink" data-law-num={data.ref?.lawNum} data-provision={data.ref?.lawArticle.provision} data-article={data.ref?.lawArticle.article} data-paragraph={data.ref?.lawArticle.paragraph} key={i}>
          {noMatchLink}
        </span>
      );
    }
  });
  return (<>{noMatchLink}</>);
}

const ProcessDelay: React.FC<{children: React.ReactNode, refTextData: RefData[]}> = ({children, refTextData}) => {
  const [processed, setProcessed] = useState<React.ReactNode>(children);
  const ref = React.useRef(null);
  let loopingChildren: React.ReactNode = children;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        if (refTextData.length === 0) {
          loopingChildren = <BracketHighlighter>{loopingChildren}</BracketHighlighter>;
        } else {
        loopingChildren = (
          <BracketHighlighter>
            <LinkifyWithWrap children={loopingChildren} refTextData={refTextData} />
          </BracketHighlighter>
        );}
        setProcessed(loopingChildren);
      }
    });

    if (ref.current) {
      observer.observe(ref.current);
      return () => observer.disconnect();
    }

  },[children]);
  return (<span ref={ref}>{processed}</span>);
};
// 号をさらに分割しているときのため、Subitem1,Subitem2,...Subitem10を定義しておく
const subitemNode:string[] = []
for (let i=1; i<10 ;i++) {
    subitemNode.push(`Subitem${i}`)
}

const handleRightClick = (e: React.MouseEvent<HTMLElement>) => {
  e.preventDefault(); // 右クリックメニュー無効化
  const text = e.currentTarget.innerText.replaceAll('★引用条文★', '');
  navigator.clipboard.writeText(text).then(() => {
  alert('テキストがコピーされました: \n' + text);
  }).catch(err => {
      console.error('コピーに失敗しました: ', err);
  });
};


export const LawDataContext = createContext<LawDataContextType>({
  lawData: null,
  isDataLoaded: false,
  fetchLawData: async () => {},
});

export const LawArticleContext = createContext<LawArticleContextType>({
  selectedLaws : {left: null, right: null},
  setSelectedLaws: () => {},
  lawArticle : {left: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},
                right: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null}},
  setLawArticle: () => {},
  isArticleLoaded: {left:false, right:false},
  setIsArticleLoaded: () => {},
  fetchLawArticle: async () => {},
  getChildren: () => { return (<></>); },
});

export const ReferenceContext = createContext<ReferenceContextType>({
  clickedRefs: [],
  setClickedRefs: () => {},
  refArticleLoaded: false,
  setRefArticleLoaded: () => {},
  refLinkClick: () => {},
})

export const LawDataProvider = ({ children }: { children: ReactNode }) => {
  const [lawData, setLawData] = useState<LawData[] | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // APIからデータ取得
  const fetchLawData = async () => {
    if (isDataLoaded) return; // 既にデータがロードされている場合は何もしない
    try {
      const cached = await getLawListFromCache();
      const now = Date.now();
      if (cached && isSameDateInJapan(now, (cached as LawListCache).timestamp)) {
          setLawData((cached as LawListCache).data);
      } else {
        try {
          let res = await fetch("https://laws.e-gov.go.jp/api/2/laws?limit=1"); // 1件取得して件数を確認
          const total_count = await res.json().then(data => data.total_count);
            if (total_count > 0) {
                res = await fetch(`https://laws.e-gov.go.jp/api/2/laws?limit=${total_count}`); // 全件取得
            }
          const data: LawData[] = await res.json().then(data => data.laws);
          setLawData(data);
          await saveLawListToCache(data)
        } catch (error) {
          console.error("APIからのデータ取得失敗:", error);
        }
      }
    } catch (error) {
      console.error("キャッシュからのデータ取得失敗:", error);
    } finally {
        setIsDataLoaded(true); // エラーが発生してもロード完了とする
    }
  };

  // Webサイトを開いたとき（初回レンダリング時）に裏で実行
  useEffect(() => {
    fetchLawData();
  }, []);

  return (
    <LawDataContext.Provider value={{ lawData, isDataLoaded, fetchLawData }}>
      {children}
    </LawDataContext.Provider>
  );
};

export const LawArticleProvider = ({ children }: { children: ReactNode }) => {
  const [selectedLaws, setSelectedLaws] = useState<{left: string | null, right: string | null}>({
    left: null,
    right: null
  });
  const [lawArticle, setLawArticle] = useState<{left:LawArticle,right:LawArticle}>({
    left: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},
    right: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},  
  });
  const [isArticleLoaded, setIsArticleLoaded] = useState<{left:boolean, right:boolean}>({
    left: false,
    right: false,
  });
  const [refData, setRefData] = useState<{left:RefData[],right:RefData[]}>({
   left: [],
   right: [], 
  });
  async function fetchLawArticle(pane:'left'|'right',lawId:string) {
    try {
      let cached = await getLawFromCache(lawId);
      const now = Date.now();
      if (cached && isSameDateInJapan(now, (cached as LawDataCache).timestamp)) {
        setLawArticle({...lawArticle, [pane]:(cached as LawDataCache).lawArticle})
        setIsArticleLoaded({...isArticleLoaded, [pane]:true});
      } else {
      fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`)
        .then(res => res.json())
        .then(data => {
            setLawArticle({...lawArticle, [pane]:data})
            saveLawToCache(lawId,data)
          })
        .catch(err => console.error("APIからの法令データ取得エラー:", err))
        .finally(() => {
          setIsArticleLoaded({...isArticleLoaded, [pane]:true});
        });
      }
    } catch (err) {
       if (err instanceof Error) {
         console.log(`キャッシュからの法令データ取得エラー：${err.message}`);
       } else {
         console.log('キャッシュからの法令データ取得エラー：', err);
       }
    }
  };

  async function fetchRefData(pane:'left'|'right',lawId:string) {
    fetch(`./ref_json/${lawId}.json`)
    .then(res => res.json())
    .then(data => {
        setRefData({...refData, [pane]:data})
  })
    .catch(err => console.error("参照データ取得エラー:", err));
  };

  // ID が変わったら API 取得
  useEffect(() => {
      if (selectedLaws.left) {
        fetchLawArticle('left',selectedLaws.left)
        fetchRefData('left',selectedLaws.left)
      } else {
        setLawArticle({...lawArticle,left:{law_info:null,revision_info:null,law_full_text:null,attached_files_info:null}})
      }
  }, [selectedLaws.left]);
  useEffect(() => {
      if (selectedLaws.right) {
        fetchLawArticle('right',selectedLaws.right)
        fetchRefData('right',selectedLaws.right)
      } else {
        setLawArticle({...lawArticle,right:{law_info:null,revision_info:null,law_full_text:null,attached_files_info:null}})
      }
  }, [selectedLaws.right]);

  // LawFullTextのchildrenをHTMLに変換
  const getChildren = (
    pane: 'left' | 'right'|'ref',
    json : LawNode|string, 
    provision : string|number|null = 'MainProvision', 
    articleNo : number|string|null = 0, 
    paragraphNo : number|string|null = 0, 
    itemNo : number|string|null = 0, 
    articleTitle : number|string|null = '') : any => {
      if (typeof(json)==='string'){
        // テキストが「附則」の場合は、法令番号を付加
        if (json.replace(/\s/g,'')==='附則' && provision != 'SupplProvision') {
          return (<>{json + "（" + provision + "）"}</>);
        } else if (json!='') {
          let refTextData: RefData[]|undefined;
          if (pane === 'left'||pane === 'right') {
            refTextData = refData[pane] && refData[pane].filter((data:RefData) => {
              return data.match&& 
              data.referred?.lawArticle && (data.referred?.lawArticle.provision === 'MainProvision'|| data.referred?.lawArticle.provision === 'SupplProvision') &&
              data.referred?.lawArticle.article == articleNo?.toString() &&
              data.referred?.lawArticle.paragraph == paragraphNo?.toString() &&
              data.referred?.lawArticle.item == itemNo?.toString()
            });
          }
          return(<ProcessDelay children={json} refTextData={refTextData || []}/>);
        }
      } else {
          // 属性が目次以前の場合は省略
          if (json.tag !='LawTitle' && json.tag !='LawNum' && json.tag !='TOC') {
              // Articleタグの場合は、ArticleTitleを取得(第○条の記載が格納されている)
              if (json.tag === 'Article'){
                  json.children?.filter(c=>typeof(c) != "string" && (c.tag === 'ArticleTitle')).forEach(c=>{
                      if (typeof(c) != "string" && c.children && c.children?.length > 0) {
                          if (typeof(c.children[0]) === 'string'){articleTitle = c.children[0];}
                      } else {
                          articleTitle = '';
                      }
                  });
              }
              /*
              各法令の条文に対して、「第〇条第〇項第〇号」という情報を付加していく
              各ノードの子ノードに情報を継承させる
              */
              if (json.tag === 'MainProvision') {
                  provision = 'MainProvision';
                  articleNo = 0;
                  paragraphNo = 0;
                  itemNo = 0;
              } else if (json.tag === 'SupplProvision') {
                  if (json.attr && json.attr.AmendLawNum) {
                      provision = json.attr.AmendLawNum;
                  } else {
                      provision = 'SupplProvision';
                  }
                  articleNo = 0;
                  paragraphNo = 0;
                  itemNo = 0;
              } else if (json.tag === 'Article') {
                  articleNo = json.attr && json.attr.Num ? json.attr.Num : 0;
                  paragraphNo = 0;
                  itemNo = 0;
              } else if (json.tag === 'Paragraph') {
                  paragraphNo = json.attr && json.attr.Num ? json.attr.Num : 0;
                  itemNo = 0;
              } else if (json.tag === 'Item') {
                  itemNo = json.attr && json.attr.Num ? json.attr.Num : 0;
              } else if (subitemNode.indexOf(json.tag) >= 0) {
                  itemNo += '-' + (json.attr && json.attr.Num ? json.attr.Num : 0);
              }
              const returnNode = (
                  <>
                      {json.children?.map((j,idx)=>(<React.Fragment key={idx}>{getChildren(pane,j,provision,articleNo,paragraphNo,itemNo,articleTitle)}</React.Fragment>))}
                  </>
              )
              //属性の情報を付加
              let tagAttr = '';
              Object.entries(json.attr || {}).forEach(([key, value]) => {
                  tagAttr += ` ${key}="${value}"`;
              });
              tagAttr += ` data-article="${provision}-${articleNo}" data-item="${provision}-${articleNo}-${paragraphNo}-${itemNo}"`;
              if (json.tag === 'Table') {
                  return (<table className="lawDataTable"><tbody>{returnNode}</tbody></table>);
              } else if (json.tag === 'TableRow') {
                  return (<tr>{returnNode}</tr>);
              } else if (json.tag === 'TableColumn') {
                  return (<td data-article={`${provision}-${articleNo}`} data-item={`${provision}-${articleNo}-${paragraphNo}-${itemNo}`}>{returnNode}</td>);
              } else if (json.tag === 'ParagraphNum' && json.children && json.children.length === 0) {
                  return (<span className={`xml-${json.tag}`} data-article={`${provision}-${articleNo}`} data-item={`${provision}-${articleNo}-${paragraphNo}-${itemNo}`}>
                      {articleTitle}{'　'}
                      </span>);
              } else if (json.tag === 'Article') {
                  return (<span className={`xml-${json.tag}`} data-article={`${provision}-${articleNo}`} data-item={`${provision}-${articleNo}-${paragraphNo}-${itemNo}`} onContextMenu={handleRightClick}>
                      {returnNode}
                  </span>);
              } else if (json.tag === 'Paragraph') {
                  let refTextData: RefData[]|undefined;
                  if (pane === 'left'||pane === 'right') {
                    refTextData = refData[pane] && refData[pane].filter((data:RefData) => {
                      return data.match&& 
                      data.referred?.lawArticle && (data.referred?.lawArticle.provision === 'MainProvision'|| data.referred?.lawArticle.provision === 'SupplProvision') &&
                      data.referred?.lawArticle.article == articleNo?.toString() &&
                      data.referred?.lawArticle.paragraph == paragraphNo?.toString()
                    });
                  }
                  return(
                      <span className={`xml-${json.tag}`} data-article={`${provision}-${articleNo}`} data-item={`${provision}-${articleNo}-${paragraphNo}-${itemNo}`}>
                          {returnNode}
                          {(json.tag.indexOf('Num')>0 || json.tag.indexOf('Title')>0 )?'　':''}
                          {refTextData&&<LinkifyNoMatch refTextData={refTextData}/>}
                      </span>);
              } else if (json.tag !== 'ArticleTitle') {
                  return (
                      <span className={`xml-${json.tag}`} data-article={`${provision}-${articleNo}`} data-item={`${provision}-${articleNo}-${paragraphNo}-${itemNo}`}>
                          {returnNode}
                          {(json.tag.indexOf('Num')>0 || json.tag.indexOf('Title')>0 )?'　':''}
                      </span>);
              }
          }
      }
  }

  return (
    <LawArticleContext.Provider value={{ selectedLaws, setSelectedLaws, lawArticle, setLawArticle,isArticleLoaded, setIsArticleLoaded, fetchLawArticle, getChildren }}>
      {children}
    </LawArticleContext.Provider>
  );
};

export const ReferenceProvider = ({ children }: { children: ReactNode }) => {
  const [clickedRefs, setClickedRefs] = useState<RefArticle[]>([]);
  const [refArticleLoaded,setRefArticleLoaded] = useState(false);

  const refLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
    let el: HTMLElement | null = e.target as HTMLElement;
    const refItems: RefArticle[] = [];

    // クリックされた要素から親方向にさかのぼってすべて拾う
    while (el) {
      if (el.tagName === "SPAN" && el.classList.contains("refLink")) {
        const refItem = {lawNum: el.dataset.lawNum || '', provision: el.dataset.provision || '', article: el.dataset.article || null};
        if (refItem) {
          refItems.push(refItem);
        }
      }
      el = el.parentElement;
    }
    if (refItems.length > 0) {
      setRefArticleLoaded(false);
      setClickedRefs(refItems); // 状態に保存して下部に表示
    }
  }
  return (
    <ReferenceContext.Provider value={{ clickedRefs, setClickedRefs, refArticleLoaded, setRefArticleLoaded, refLinkClick } }>
      {children}
    </ReferenceContext.Provider>
  )
}

