import React, { createContext, useContext, useState, useEffect, useRef,useMemo } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from 'react-router-dom';
// import { saveLawToCache, getLawFromCache, saveLawListToCache, getLawListFromCache } from './indexedDB'
// import type { LawListCache,LawDataCache } from "./indexedDB";
import kanjiToNumber from './assets/KanjiToNumber'
import { DividerContext } from './DiviserContext';
import { useLawDataWorker } from './hooks/useLawDataWorker';  

export type Pane = 'left' | 'right';

export interface LawData {
  law_info: any;
  revision_info: any;
  current_revision_info: any;
}

interface LawDataContextType {
  lawData: LawData[] | null;
  isDataLoaded: boolean;
}
export interface RefLawTitleList {
  lawTitleList: string[];
  synonymList: { [key: string]: string };
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
  // lawArticle: {left:LawArticle, right:LawArticle};
  // setLawArticle: (lawArticle: {left:LawArticle, right:LawArticle})=> void;
  vnode: {left:VNode | null, right:VNode | null};
  setVnode: (vnode: {left:VNode | null, right:VNode | null})=> void;
  isArticleLoaded: {left:boolean, right:boolean};
  setIsArticleLoaded: (isArticleLoaded: {left:boolean, right:boolean}) => void;
  refLawTitle:{left:RefLawTitleList,right:RefLawTitleList};
  getChildren: (pane:Pane|'ref', vnode:VNode|null) => React.ReactNode;
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

// function BracketHighlighter( {children} : Props ) : React.ReactNode[] {
//   const text = flattenText(children);
//   // カッコの位置と階層を記録する
//   const bracketLevelBuffer: { textPos:number; level:number; bracket:string }[] = [];
//   // 最終的な階層情報：textPos…開きカッコであればカッコの位置 閉じカッコであればその次、level...textPosからの階層
//   const bracketLevel: { splitStart:number; splitEnd:number; level:number; bracket:string }[] = []; 
  
//   for (let i = 0; i < text.length; i++) {
//     const char = text[i];

//     if (char in brackets) {
//       // 新しい階層を開始
//       const newLevel = { textPos:i,level:bracketLevelBuffer.length+1,bracket:char};
//       bracketLevelBuffer.push(newLevel);
//     } else if ((bracketLevelBuffer.length>0)&&(char === brackets[bracketLevelBuffer[bracketLevelBuffer.length-1].bracket])) {
//       // 閉じるとき
//       const last = bracketLevelBuffer.pop();
//       if (!last) {
//         // 対応する開きがない場合（エラー表示）
//         // console.log('Error: no matching opening bracket for ', char);
//         continue;
//       }
//       bracketLevel.push({splitStart:last!.textPos,splitEnd:i+1 , level:last!.level, bracket:last!.bracket});
//     }
//   }
//   // 閉じ忘れがある場合
//   while (bracketLevelBuffer.length > 0) {
//     // console.log('Error: no matching closing bracket for ', bracketLevelBuffer[bracketLevelBuffer.length-1].bracket);
//     bracketLevelBuffer.pop();
//   }
//   // 階層情報をレベルが大きい順でソート
//   bracketLevel.sort((a,b)=>(b.level !== a.level)? (b.level - a.level) : (a.splitStart - b.splitStart)); // レベルが同じ場合は開始位置でソート
//   // 階層情報を元にテキストを分割してNodeに格納
//   const result: React.ReactNode[] = [];
//   if (bracketLevel.length === 0) {
//     // カッコがない場合はそのまま返す
//     result.push(text);
//     return result;
//   }
//   let loopingChildren: React.ReactNode = children;
//   for (let i=0; i<bracketLevel.length; i++) {
//     const {before: beforeNodes, match: matchNodes, after: afterNodes} = splitNodes(loopingChildren, {pos:0}, bracketLevel[i].splitStart, bracketLevel[i].splitEnd);
//     loopingChildren = (<React.Fragment key={`${i}_lv${bracketLevel[i].level}_${bracketLevel[i].splitStart}_${bracketLevel[i].splitEnd}`}>
//       {beforeNodes}
//       <span className={`annotation lv${(bracketLevel[i].level-1)%5 + 1}`}>
//         {matchNodes}
//       </span>
//       {afterNodes}
//     </React.Fragment>);
//   }
//   return loopingChildren as React.ReactNode[];
// };

// const LinkifyWithWrap: React.FC<{children: React.ReactNode, refTextData: RefData[]}> = ({children, refTextData}) => {
//   let loopingChildren: React.ReactNode = children;
//   // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
//   const fullText = flattenText(loopingChildren);
//   refTextData = Array.from(new Set(refTextData)); // 重複削除
//   refTextData = refTextData.filter(data => data.match&&data.match !== "★引用個所不明★"); // マッチするものだけ抽出

//   // マッチするテキストがあるものを先に処理する
//   refTextData.sort((a,b)=>{
//     if (a.match && b.match) {
//       return fullText.indexOf(a.match) - fullText.indexOf(b.match); // マッチ位置が早い順
//     } else if (a.match) {
//       return -1;
//     } else if (b.match) {
//       return 1;
//     } else {
//       return 0;
//     }
//   });

//   refTextData.forEach((data:RefData,i)=>{
//     if (data.match) {
//       const keyword = data.match;
//       const idx = fullText.indexOf(keyword);
//       if (idx > -1) { // マッチしなければそのまま返す
//         const { before: beforeNodes, match: matchNodes, after: afterNodes } = splitNodes(loopingChildren, {pos:0}, idx, idx+keyword.length);
//         loopingChildren = (
//           <React.Fragment key={i}>
//             {beforeNodes}
//             <span className="refLink" data-law-num={data.ref?.lawNum} data-provision={data.ref?.lawArticle.provision} data-article={data.ref?.lawArticle.article} data-paragraph={data.ref?.lawArticle.paragraph}>
//               {matchNodes}
//             </span>
//             {afterNodes}
//           </React.Fragment>
//         );
//       };
//     }
//   });
//   return (<>{loopingChildren}</>)
// }

// const LinkifyWithLawText: React.FC<{children: React.ReactNode,refLawTitle:RefLawTitleList|undefined}> = ({children, refLawTitle}) => {
//   const { lawData } = useContext(LawDataContext);
//   if (!refLawTitle) return (<>{children}</>);
//   if (refLawTitle.lawTitleList.length===0) return (<>{children}</>);
//   let loopingChildren: React.ReactNode = children;
//   const fullText = flattenText(loopingChildren);
//   const synonym = refLawTitle.synonymList;
//   let regex: RegExp
//   refLawTitle.lawTitleList.forEach(lawNum=>{
//     const law = lawData?.filter(law=>law.law_info?.law_num===lawNum)[0]?.current_revision_info?.law_title;
//     regex = new RegExp('(?:' + law + (synonym[lawNum]? '|' + synonym[lawNum] : '') + ')' + '(?:（(?:' + lawNum + ')?。?(?:以下「[^「]*?」という。)?）)?(附則)?第([一二三四五六七八九十百千万]+)条(?:の([一二三四五六七八九十百千万]+))?(?:第([一二三四五六七八九十百千万]+)項)?' , 'g');
//     let regexExec = [...fullText.matchAll(regex)];
//     if (regexExec&&(regexExec?.length>0)){
//       regexExec.forEach((e,i)=>{
//         const { before: beforeNodes, match: matchNodes, after: afterNodes } = splitNodes(loopingChildren, {pos:0}, e.index, e.index+e[0].length);
//         loopingChildren = (
//           <React.Fragment key={i}>
//             {beforeNodes}
//             <span className="refLink" data-law-num={lawNum} data-provision={e[1]?'SupplProvision':'MainProvision'} data-article={(e[2]?kanjiToNumber(e[2]):0)+(e[3]?`_${kanjiToNumber(e[3])}`:'')} data-paragraph={kanjiToNumber(e[4])}>
//               {matchNodes}
//             </span>
//             {afterNodes}
//           </React.Fragment>
//         );
//       });
//     }
//   });
//   return (<>{loopingChildren}</>)
// }

// const LinkifyNoMatch: React.FC<{refTextData: RefData[]}> = ({refTextData}) => {
//   // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
//   refTextData = Array.from(new Set(refTextData)); // 重複削除
//   let refTextDataNomatch = refTextData.filter(data => data.match==="★引用個所不明★"); // マッチしないものを抽出
//   // マッチするテキストがあるものを先に処理する

//   if (refTextDataNomatch.length === 0) return (<></>);
//   let noMatchLink:React.ReactNode = <span className="refSentence">{'★引用条文★'}</span>;
//   refTextDataNomatch.forEach((data:RefData,i)=>{
//     if (data.match) {
//       noMatchLink = (
//         <span className="refLink" data-law-num={data.ref?.lawNum} data-provision={data.ref?.lawArticle.provision} data-article={data.ref?.lawArticle.article} data-paragraph={data.ref?.lawArticle.paragraph} key={i}>
//           {noMatchLink}
//         </span>
//       );
//     }
//   });
//   return (<>{noMatchLink}</>);
// }

// const ProcessDelay: React.FC<{children: React.ReactNode, refTextData: RefData[],refLawTitle:RefLawTitleList|undefined}> = ({children, refTextData,refLawTitle}) => {
//   const [processed, setProcessed] = useState<React.ReactNode>(children);
//   const ref = React.useRef(null);
//   let loopingChildren: React.ReactNode = children;
//   useEffect(() => {
//     const observer = new IntersectionObserver(([entry]) => {
//       if (entry.isIntersecting) {
//         observer.disconnect();
//         if (refTextData.length === 0) {
//           loopingChildren = (
//             <LinkifyWithLawText refLawTitle={refLawTitle}>
//               <BracketHighlighter>
//                 {loopingChildren}
//               </BracketHighlighter>
//             </LinkifyWithLawText>);
//         } else {
//         loopingChildren = (
//           <LinkifyWithLawText refLawTitle={refLawTitle}>
//             <BracketHighlighter>
//               <LinkifyWithWrap children={loopingChildren} refTextData={refTextData} />
//             </BracketHighlighter>
//           </LinkifyWithLawText>
//         );}
//         setProcessed(loopingChildren);
//       }
//     });

//     if (ref.current) {
//       observer.observe(ref.current);
//       return () => observer.disconnect();
//     }

//   },[children]);
//   return (<span ref={ref}>{processed}</span>);
// };
// // 号をさらに分割しているときのため、Subitem1,Subitem2,...Subitem10を定義しておく
// const subitemNode:string[] = []
// for (let i=1; i<10 ;i++) {
//     subitemNode.push(`Subitem${i}`)
// }

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
});

