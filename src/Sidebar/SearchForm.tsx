import React, { useState, useContext, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { DividerContext } from '../DiviserContext';
import { LawDataContext, LawArticleContext } from '../LawDataContext'
import type { LawData } from '../LawDataContext';

import './Sidebar.css';

const SearchForm: React.FC = () => {

  const [searchParams, setSearchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') || '';
  const [inputKeyword, setInputKeyword] = useState(initialKeyword);
  const [searchType, setSearchType] = useState('includes');  
  const [outputFrame, setOutputFrame] = useState<'left'|'right'>('left');  
  const [isFrameFixed, setIsFrameFixed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);  
  const [searchResults, setSearchResults] = useState<any[]>([]);  
  const [isSearching, setIsSearching] = useState(false);  
  
  const { lawData, isDataLoaded } = useContext(LawDataContext);
  const { selectedLaws, setSelectedLaws, isArticleLoaded, setIsArticleLoaded }  = useContext(LawArticleContext)
  const { dividerPos,setDividerPos } = useContext(DividerContext)
  
  function SearchLwaws(searchKeyword = inputKeyword) {
    if (lawData) {  
      let filteredData: LawData | any[] = [];  
        
      switch (searchType) {  
        case 'includes':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title.includes(searchKeyword)  
          );  
          break;  
        case 'startsWith':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title.startsWith(searchKeyword)  
          );  
          break;  
        case 'equal':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title === searchKeyword  
          );  
          break;  
      }  
      setSearchResults(filteredData);  
      setIsSearching(false);
    }
  }

  const commitKeyword = (nextKeyword: string) => {
    setInputKeyword(nextKeyword);
    setSearchParams((prevParams) => {
      const updatedParams = new URLSearchParams(prevParams);
      if (nextKeyword) {
        updatedParams.set('keyword', nextKeyword);
      } else {
        updatedParams.delete('keyword');
      }
      return updatedParams;
    });
  };

  const handleSearch = async (e: React.FormEvent) => {  
    e.preventDefault();  
    setIsSearching(true);
    commitKeyword(inputKeyword);
    SearchLwaws(inputKeyword)
    setIsSearching(false);
  };  

  // useEffect(() => {
  //   SearchLwaws();
  // }, [lawData, inputKeyword, searchType]);

  useEffect(() => {
    const paramsKeyword = searchParams.get('keyword') ?? '';
    setInputKeyword((prev) => (prev === paramsKeyword ? prev : paramsKeyword));
  }, [searchParams]);

  const columns: ColumnDef<LawData>[] = [
    {
      header: '法令名',
      accessorKey: 'current_revision_info.law_title',
    }
  ]

  const table = useReactTable<LawData>({
    data: searchResults,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (  
    <div>  
      <div className="toggle-btn" onClick={() => setIsOpen(!isOpen)}>  
        <span className={`arrow${isOpen ? ' open' : ''}`}>▼</span>検索キーワード  
      </div>  
      <div className={`content-wrapper ${isOpen ? 'open' : ''}`}>  
        <form onSubmit={handleSearch}>  
          <input  
            type="text"  
            value={inputKeyword}  
            onChange={(e) => setInputKeyword(e.target.value)}  
            onBlur={() => {
              const paramsKeyword = searchParams.get('keyword') ?? '';
              if (inputKeyword !== paramsKeyword) {
                commitKeyword(inputKeyword);
              }
            }}
            placeholder="キーワードを入力"  
            className="form-control"  
          />  
          検索方法：  
          <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>  
            <option value="includes">～を含む</option>  
            <option value="startsWith">～で始まる</option>  
            <option value="equal">～と一致する</option>  
          </select>  
          <button type="submit" className="btn btn-primary" disabled={!isDataLoaded}>  
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/>
            </svg>
            検索  
          </button>  
        </form>  
          
        <div>  
          出力フレーム:  
          <select value={outputFrame} onChange={(e) => setOutputFrame(e.target.value as 'left' | 'right')}>  
            <option value="left">左</option>  
            <option value="right">右</option>  
          </select>  
          <label>
            <input
              type="checkbox"
              checked={isFrameFixed}
              onChange={(e) => setIsFrameFixed(e.target.checked)}
            />
            フレームを固定
          </label>
        </div>  
          {!(isDataLoaded) ? (
            <div>法令データ取得中...</div>
          ) : !(inputKeyword) ? (
            <div>検索ワードを入力してください</div>
          ) : isSearching ? (  
            <div>検索中...</div>
          ) : searchResults.length === 0 && inputKeyword ? (  
            <div>該当する法令は見つかりませんでした。</div>
          ) : 
          (  
            <div>              
              <p>法令検索結果 (ダブルクリックで法令取得): {searchResults.length} 件</p>
              <table id = "lawTable">
                <thead>
                  {table.getHeaderGroups().map((headerGroup,idx_r) => (
                    <tr key={idx_r}>
                      {headerGroup.headers.map((header,idx_h) => (
                        <th key={idx_h}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map(row => (
                    <tr key={row.original.law_info.law_num+":"+row.original.current_revision_info.law_title} onDoubleClick={(e) => {
                      setSelectedLaws({
                        ...selectedLaws,
                        [outputFrame]:row.original.law_info.law_num,
                      });
                      setIsArticleLoaded({
                        ...isArticleLoaded,
                        [outputFrame]:row.original.law_info.law_num===selectedLaws[outputFrame],
                      });
                      if ((outputFrame==='left'&&dividerPos<50)||(outputFrame==='right'&&dividerPos>50)) {
                        setDividerPos(50);
                      }
                      if (!isFrameFixed) {
                        setOutputFrame(outputFrame === 'left' ? 'right' : 'left');
                      }
                      e.preventDefault();
                      e.currentTarget.blur();
                    }}>
                      {row.getVisibleCells().map((cell,idx_d) => (
                        <td key={idx_d}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          }  
      </div>  
    </div>  
  );  
};  
  
export default SearchForm;

