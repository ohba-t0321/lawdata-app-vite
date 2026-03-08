import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from 'react-router-dom';
import { DividerContext } from './DiviserContext';
import { useLawDataWorker } from './hooks/useLawDataWorker';  

export type Pane = 'left' | 'right';

interface LawInfo {
  law_num: string;
  [key: string]: unknown;
}

interface RevisionInfo {
  law_title?: string;
  [key: string]: unknown;
}

export interface LawData {
  law_info: LawInfo;
  revision_info: RevisionInfo;
  current_revision_info: RevisionInfo;
}

interface LawDataContextType {
  lawData: LawData[] | null;
  isDataLoaded: boolean;
  lawDataError: string | null;
  retryLawDataFetch: () => void;
}
export interface RefLawTitleList {
  lawTitleList: string[];
  synonymList: { [key: string]: string[] };
}
export interface LawArticle {
  law_info: Record<string, unknown> | null;
  revision_info: Record<string, unknown> | null;
  law_full_text: Record<string, unknown> | null;
  attached_files_info: Record<string, unknown> | null;
}
export interface TocItem {
  id: string;
  label: string;
  depth: number;
}
export interface RefData {
  match:string | null;
  matchType?: string | null;
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
}
export interface LawNode {
  tag: string;
  attr?: { [key: string]: string | number };
  children?: (LawNode | string)[];
}

interface LawArticleContextType {
  selectedLaws: {left: string | null, right: string | null};
  setSelectedLaws: React.Dispatch<React.SetStateAction<{left: string | null, right: string | null}>>;
  vnode: {left:VNode[] | null, right:VNode[] | null};
  setVnode: React.Dispatch<React.SetStateAction<{left:VNode[] | null, right:VNode[] | null}>>;
  isArticleLoaded: {left:boolean, right:boolean};
  setIsArticleLoaded: React.Dispatch<React.SetStateAction<{left:boolean, right:boolean}>>;
  domNodes: {left:React.ReactNode, right:React.ReactNode};
  dataLoading: {left:string,right:string};
  tocItems: {left:TocItem[] | null, right:TocItem[] | null};
  setTocItems: React.Dispatch<React.SetStateAction<{left:TocItem[] | null, right:TocItem[] | null}>>;
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

const normalizeTocId = (id: string) => id.replace(/^(left|right)-/, '');
const isTocAnchorId = (id: string) => {
  const baseId = normalizeTocId(id);
  return baseId.startsWith('toc-chapter-') || baseId === 'toc-suppl-provision';
};

const applyTocPrefixToItems = (items: TocItem[] | null | undefined, pane: Pane): TocItem[] | null => {
  if (!items) return null;
  const tocPrefix = `${pane}-`;
  return items.map((item) => {
    if (!isTocAnchorId(item.id)) return item;
    const baseId = normalizeTocId(item.id);
    return { ...item, id: `${tocPrefix}${baseId}` };
  });
};

const applyTocPrefixToVnodes = (nodes: VNode[] | null | undefined, pane: Pane): VNode[] | null => {
  if (!nodes) return null;
  const tocPrefix = `${pane}-`;
  const updateNode = (node: VNode): VNode => {
    if (node.type === "text") return node;
    const attr = node.attr ? { ...node.attr } : undefined;
    if (attr?.id && typeof attr.id === "string" && isTocAnchorId(attr.id)) {
      const baseId = normalizeTocId(attr.id);
      attr.id = `${tocPrefix}${baseId}`;
    }
    const children = node.children?.map(updateNode) ?? [];
    return { ...node, attr, children };
  };
  return nodes.map(updateNode);
};

const parseVnodeJson = (json?: string): VNode[] | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as VNode[]) : null;
  } catch (error) {
    console.error('vnode JSON parse error:', error);
    return null;
  }
};

interface LawArticleWorkerMessage {
  progress?: 'basic_data_loaded' | 'article_data_loading' | 'complete';
  tocItems?: TocItem[];
  vnodePartJson?: string;
  vnodePart?: VNode[];
  vnodeJson?: string;
  vnode?: VNode[];
  loading?: string;
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
    const props: Record<string, unknown> = { ...attr };
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
  lawDataError: null,
  retryLawDataFetch: () => {},
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
  const [lawDataError, setLawDataError] = useState<string | null>(null);
  const { fetchLawList } = useLawDataWorker();

  const retryLawDataFetch = useCallback(() => {
    setIsDataLoaded(false);
    setLawDataError(null);
    fetchLawList(
      (data: LawData[]) => {
        setLawData(data);
        setLawDataError(null);
        setIsDataLoaded(true);
      },
      (error) => {
        setLawData(null);
        setLawDataError(error);
        setIsDataLoaded(true);
      }
    );
  }, [fetchLawList]);

  useEffect(() => {
    retryLawDataFetch();
  }, [retryLawDataFetch]);

  return (
    <LawDataContext.Provider value={{ lawData, isDataLoaded, lawDataError, retryLawDataFetch }}>
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
  readonly attr?: Readonly<Record<string, unknown>>;
  readonly children: readonly VNode[];
}

export const LawArticleProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { fetchLawArticle } = useLawDataWorker();  
  const { lawData, isDataLoaded } = useContext(LawDataContext);
  const { dividerPos,setDividerPos } = useContext(DividerContext)

  const initialSelectedLaws = useRef<{left: string | null, right: string | null}>({
    left: searchParams.get('left') || null,
    right: searchParams.get('right') || null,
  });
  // 処理した内容を保持するためのref
  const prevSelectedLaws = useRef<{ [key: string]: string | null }>({ left: null, right: null });

