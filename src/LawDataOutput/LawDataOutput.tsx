import React,{ useContext,useMemo } from 'react';
import './LawDataOutput.css';
import { DividerContext } from '../DiviserContext';
import { LawArticleContext, ReferenceContext } from '../LawDataContext';
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



export const LawDataOutput = () => {
    
    const { dividerPos, setDividerPos} = useContext(DividerContext);
    const { selectedLaws, lawArticle, isArticleLoaded, getChildren } = useContext(LawArticleContext);
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
    const leftArticle = useMemo(()=>isArticleLoaded.left&&lawArticle.left.law_full_text&&getChildren('left',lawArticle.left.law_full_text as LawNode,null,null,null,null,null),[isArticleLoaded.left,lawArticle.left.law_full_text]);
    const rightArticle = useMemo(()=>isArticleLoaded.right&&lawArticle.right.law_full_text&&getChildren('right',lawArticle.right.law_full_text as LawNode,null,null,null,null,null),[isArticleLoaded.right,lawArticle.right.law_full_text])
  return (
    <div className="main-content">
      {/* Main content goes here */}
      <div className="headline">
        <p>このアプリは<a href="https://elaws.e-gov.go.jp/docs/law-data-basic/8529371-law-api-v1/">法令API</a>を利用して法令を検索しています。
        法令を検索した後に該当する条文を右クリックすると、その条のテキストをクリップボードにコピーできます。</p>
      </div>
      <div className="law-data-output" id="main-container" onClick={refLinkClick}>
        <div className="pane left" style={{ width: `${dividerPos}%` }}>
            <h3 className="law-title left">
              {!isArticleLoaded.left&&selectedLaws.left&&"データ取得中..."}
              {isArticleLoaded.left&&lawArticle.left.revision_info&&getLawTitle(lawArticle.left.revision_info)}
            </h3>
            <div className="law-num left">
              {isArticleLoaded.left&&lawArticle.left.law_info?"（":""}
              <span>{isArticleLoaded.left&&lawArticle.left.law_info&&getLawNum(lawArticle.left.law_info)}</span>
              {isArticleLoaded.left&&lawArticle.left.law_info?"）":""}
            </div>
            <div className="law-content left">
              {leftArticle}
            </div>
        </div>
        <div className="divider" onMouseDown={handleMouseDown} />
        <div className="pane right" style={{ width: `${(100 - dividerPos)}%` }}>
            <h3 className="law-title right">
              {isArticleLoaded.right&&lawArticle.right.revision_info&&getLawTitle(lawArticle.right.revision_info)}
            </h3>
            <div className="law-num right">
              {isArticleLoaded.right&&lawArticle.right.law_info?"（":""}
              <span>{isArticleLoaded.right&&lawArticle.right.law_info&&getLawNum(lawArticle.right.law_info)}</span>
              {isArticleLoaded.right&&lawArticle.right.law_info?"）":""}
            </div>
            <div className="law-content right">
              {rightArticle}
            </div>
        </div>
      </div>
      <Reference />
    </div>
  );
}
