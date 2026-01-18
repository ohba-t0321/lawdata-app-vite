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
  type WorkerSuccessHandler<T = any> = (data: T, message: WorkerResponse) => void;
  type WorkerErrorHandler = (error: string, message: WorkerResponse) => void;
  // 共通的なメッセージ送信関数
  const postMessage = useCallback((worker: Worker, message: WorkerRequest) => {
    worker.postMessage(message);
  }, []);
  
  const handleWorkerMessage = useCallback(
    (onSuccess: WorkerSuccessHandler, onError?: WorkerErrorHandler) =>
      (e: MessageEvent<WorkerResponse>) => {
        const { data, error, type } = e.data;
        if (error || type.endsWith('_ERROR')) {
          if (onError) {
            onError(error ?? 'Unknown error', e.data);
          } else {
            console.error('Worker error:', error ?? 'Unknown error', e.data);
          }
          return;
        }
        onSuccess(data, e.data);
      },
    []
  );
  
  const fetchLawList = useCallback(  
    (callback: (data: any) => void, onError?: WorkerErrorHandler) => {
      listWorkerRef.current = new LawListWorker();
      const worker = listWorkerRef.current;
      worker.onmessage = handleWorkerMessage((data) => callback(data), onError);
      postMessage(worker, { type: 'FETCH_LAW_LIST' });  
    },  
    [handleWorkerMessage, postMessage]  
  );  
  
  const fetchLawArticle = useCallback(  
    (pane:Pane, lawId:any, callback: (data: any) => void, onError?: WorkerErrorHandler) => {
      // pane単位のWorkerを管理
      const oldWorker = articleWorkersRef.current.get(pane);
      if (oldWorker) oldWorker.terminate(); // 前の処理を中断
      const newWorker = new LawArticleWorker();
      articleWorkersRef.current.set(pane, newWorker);

      newWorker.onmessage = handleWorkerMessage((data) => callback(data), onError);
      postMessage(  
        newWorker, { type: 'FETCH_LAW_ARTICLE', payload: { pane, lawId } }
      );  
    },[handleWorkerMessage, postMessage]  
  );  
  
  const fetchRefData = useCallback(  
    ( refItm: any, callback: (data: any) => void, onError?: WorkerErrorHandler) => {  
      if (!refWorkerRef.current) refWorkerRef.current = new RefDataWorker();
      const worker = refWorkerRef.current;
      worker.onmessage = handleWorkerMessage((data) => callback(data), onError);
      postMessage(worker, { type: 'FETCH_REF_DATA', payload: { refItm } });  
    },  
    [handleWorkerMessage, postMessage]  
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
