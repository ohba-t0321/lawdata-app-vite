import React,{ useContext,useMemo } from 'react';
import './LawDataOutput.css';
import { DividerContext } from '../DiviserContext';
import { LawDataContext, LawArticleContext, ReferenceContext } from '../LawDataContext';
import type { LawNode } from '../LawDataContext';
import  { Reference } from './Reference'



const getLawTitle = (json:any):any => {
    if ("law_title" in json) {
        return (<>{json.law_title}</>)
    }
}

const getLawNum = (json:any):any => {
    if ("law_num" in json) {
        return (<>{json.law_num}</>)
    }
}

// Propの型定義
interface LawPaneProps {
  pane: 'left' | 'right'; // 左右の識別子
  width: number; // ペインの幅（パーセント）
}

export const LawPane: React.FC<LawPaneProps> = ({
  pane,
  width,
}) => {
  // 1. タイトル部分の条件を明確化
  const { selectedLaws, vnode, isArticleLoaded, getChildren } = useContext(LawArticleContext);
  const { lawData } = useContext(LawDataContext);
  const isLoaded = isArticleLoaded[pane];
  const isSelected = !!selectedLaws[pane];
  const lawNode = vnode[pane];
  const articleContent = useMemo(()=>isArticleLoaded[pane]&&lawData&&getChildren(pane,lawNode),[isArticleLoaded[pane],vnode]);
  // const title = isLoaded && lawData?.revision_info
  //   ? getLawTitle(lawData.revision_info)
  //   : (!isLoaded && isSelected ? "データ取得中..." : ""); // データ取得中
    // ? getLawTitle(selectedLaws[pane])

  // 2. 法令番号部分の条件を明確化
  // const lawInfo = lawData?.law_info;
  const lawInfo = lawData?.filter((law) => law.law_info.law_num === selectedLaws[pane])[0]?.current_revision_info.law_title;
  const title = isLoaded && lawInfo ? lawInfo : ( !isLoaded && isSelected ? "データ取得中..." : "" ); // データ取得中
  // const lawNum = isLoaded && lawInfo ? getLawNum(lawInfo) : null;
  const lawNum = isLoaded && selectedLaws[pane] ? selectedLaws[pane] : null;
  
  // 3. スタイルの設定
  const paneStyle = { width: `${width}%` };


  return (
    <div className={`pane ${pane}`} style={paneStyle}>
      {/* 共通ロジック：h3 */}
      <h3 className={`law-title ${pane}`}>
        {title}
      </h3>
      
      {/* 共通ロジック：法令番号 */}
      <div className={`law-num ${pane}`}>
        {lawNum ? (
          <>
            <span>（{lawNum}）</span>
          </>
        ) : null}
      </div>
      
      {/* 共通ロジック：本文 */}
      <div className={`law-content ${pane}`}>
        {articleContent}
      </div>
    </div>
  );
};


export const LawDataOutput = () => {
    
    const { dividerPos, setDividerPos} = useContext(DividerContext);
    const { refLinkClick } = useContext(ReferenceContext);
    function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
      e.preventDefault();
      const onMouseMove = (moveEvent: MouseEvent) => {
        const container = document.getElementById("main-container")!;
        const containerRect = container.getBoundingClientRect();
        const offsetX = moveEvent.clientX - containerRect.left;
        const newPos = (offsetX / containerRect.width) * 100;
        if (newPos > 1 && newPos < 99) {
          setDividerPos(newPos)
        }
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

  return (
    <div className="main-content">
      {/* Main content goes here */}
      <div className="headline">
        <p>このアプリは<a href="https://elaws.e-gov.go.jp/docs/law-data-basic/8529371-law-api-v1/">法令API</a>を利用して法令を検索しています。
        法令を検索した後に該当する条文を右クリックすると、その条のテキストをクリップボードにコピーできます。</p>
      </div>
      <div className="law-data-output" id="main-container" onClick={refLinkClick}>

      {/* 左ペイン */}
      <LawPane
        pane="left"
        width={dividerPos}
      />
      
      {/* 仕切り（Divider） */}
      <div className="divider" onMouseDown={handleMouseDown} />
      
      {/* 右ペイン */}
      <LawPane
        pane="right"
        width={100 - dividerPos}
      />
      </div>
      <Reference />
    </div>
  );
}