  const [selectedLaws, setSelectedLaws] = useState<{left: string | null, right: string | null}>(
    () => ({ ...initialSelectedLaws.current })
  );
  const [isArticleLoaded, setIsArticleLoaded] = useState<{left:boolean, right:boolean}>(
    () => ({
      left: initialSelectedLaws.current.left === null,
      right: initialSelectedLaws.current.right === null,
    })
  ); 
  const [vnode, setVnode] = useState<{left: VNode[] | null; right: VNode[] | null}>({left: null,right: null});
  const [dataLoading, setDataLoading] = useState<{left:string,right:string}>({left: '',right: ''});
  const [domNodes, setDomNodes] = useState<{left: React.ReactNode; right: React.ReactNode}>({left: <></>,right: <></>});
  const [tocItems, setTocItems] = useState<{left: TocItem[] | null; right: TocItem[] | null}>({left: null, right: null});

  const resolveLawId = useCallback((value: string | null): string | null => {
    if (!value) return null;
    if (!lawData) {
      return isDataLoaded ? value : null;
    }
    const byLawNum = lawData.find((law) => law.law_info.law_num === value);
    if (byLawNum) return byLawNum.law_info.law_num;

    const byLawTitle = lawData.find((law) => law.current_revision_info.law_title === value);
    return byLawTitle?.law_info.law_num ?? value;
  }, [isDataLoaded, lawData]);

  const lawArticleInit = useCallback(async (pane: Pane, selectedLaw: string | null) => {
    const vnode: VNode[] = [];
    if (selectedLaw) {
      try {
        // Web Workerを使用してデータ取得  
        fetchLawArticle<LawArticleWorkerMessage>(pane, selectedLaw, (data) => {
          if (data) {
            if (data.progress === 'basic_data_loaded') {
              setDataLoading(prev => ({ ...prev, [pane]: 'データ取得開始...' }));
              if (data.tocItems) {
                const prefixedTocItems = applyTocPrefixToItems(data.tocItems, pane);
                setTocItems(prev => ({ ...prev, [pane]: prefixedTocItems }));
              }
            } else if (data.progress === 'article_data_loading') {
              const jsonPart = parseVnodeJson(data.vnodePartJson);
              const vnodePart = jsonPart ?? data.vnodePart;
              if (vnodePart && vnodePart.length > 0) {
                vnode.push(...vnodePart);
                setVnode(prev => ({ ...prev, [pane]: vnode }));
              }
              setDataLoading(prev => ({ ...prev, [pane]: data.loading ?? '' }));
            } else if (data.progress === 'complete') {
              const jsonVnode = parseVnodeJson(data.vnodeJson);
              const finalVnode = jsonVnode ?? data.vnode ?? vnode;
              setVnode(prev => ({ ...prev, [pane]: finalVnode }));
              setDataLoading(prev => ({ ...prev, [pane]: '' }));
              if (data.tocItems) {
                const prefixedTocItems = applyTocPrefixToItems(data.tocItems, pane);
                setTocItems(prev => ({ ...prev, [pane]: prefixedTocItems }));
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
  }, [fetchLawArticle]);

  // 法令の変更に応じた処理関数
  const processLaw = useCallback((key: "left" | "right", newValue: string | null) => {
    const resolvedLawId = resolveLawId(newValue);
    if (newValue && !resolvedLawId) {
      return;
    }

    // 前回との違いがある場合のみ処理を実行
    if (prevSelectedLaws.current[key] !== resolvedLawId) {
      prevSelectedLaws.current[key] = resolvedLawId; // 新しい値を追跡

      // 表示を「データ取得中」にする処理
      setIsArticleLoaded((prev) => ({ ...prev, [key]: false }));
      setVnode(prev=>({...prev, [key]: null}));

      // lawArticleInit関数の呼び出し
      lawArticleInit(key, resolvedLawId);

      // クエリを更新
      setSearchParams((prevParams) => {
        const updatedParams = new URLSearchParams(prevParams);
        if (resolvedLawId) {
          // 新しい値が存在する場合（クリアではない）
          updatedParams.set(key, resolvedLawId);
        } else {
          // フレームをクリアした場合（値が空の場合、クエリパラメータを削除）
          updatedParams.delete(key);
        }
        return updatedParams;
      });
    }
  }, [lawArticleInit, resolveLawId, setSearchParams]);

  // URLクエリの変更時は、変更があったペインのみ反映する
  useEffect(() => {
    const querySelectedLaws = {
      left: searchParams.get('left') || null,
      right: searchParams.get('right') || null,
    };
    setSelectedLaws((prev) => {
      if (prev.left === querySelectedLaws.left && prev.right === querySelectedLaws.right) {
        return prev;
      }
      return querySelectedLaws;
    });
  }, [searchParams]);

  useEffect(() => {
    if (selectedLaws.right && dividerPos >= 95) {
      setDividerPos(50);
    }
  }, [dividerPos, selectedLaws.right, setDividerPos]);

  useEffect(() => {

    Object.entries(selectedLaws).forEach(([key, value]) => {
      processLaw(key as Pane, value as string | null);
    });  
  }, [processLaw, selectedLaws]);

  useEffect(() => {
    (['left','right'] as Pane[]).forEach((pane)=>{
      const prefixedVnodes = applyTocPrefixToVnodes(vnode[pane], pane);
      const domNode = prefixedVnodes ? renderVNodes(prefixedVnodes) : null;
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
