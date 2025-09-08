import React, { useState } from 'react';
import KanjiToNumber from '../assets/KanjiToNumber';

// ラジオボタンの設定
interface RadioButton {
    label: string;
    value: string;
}

const JumpForm = () => {

  const [isOpen, setIsOpen] = useState(false);
  const [jumpArticle, setJumpArticle] = useState('');
  const radioButtons: RadioButton[] = [
    { label: '左側', value: 'left' },
    { label: '右側', value: 'right' }
  ];
  const [selectedRadio, setSelectedRadio] = useState(radioButtons[0].value);
  const changeValue = (e: React.ChangeEvent<HTMLInputElement>) => {
      setSelectedRadio(e.target.value);
  }
  const jumpAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jumpArticle === '') {
        return;
    }
    else {
        let article : string | number | undefined = '';
        // 数字が入力された場合にはそのまま使う
        if (Number(jumpArticle)) {
            article = jumpArticle;
        } else {
            const regex = /第(\d+|[一二三四五六七八九十百千]+)条(の[\d一二三四五六七八九十百千]+)*/g
            let matches : any = [...jumpArticle.matchAll(regex)];
            if (matches[0][1]) {
                article = KanjiToNumber(matches[0][1]);
                if (matches[0][2]) {
                    // 'の'ごとで区切る
                    let subarticle = matches[0][2].split('の').map(KanjiToNumber).join('_');
                    article += subarticle;
                }
            }
        }
        if (article) {
            let frame = document.querySelector(`.pane.${selectedRadio}`);
            if (!frame) {
                console.error(`Frame not found for pane: ${selectedRadio}`);
                return;
            }
            frame.querySelector('[data-article="MainProvision-' + article + '"]')?.scrollIntoView({behavior: "smooth", block: "nearest"});
        }
    }
  }
  
  return (

    <div className="jump-form">
      <div onClick={() => setIsOpen(!isOpen)}>
        <span className={`arrow${isOpen ? ' open' : ''}`}>▼</span>該当条文にジャンプ（本則のみ対応、条文番号は「第○条の○」形式、または算用数字で入力）
    </div>
    <div className={`content-wrapper${isOpen ? ' open' : ''}`}>
      <form onSubmit={jumpAction}>
        {radioButtons.map((radio,idx) => {
          return (
            <label key={idx}>
              <input type="radio" id={`jumpFrame_${radio.value}`} value={`${radio.value}`} 
                name="jumpFrame" checked={radio.value === selectedRadio} onChange={changeValue} />
              {radio.label}
            </label>
          )
        })}
        <input type="text" 
               id="jumpArticle" 
               placeholder="条文番号を入力" 
               className="form-control" 
               aria-describedby="inputGroupPrepend"
               onChange={(e) => setJumpArticle(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" id="jumpButton">ジャンプ</button>
      </form>      
    </div>
  </div>
);
}

export default JumpForm;