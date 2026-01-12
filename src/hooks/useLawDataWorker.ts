import { useEffect, useRef, useCallback } from 'react';  
import type { WorkerRequest, WorkerResponse } from '../workers/lawDataWorker';  
import type { Pane } from '../LawDataContext';
// 個別Worker
import LawListWorker from '../workers/lawListWorker?worker';
import RefDataWorker from '../workers/refDataWorker?worker';
import LawArticleWorker from '../workers/lawArticleWorker?worker';

export function useLawDataWorker() {  
  const listWorkerRef = useRef<Worker | null>(null);
  const articleWorkersRef = useRef<Map<string, Worker>>(new Map());
  const refWorkerRef = useRef<Worker | null>(null);
  // 共通的なメッセージ送信関数
  const postMessage = useCallback((worker: Worker, message: WorkerRequest) => {
    worker.postMessage(message);
  }, []);
  
  const fetchLawList = useCallback(  
    (callback: (data: any) => void) => {
      listWorkerRef.current = new LawListWorker();
      const worker = listWorkerRef.current;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => callback(e.data.data);
      postMessage(worker, { type: 'FETCH_LAW_LIST' });  
    },  
    [postMessage]  
  );  
  
  const fetchLawArticle = useCallback(  
    (pane:Pane, lawId:any, callback: (data: any) => void) => {
      // pane単位のWorkerを管理
      const oldWorker = articleWorkersRef.current.get(pane);
      if (oldWorker) oldWorker.terminate(); // 前の処理を中断
      const newWorker = new LawArticleWorker();
      articleWorkersRef.current.set(pane, newWorker);

      newWorker.onmessage = (e: MessageEvent<WorkerResponse>) => callback(e.data.data);
      postMessage(  
        newWorker, { type: 'FETCH_LAW_ARTICLE', payload: { pane, lawId } }
      );  
    },[postMessage]  
  );  
  
  const fetchRefData = useCallback(  
    ( refItm: any, callback: (data: any) => void) => {  
      if (!refWorkerRef.current) refWorkerRef.current = new RefDataWorker();
      const worker = refWorkerRef.current;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => callback(e.data.data);
      postMessage(worker, { type: 'FETCH_REF_DATA', payload: { refItm } });  
    },  
    [postMessage]  
  );

  // クリーンアップ
  useEffect(() => {  
    return () => {
      listWorkerRef.current?.terminate();  
      refWorkerRef.current?.terminate();
      articleWorkersRef.current.forEach((worker) => worker.terminate());
      articleWorkersRef.current.clear();
    };  
  }, []);

  return {  
    fetchLawList,  
    fetchLawArticle,
    fetchRefData,  
  };  
}