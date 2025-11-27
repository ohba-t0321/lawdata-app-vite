import { useState,useContext } from 'react';
import './Sidebar.css';
import { DividerContext } from '../DiviserContext';
import { LawArticleContext } from '../LawDataContext';
import { ThemeContext } from '../ThemeContext';
import type { Theme } from '../ThemeContext';

function FrameSettings() {
    // ラジオボタンの設定
    interface RadioButton {
        label: string;
        value: string;
    }

    const [isOpen, setIsOpen] = useState(false);
    const radioButtons: RadioButton[] = [
        { label: '通常', value: 'normal' },
        { label: '薄くする', value: 'colorful' },
        { label: '消去する', value: 'none' }
    ];
    const { selectedLaws, setSelectedLaws, lawArticle, setLawArticle, isArticleLoaded, setIsArticleLoaded } = useContext(LawArticleContext);
    const { setDividerPos } = useContext(DividerContext)
    const { theme,setTheme } = useContext(ThemeContext);

    // フレームのクリアボタンの処理
    function clearFrame (pane:'left'|'right') {
        setLawArticle({
            ...lawArticle,
            [pane]:{law_info:null,revision_info:null,law_full_text:null,attached_files_info:null},
        })
        setSelectedLaws({
            ...selectedLaws,
            [pane]:null,
        })
        setIsArticleLoaded({
            ...isArticleLoaded,
            [pane]:false,
        })
        if (pane === 'right') {
            setDividerPos(99)
        }
    }

    return (
        <div>
            <div onClick={() => setIsOpen(!isOpen)}>
                <span className={`arrow${isOpen ? ' open' : ''}`}>▼</span>フレームの設定
            </div>
            <div className={`content-wrapper${isOpen ? ' open' : ''}`}>
                <div id="clearwindow">
                    フレームのクリア：
                    <button type="button" 
                            className="btn-outline-secondary btn-sm" 
                            id="left-clear" 
                            onClick={()=>clearFrame('left')}
                    >
                        左側
                    </button>
                    <button type="button" 
                            className="btn-outline-secondary btn-sm" 
                            id="right-clear" 
                            onClick={() => {clearFrame('right')}}
                    >
                        右側
                    </button>
                    <fieldset>
                        <legend>カッコ書きの表示方法</legend>
                        <div id="annotationdisplay">
                            {radioButtons.map((radio,idx) => {
                                return (
                                    <label key={idx}>
                                        <input type="radio" id={`annotate_${radio.value}`} value={`${radio.value}`} 
                                            name="annotate" checked={radio.value === theme} onChange={() => setTheme(radio.value as Theme)}/>
                                        {radio.label}
                                    </label>
                                )
                            })}
                        </div>
                    </fieldset>

                </div>
            </div>
        </div>
    )
}

export default FrameSettings;