export const LawArticleContext = createContext<LawArticleContextType>({
  selectedLaws : {left: null, right: null},
  setSelectedLaws: () => {},
  // lawArticle : {left: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},
  //               right: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null}},
  // setLawArticle: () => {},
  vnode: {left: null, right: null},
  setVnode: () => {},
  isArticleLoaded: {left:false, right:false},
  setIsArticleLoaded: () => {},
  refLawTitle: {left:{lawTitleList:[],synonymList:{}},right:{lawTitleList:[],synonymList:{}}},
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
  const { fetchLawList } = useLawDataWorker();  

  useEffect(() => {
    if (isDataLoaded) return; // 既にデータがロードされている場合は何もしない
    try {
        // Webサイトを開いたとき（初回レンダリング時）に裏で実行
        // Web Workerを使用してデータ取得
        fetchLawList((data: LawData[]) => {
          console.log("データ取得成功:", data);
          setLawData(data);  
          setIsDataLoaded(true);  
        });  
    } catch (error) {
      console.error("データ取得失敗:", error);
    } finally {
        console.log('lawData:',lawData,'isDataLoaded:',isDataLoaded);
        setIsDataLoaded(true); // エラーが発生してもロード完了とする
    }
  }, []);

  return (
    <LawDataContext.Provider value={{ lawData, isDataLoaded }}>
      {children}
    </LawDataContext.Provider>
  );
};

/** 仮想ノード型 */
export type VNode = 
  | VText  // 文字列ノード
  | VElement; // タグ付きノード

/** テキストノード */
export interface VText {
  type: "text";
  value: string;
}

/** タグ付きノード */
export interface VElement {
  readonly type: "element";
  readonly tag: string;
  readonly attr?: Readonly<Record<string, any>>;
  readonly children: readonly VNode[];
}
interface JsonNode {
  tag: string;
  attr?: Record<string, any>;
  children: (JsonNode | string)[];
}

function normalizeAttrKeys(attr: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  // 特定のキーとその変換後の値を定義したマッピングオブジェクト
  const specialKeyMap: { [key: string]: string } = {
    rowspan: 'rowSpan',
    colspan: 'colSpan',
    WritingMode: 'writingMode', // 例: 'writingMode' のように完全一致でマッピング
    // 'writingmode' がキーとして渡ってくる場合も考慮するなら以下を追加
    // writingmode: 'writingMode',
  };

  for (const key in attr) {
    let lowerKey: string;

    if (Object.prototype.hasOwnProperty.call(attr, key)) {
      // 1. マッピングオブジェクトにキーが存在するかチェックする
      lowerKey = key in specialKeyMap ? specialKeyMap[key] : key.toLowerCase();
      normalized[lowerKey] = attr[key];
    }
  }
  return normalized;
}

export const LawArticleProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { fetchLawArticle } = useLawDataWorker();  
  const { dividerPos,setDividerPos } = useContext(DividerContext)
  let leftLawTitle = searchParams.get('left')||'';
  let rightLawTitle = searchParams.get('right')||'';
  useEffect(() => {
    if (rightLawTitle!==''){
      if (dividerPos>=95){
        setDividerPos(50);
      }
    }
  },[]);
  // const { lawData } = useContext(LawDataContext);
  const [isArticleLoaded, setIsArticleLoaded] = useState<{left:boolean, right:boolean}>({
    left: leftLawTitle !=='',
    right: rightLawTitle !=='',
  });
  const [selectedLaws, setSelectedLaws] = useState<{left: string | null, right: string | null}>({
    left: leftLawTitle,
    right: rightLawTitle
  });
  const [lawArticle, setLawArticle] = useState<{left:LawArticle,right:LawArticle}>({
    left: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},
    right: {law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},  
  });
  const [refData, setRefData] = useState<{left:RefData[],right:RefData[]}>({
   left: [],
   right: [], 
  });
  const [refLawTitle, setRefLawTitle] = useState<{left:RefLawTitleList,right:RefLawTitleList}>({
    left:{lawTitleList:[],synonymList:{}},
    right:{lawTitleList:[],synonymList:{}},
  });
  const [vnode, setVnode] = useState<{left: VNode | null; right: VNode | null}>({
    left: null,
    right: null,
  });
  // async function fetchRefData(pane:Pane,lawId:string) {
  //   const BASE = import.meta.env.BASE_URL;
  //   fetch(`${BASE}ref_json/${lawId}.json`)
  //   .then(res => res.json())
  //   .then(data => {
  //       setRefData(prev=>({...prev, [pane]:data}));
  // })
  //   .catch(err => console.error("参照データ取得エラー:", err));
  // };

  // function getRefLaw(article:LawArticle) {
  //   let lawList:any;
  //   if (article.law_full_text){
  //     lawList = searchLawData(article.law_full_text);
  //   } else {
  //     lawList = [];
  //   }
  //   const refLaw = new Set();
  //   const regex = /(?<=（)((?:令和|平成|昭和|大正|明治)[元一二三四五六七八九十]+年(?:法律|政令|(?:[^）]?省令)|内閣府令)第[一二三四五六七八九十百千万]+号)(?:。以下「([^）]*?)」という。)?(?=）)/g;
  //   const synonym: { [key: string]: string } = {};
  //   lawList.forEach((text:any) => {
  //     let match:RegExpExecArray|null;
  //     while ((match = regex.exec(text)) !== null) {
  //       if (match[1]){
  //         refLaw.add(match[1]);
  //         if (match[2]){
  //           synonym[match[1]] = match[2];
  //         }
  //       }
  //     };
  //   });
  //   refLaw.forEach(lawNum => {
  //     /*
  //     法令の参照では以下の記述となっていることが多いので、正規表現で該当するところを取得した。
  //     [法令名が初めて現れる場合]：(法令名)（元号○○年法律/政令/...第○号）第○条第○項
  //     [法令名が初めて現れる場合で、法令を省略する場合](法令名)（元号○○年法律/政令/...第○号。以下「○○法」という。）第○条第○項
  //     [法令名が2回目以降の場合](法令名もしくは略称名)第○条第○項
  //     なお、「第○条」のところは「第○条の○」となるケースもあるため、それに対応している
  //     法律によっては第○条の○条の○…と続くことがあるが、それは対応が難しいので非対応
  //     */
  //     const law = lawData?.filter(law=>law.law_info?.law_num===lawNum)[0]?.current_revision_info?.law_title;
  //     const synonymRegex = new RegExp(law + '（以下「(.*?)」という。）' , 'g');
  //     lawList.forEach((text:any)=>{
  //       let match:RegExpExecArray|null;
  //       while ((match = synonymRegex.exec(text)) !== null) {
  //         if (match[1]){
  //           if (typeof(lawNum)=='string'&&!(synonym[lawNum])){ //附則で改正法令によって上書きしていることがあるため、最初に出てきたものを優先する
  //             synonym[lawNum] = match[1];
  //           }
  //         }
  //       }
  //     });
  //   });
  //   return {lawTitleList:refLaw,synonymList:synonym};
  // };

  // function searchLawData(json : any): any[] {
  //   const lawList:any[] = [];
  //   if(json.children){
  //     json.children.forEach((item:any) => {
  //       if (typeof(item) === 'string') {
  //         lawList.push(item);
  //       } else if (typeof(item) === 'object' && item.children) {
  //         let subItem = searchLawData(item);
  //         if (subItem) {
  //           subItem.forEach(sub => {
  //             lawList.push(sub);
  //           });
  //         }
  //       }
  //     });
  //     return lawList;
  //   } else {
  //     return [];
  //   }
  // };

  async function lawArticleInit(pane:Pane) {
    if (selectedLaws[pane]) {
      try {
        // Web Workerを使用してデータ取得  
        fetchLawArticle(pane, selectedLaws[pane], (data: any) => {
          if (data.progress === 'basic_data_loaded') { 
            setLawArticle(prev => ({ ...prev, [pane]: data.lawArticle }));
          } else if (data.progress === 'complete') {
            // setRefLawTitle(prev => ({ ...prev, [pane]: data.refLawTitle }));  
            // setRefData(prev=>({...prev, [pane]:data.refData}));
            setVnode(prev => ({ ...prev, [pane]: data.vnode }));
            setIsArticleLoaded(prev => ({ ...prev, [pane]: true }));  
          }
        });  
      } catch (error) {
        console.error("法令データ取得失敗:", error);
      }
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set(pane, selectedLaws[pane] || '');
        return newParams;
      });
    } else {
      // setLawArticle(prev=>({...prev,[pane]:{law_info:null,revision_info:null,law_full_text:null,attached_files_info:null}}));
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.delete(pane);
        return newParams;
      });
    }
  }
  
  // ID が変わったら API 取得、URL パラメータ更新
  useEffect(() => {
    async function updateLawArticle() {
      (['left','right'] as Pane[]).forEach((pane)=>{
        const lawNumPane = (!lawArticle[pane].law_info)? '' : (lawArticle[pane].law_info as any).law_num;
        if ((selectedLaws[pane] ?? '') !== lawNumPane) {
          setIsArticleLoaded(prev=>({...prev, [pane]:false}));
          lawArticleInit(pane);
        }
        if ((lawNumPane ?? '') !== (searchParams.get(pane) ?? '')) {
          setSearchParams((prev) => {
            const newParams = new URLSearchParams(prev);
            if (lawNumPane !== '' ) {
              newParams.set(pane, lawNumPane || '');
            } else {
              newParams.delete(pane);
            }
            return newParams;
          });
        }
      });
    }
    updateLawArticle();
  }, [selectedLaws]);
  useEffect(() => {
    (['left','right'] as Pane[]).forEach((pane)=>{
      const lawNumPane = (!lawArticle[pane].law_info)? '' : (lawArticle[pane].law_info as any).law_num;
      if ((lawNumPane ?? '') !== (searchParams.get(pane) ?? '')) {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          if (lawNumPane !== '' ) {
            newParams.set(pane, lawNumPane || '');
          } else {
            newParams.delete(pane);
          }
          return newParams;
        });
      } 
    });
  }, [lawArticle]);

  // function buildVirtualTree(json: JsonNode | string): VNode {
  //   if (typeof json === "string") {
  //     return { type: "text", value: json };
  //   }

  //   // const { tag, attr = {}, children = [] } = json;
  //   const tag = json.tag;
  //   const attr = normalizeAttrKeys(json.attr ?? {});
  //   const children = json.children ?? [];
  //   return {
  //     type: "element",
  //     tag,
  //     attr,
  //     children: children.map(buildVirtualTree),
  //   };
  // }

  /**
   * VNodeまたはVNode配列をReactNodeに変換
   */
  function renderVNodes(input: VNode | readonly VNode[] | null | undefined): React.ReactNode {
    if (!input) return null;

    if (Array.isArray(input)) {
      // VNode配列の場合：再帰的に子要素を描画
      return <>{input.map((node, index) => (
        <React.Fragment key={index}>{renderVNode(node)}</React.Fragment>
      ))}</>;
    }

    // 単一VNodeの場合
    return renderVNode(input as VNode);
  }

  /**
   * 単一VNodeをReactNodeに変換
   */
  function renderVNode(node: VNode): React.ReactNode {
    if (node.type === "text") {
      // HTML文字列を含むテキストノード
      return <span dangerouslySetInnerHTML={{ __html: node.value }} />;
    }

    if (node.type === "element") {
      const { tag, attr, children } = node;
      const props: Record<string, any> = { ...attr };
      if (props.onContextMenu === "handleRightClick") {
        props.onContextMenu = handleRightClick;
      }
      const renderedChildren = renderVNodes(children);

      return React.createElement(tag, props, renderedChildren);
    }

    // 型安全対策（到達しない想定）
    const _exhaustiveCheck: never = node;
    return _exhaustiveCheck;
  }


  // LawFullTextのchildrenをHTMLに変換
  const getChildren = (
    pane: Pane|'ref',
    // json : LawNode|string,
    vnode : VNode | null,
  ) : any => {
    console.log('getChildren', pane, vnode);
    // function renderVirtualTree(vnode: VNode, ancestors: VElement[] = []): ReactNode {
    //   const hiddenTags = ["LawTitle", "LawNum", "TOC","ArticleTitle"]; // 非表示にするタグ名の配列
    //   const unwrapTags = ["Law","LawBody","ParagraphSentence","ItemSentence"]; // 中身だけ表示するタグ名の配列
    //   // console.log(ancestors[ancestors.length - 1]);

    //   // 各タグを対応するReactコンポーネント or HTMLタグにマップ
    //   const tagMap: Record<string, string> = {
    //     Table: "table",
    //     TableRow: "tr",
    //     TableColumn: "td",
    //   };
    //   // 祖先の中から一番近い Article を探す
    //   const provisionAncestor = [...ancestors]
    //     .reverse()
    //     .find(a => a.tag === "MainProvision" || a.tag === "SupplProvision");
    //   // 祖先の中から一番近い Article を探す
    //   const articleAncestor = [...ancestors]
    //     .reverse()
    //     .find(a => a.tag === "Article");
    //   const paragraphAncestor = [...ancestors]
    //     .reverse()
    //     .find(a => a.tag === "Paragraph");
    //   const itemAncestor = [...ancestors]
    //     .reverse()
    //     .find(a => subitemNode.includes(a.tag)||a.tag === "Item");
    //   const articleNo = articleAncestor?.attr?.num;
    //   const paragraphNo = paragraphAncestor?.attr?.num;
    //   const itemNo = itemAncestor?.attr?.num;
    //   // 直前の親タグを取得
    //   const parentNode = ancestors[ancestors.length - 1];
    //   if (vnode.type === "text") {
    //     if (parentNode.tag.includes("Num")||parentNode.tag.includes("Title")) {
    //       // Num、Titleを含む直下のテキストノードの場合、後続に全角スペースを追加
    //       return `${vnode.value}　`;
    //     };
    //     if (vnode.value.replace(/\s/g,'') === "附則" && provisionAncestor?.attr?.amendlawnum) {
    //         //
    //         return vnode.value + "（" + provisionAncestor.attr.amendlawnum + "）" + (provisionAncestor.attr.extract === 'true' ? "　抄" : "");
    //     }
    //     let refTextData: RefData[]|undefined;
    //     let refLaw: RefLawTitleList|undefined
    //     let refDataPane = refData[pane as Pane];
    //     let refDataMatch = refDataPane && refDataPane.filter((data:RefData)=> data.match!=="★引用個所不明★");   
    //     if (pane === 'left'||pane === 'right') {
    //       refTextData = refDataMatch && refDataMatch.filter((data:RefData) => {
    //         return data.match&& 
    //           data.referred?.lawArticle.provision === (provisionAncestor&&!provisionAncestor?.attr?.amendlawnum&&provisionAncestor?.tag)&&
    //           data.referred?.lawArticle.article === (articleNo||0).toString() &&
    //           data.referred?.lawArticle.paragraph == (paragraphNo||0).toString() &&
    //           data.referred?.lawArticle.item == (itemNo||0).toString()
    //       });
    //       refLaw = refLawTitle[pane];
    //   }

    //     return <ProcessDelay children={vnode.value} refTextData={refTextData || []} refLawTitle={refLaw || undefined}/>;
    //   }
    //   const { tag, attr = {}, children } = vnode;
    //   if (hiddenTags.includes(tag)) {
    //     return null; // 非表示タグはレンダリングしない
    //   }

    //   const mergedTag = tagMap[tag] ?? "span";
    //   const provisionNode = tag === 'MainProvision' || tag === 'SupplProvision' ? vnode : provisionAncestor&&provisionAncestor;
    //   const dataProvision = provisionNode?.tag === 'MainProvision' 
    //                         ? 'MainProvision' 
    //                         : (provisionNode?.tag === 'SupplProvision' 
    //                           ? (provisionNode.attr?.amendlawnum ?? 'SupplProvision') 
    //                           : undefined);
    //   const dataArticle = dataProvision ? `${dataProvision}-${tag === 'Article' ? attr['num']: articleNo||0}` : undefined;
    //   const dataItem = dataArticle ? `${dataArticle}-${tag === 'Paragrapch' ? attr['num']: paragraphNo||0}` : undefined;
    //     // 既存のclassNameにtagを追加。data-article、data-paragraphなどの属性はそのまま維持
    //   const mergedAttr = {
    //     ...attr,
    //     className: [`xml-${tag}`, attr.className].filter(Boolean).join(" "),
    //     "data-provision": dataProvision,
    //     "data-article": dataArticle,
    //     "data-item": dataItem,
    //     "onContextMenu": tag==="Article" ? handleRightClick : undefined,
    //   };
    //   const renderedChildren = children
    //     .map(child => renderVirtualTree(child, [...ancestors, vnode]))
    //     .filter(Boolean);
    //   // --- unwrap対象タグなら、自身はスキップして中身だけ出す ---
    //   if (unwrapTags.includes(tag)) {
    //     return renderedChildren;
    //   }
    //   // Tableタグの直下にtbodyが含まれていないので手動で追加する
    //   if (tag === "Table") {
    //     return React.createElement("table", {}, React.createElement("tbody", mergedAttr, ...renderedChildren));
    //   }
    //   // ParagraphNumタグで子要素が空の場合、第1項とみなして祖先のArticleTitleのテキストを取得して表示する
    //   if (tag === "ParagraphNum" && children.length === 0) {
    //     let titleText = '';
    //     const articleTitle = articleAncestor?.children
    //     .filter(child => child.type === "element" && child.tag === "ArticleTitle")[0]
    //     if (articleTitle?.type === "element") {
    //       articleTitle.children.forEach(child => {
    //         if (child.type === "text") {
    //         titleText = `${child.value}　`;
    //         }
    //       });
    //     return React.createElement(mergedTag, mergedAttr, [titleText]);  
    //     }
    //   }
    //   if (tag === "Paragraph" || tag === "Item") {
    //     // ParagraphまたはItemタグの場合、引用条文が存在する場合hrenderdChildrenの前にLinkifyNoMatchコンポーネントを追加する
    //     let refTextData: RefData[]|undefined;
    //     let refDataPane = refData[pane as Pane];
    //     refTextData = refDataPane && refDataPane.filter((data:RefData) => {
    //       return data.match==="★引用個所不明★"&&
    //         data.referred?.lawArticle.provision === (provisionAncestor&&!provisionAncestor?.attr?.amendlawnum&&provisionAncestor?.tag)&&
    //         data.referred?.lawArticle.article === (articleNo||0).toString() &&
    //         data.referred?.lawArticle.paragraph == (paragraphNo||0).toString() &&
    //         data.referred?.lawArticle.item == (itemNo||0).toString()
    //     });
    //     const noMatchLink = <LinkifyNoMatch refTextData={refTextData || []} />;
    //     renderedChildren.push(noMatchLink);

    //     return React.createElement(mergedTag, mergedAttr, ...renderedChildren);

    //   }
    //   return React.createElement(mergedTag, mergedAttr, ...renderedChildren);
    // }

    // interface JsonRendererProps {
    //   data: JsonNode;
    // }

    // interface VNodeProps {
    //   vnode: VNode; 
    // }

    // const JsonRenderer: React.FC<VNodeProps> = ({ vnode }) => {
      // const prevVNode = useRef<VNode | null>(null);

      // const vnode = useMemo(() => buildVirtualTree(vnode), [vnode]);

      // const changed = useMemo(() => {
      //   prevVNode.current = vnode;
      //   return prevVNode.current !== vnode;
      // }, [vnode]);

      // const element = useMemo(() => renderVirtualTree(vnode), [changed, vnode]);

      // return <>{vnode}</>;
    // };

    // return (<JsonRenderer vnode={vnode[pane as Pane] as VNode}/>);
    if (!vnode) return <></>;
    console.log('renderVNode', renderVNodes(vnode));
    return <>{renderVNodes(vnode)}</>;
  }
  return (
    // <LawArticleContext.Provider value={{ selectedLaws, setSelectedLaws, lawArticle, setLawArticle, isArticleLoaded, setIsArticleLoaded, refLawTitle, getChildren }}>
    <LawArticleContext.Provider value={{ selectedLaws, setSelectedLaws, /*lawArticle, setLawArticle,*/ isArticleLoaded, setIsArticleLoaded, vnode, setVnode, refLawTitle, getChildren }}>
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

