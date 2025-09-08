import { useState } from "react";
import { X, List } from "react-bootstrap-icons";
import "./Sidebar.css";
import SearchForm from "./SearchForm";
import FrameSettings from "./FrameSettings";
import JumpForm from "./JumpForm.tsx";
// import { LawDataProvider, LawArticleProvider } from "../LawDataContext.tsx";
// import { DividerProvider } from "../DiviserContext.tsx";

export default function Sidebar() {

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="sidebar">
        {/* ハンバーガーボタン */}
        <button
          onClick={(e) => {
            setIsExpanded(!isExpanded)
            // クリック後にフォーカスを外す
            e.currentTarget.blur();
          }}
          className="sidebarIconToggle"
        >
          {isExpanded ? (
            <X size={32}/> 
          ) : (
            <List size={32} />
          )}
        </button>

        {/* サイドバー */}
        <div
          className={`sidebarMenu ${isExpanded ? "expanded" : "collapsed"}`}
        >
          <div>
            <SearchForm />
            <FrameSettings />
            <JumpForm />
          </div>
        </div>
    </div>
  );
}
