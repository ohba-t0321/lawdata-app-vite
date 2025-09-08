import React, { useState, useContext, useEffect } from 'react';  
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { DividerContext } from '../DiviserContext';
import { LawDataContext, LawArticleContext } from '../LawDataContext'
import type { LawData } from '../LawDataContext';

import './Sidebar.css';

const SearchForm: React.FC = () => {

  const [keyword, setKeyword] = useState('');  
  const [searchType, setSearchType] = useState('includes');  
  const [outputFrame, setOutputFrame] = useState<'left'|'right'>('left');  
  const [isOpen, setIsOpen] = useState(false);  
  const [searchResults, setSearchResults] = useState<any[]>([]);  
  const [isSearching, setIsSearching] = useState(false);  
  
  const { lawData, isDataLoaded } = useContext(LawDataContext);
  const { selectedLaws, setSelectedLaws, isArticleLoaded, setIsArticleLoaded }  = useContext(LawArticleContext)
  const { dividerPos,setDividerPos } = useContext(DividerContext)
  
  function SearchLwaws() {
    if (lawData) {  
      let filteredData: LawData | any[] = [];  
        
      switch (searchType) {  
        case 'includes':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title.includes(keyword)  
          );  
          break;  
        case 'startsWith':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title.startsWith(keyword)  
          );  
          break;  
        case 'equal':  
          filteredData = lawData.filter(data =>   
            data.current_revision_info.law_title === keyword  
          );  
          break;  
      }  
      setSearchResults(filteredData);  
      setIsSearching(false);
    }
  }

  const handleSearch = async (e: React.FormEvent) => {  
    e.preventDefault();  
    setIsSearching(true);
    SearchLwaws()
    setIsSearching(false);
  };  

  useEffect(() => {
    SearchLwaws();
  }, [lawData, keyword, searchType]);

  // const handleLawSelect = async (law: any) => {  
  //   await fetchLawDetails(law.law_info.law_num, outputFrame);  
  // };  
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
            value={keyword}  
            onChange={(e) => setKeyword(e.target.value)}  
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
        </div>  
          {!(isDataLoaded) ? (
            <div>法令データ取得中...</div>
          ) : !(keyword) ? (
            <div>検索ワードを入力してください</div>
          ) : isSearching ? (  
            <div>検索中...</div>
          ) : searchResults.length === 0 && keyword ? (  
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
                    <tr key={row.original.law_info.law_num} onDoubleClick={(e) => {
                      setSelectedLaws({
                        ...selectedLaws,
                        [outputFrame]:row.original.law_info.law_num,
                      });
                      setIsArticleLoaded({
                        ...isArticleLoaded,
                        [outputFrame]:false,
                      });
                      if ((outputFrame==='left'&&dividerPos<50)||(outputFrame==='right'&&dividerPos>50)) {
                        setDividerPos(50);
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