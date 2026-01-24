import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from 'react-router-dom';
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
export interface TocItem {
  id: string;
  label: string;
  depth: number;
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
  vnode: {left:VNode[] | null, right:VNode[] | null};
  setVnode: (vnode: {left:VNode[] | null, right:VNode[] | null})=> void;
  isArticleLoaded: {left:boolean, right:boolean};
  setIsArticleLoaded: (isArticleLoaded: {left:boolean, right:boolean}) => void;
  domNodes: {left:React.ReactNode, right:React.ReactNode};
  dataLoading: {left:string,right:string};
  tocItems: {left:TocItem[] | null, right:TocItem[] | null};
  setTocItems: (tocItems: {left:TocItem[] | null, right:TocItem[] | null}) => void;
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

const handleRightClick = (e: React.MouseEvent<HTMLElement>) => {
  e.preventDefault(); // 右クリックメニュー無効化
  const text = e.currentTarget.innerText.replaceAll('★引用条文★', '');
  navigator.clipboard.writeText(text).then(() => {
  alert('テキストがコピーされました: \n' + text);
  }).catch(err => {
      console.error('コピーに失敗しました: ', err);
  });
};

export const renderVNodes = (input: VNode | readonly VNode[] | null | undefined): React.ReactNode => {
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

// 単一VNodeをReactNodeに変換
const renderVNode = (node: VNode): React.ReactNode => {
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

export const LawDataContext = createContext<LawDataContextType>({
  lawData: null,
  isDataLoaded: false,
});

export const LawArticleContext = createContext<LawArticleContextType>({
  selectedLaws : {left: null, right: null},
  setSelectedLaws: () => {},
  vnode: {left: null, right: null},
  setVnode: () => {},
  isArticleLoaded: {left:false, right:false},
  setIsArticleLoaded: () => {},
  domNodes: {left:<></>, right:<></>},
  dataLoading: {left:'', right:''},
  tocItems: {left: null, right: null},
  setTocItems: () => {},
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
          setLawData(data);  
          setIsDataLoaded(true);  
        });  
    } catch (error) {
      console.error("データ取得失敗:", error);
    } finally {
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

export const LawArticleProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { fetchLawArticle } = useLawDataWorker();  
  const { dividerPos,setDividerPos } = useContext(DividerContext)

    // 処理した内容を保持するためのref
  const prevSelectedLaws = useRef<{ [key: string]: string | null }>({ left: searchParams.get('left')||'', right: searchParams.get('right')||'' });

  const [isArticleLoaded, setIsArticleLoaded] = useState<{left:boolean, right:boolean}>({left:true, right:true}); 
  const [selectedLaws, setSelectedLaws] = useState<{left: string | null, right: string | null}>({left:null,right:null});
  const [vnode, setVnode] = useState<{left: VNode[] | null; right: VNode[] | null}>({left: null,right: null});
  const [dataLoading, setDataLoading] = useState<{left:string,right:string}>({left: '',right: ''});
  const [domNodes, setDomNodes] = useState<{left: React.ReactNode; right: React.ReactNode}>({left: <></>,right: <></>});
  const [tocItems, setTocItems] = useState<{left: TocItem[] | null; right: TocItem[] | null}>({left: null, right: null});

  async function lawArticleInit(pane:Pane) {
    let vnode: VNode[] = [];
    if (selectedLaws[pane]) {
      try {
        // Web Workerを使用してデータ取得  
        fetchLawArticle(pane, selectedLaws[pane], (data: any) => {
          if (data) {
            if (data.progress === 'basic_data_loaded') {
              setDataLoading(prev => ({ ...prev, [pane]: 'データ取得開始...' }));
              if (data.tocItems) {
                setTocItems(prev => ({ ...prev, [pane]: data.tocItems }));
              }
            } else if (data.progress === 'article_data_loading') {
              vnode.push(...data.vnodePart);
              setVnode(prev => ({ ...prev, [pane]: vnode }));
              setDataLoading(prev => ({ ...prev, [pane]: data.loading }));
            } else if (data.progress === 'complete') {
              setVnode(prev => ({ ...prev, [pane]: data.vnode }));
              setDataLoading(prev => ({ ...prev, [pane]: '' }));
              if (data.tocItems) {
                setTocItems(prev => ({ ...prev, [pane]: data.tocItems }));
              }
            }
            setIsArticleLoaded(prev => ({ ...prev, [pane]: true }));  
          }
        });  
      } catch (error) {
        console.error("法令データ取得失敗:", error);
      }
    } else {
      setVnode(prev => ({ ...prev, [pane]: null }));
      setIsArticleLoaded(prev => ({ ...prev, [pane]: false }));
      setDataLoading(prev => ({ ...prev, [pane]: '' }));
      setTocItems(prev => ({ ...prev, [pane]: null }));
    }
  }

  // 法令の変更に応じた処理関数
  const processLaw = useCallback((key: "left" | "right", newValue: string | null) => {
    // 前回との違いがある場合のみ処理を実行
    if (prevSelectedLaws.current[key] !== newValue) {
      prevSelectedLaws.current[key] = newValue; // 新しい値を追跡

      // 表示を「データ取得中」にする処理
      setIsArticleLoaded((prev) => ({ ...prev, [key]: false }));
      setVnode(prev=>({...prev, [key]: null}));

      // lawArticleInit関数の呼び出し
      lawArticleInit(key);

      // クエリを更新
      setSearchParams((prevParams) => {
        const updatedParams = new URLSearchParams(prevParams);
        if (newValue) {
          // 新しい値が存在する場合（クリアではない）
          updatedParams.set(key, newValue);
        } else {
          // フレームをクリアした場合（値が空の場合、クエリパラメータを削除）
          updatedParams.delete(key);
        }
        return updatedParams;
      });
    }
  },[setSearchParams, lawArticleInit]);

  // 初回レンダリング時の処理
  useEffect(() => {
    ['left','right'].forEach((pane)=>{
      let paneLawTitle = searchParams.get(pane)||'';
      setSelectedLaws(prev=>({...prev, [pane]: paneLawTitle}));
      setIsArticleLoaded(prev=>({...prev, [pane]: paneLawTitle===''}));
      if (pane==='right'&&paneLawTitle!==''){
        if (dividerPos>=95){
          setDividerPos(50);
        }
      }
    });
  },[]);

  useEffect(() => {

    Object.entries(selectedLaws).forEach(([key, value]) => {
      processLaw(key as Pane, value as string | null);
    });  
  },[selectedLaws]);

  useEffect(() => {
    (['left','right'] as Pane[]).forEach((pane)=>{
      const domNode = vnode[pane]? renderVNodes(vnode[pane]) : null;
      setDomNodes(prev=>({...prev, [pane]: domNode}));
    });
  }, [vnode]);

  return (
    <LawArticleContext.Provider value={{ selectedLaws, setSelectedLaws, isArticleLoaded, setIsArticleLoaded, vnode, setVnode, domNodes, dataLoading, tocItems, setTocItems }}>
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
