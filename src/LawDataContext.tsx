import React, { createContext, useContext, useState, useEffect } from "react";
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
  vnode: {left:VNode | null, right:VNode | null};
  setVnode: (vnode: {left:VNode | null, right:VNode | null})=> void;
  isArticleLoaded: {left:boolean, right:boolean};
  setIsArticleLoaded: (isArticleLoaded: {left:boolean, right:boolean}) => void;
  getChildren: (vnode:VNode|null) => React.ReactNode;
  dataLoading: {left:string,right:string};
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
  getChildren: () => { return (<></>); },
  dataLoading: {left:'', right:''},
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
  let leftLawTitle = searchParams.get('left')||'';
  let rightLawTitle = searchParams.get('right')||'';
  useEffect(() => {
    if (rightLawTitle!==''){
      if (dividerPos>=95){
        setDividerPos(50);
      }
    }
  },[]);
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
  const [vnode, setVnode] = useState<{left: VNode | null; right: VNode | null}>({
    left: null,
    right: null,
  });
  const [dataLoading, setDataLoading] = useState<{left:string,right:string}>({
    left: '',
    right: '',
  });

  async function lawArticleInit(pane:Pane) {
    if (selectedLaws[pane]) {
      try {
        // Web Workerを使用してデータ取得  
        fetchLawArticle(pane, selectedLaws[pane], (data: any) => {
          if (data.progress === 'basic_data_loaded') { 
            setLawArticle(prev => ({ ...prev, [pane]: data.lawArticle }));
          } else if (data.progress === 'article_data_loading' || data.progress === 'complete') {
            // setRefLawTitle(prev => ({ ...prev, [pane]: data.refLawTitle }));  
            // setRefData(prev=>({...prev, [pane]:data.refData}));
            if (data.progress === 'article_data_loading') {
              setDataLoading(prev => ({ ...prev, [pane]: data.loading }));
            } else {
              setDataLoading(prev => ({ ...prev, [pane]: '' }));
            }
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

  // 単一VNodeをReactNodeに変換
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
  const getChildren = ( vnode : VNode | null ) : any => {
    if (!vnode) return <></>;
    return <>{renderVNodes(vnode)}</>;
  }
  return (
    <LawArticleContext.Provider value={{ selectedLaws, setSelectedLaws, isArticleLoaded, setIsArticleLoaded, vnode, setVnode, getChildren, dataLoading }}>
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

