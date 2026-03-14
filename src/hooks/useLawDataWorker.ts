import { useEffect, useRef, useCallback } from 'react';  
import type { WorkerRequest, WorkerResponse } from '../workers/lawDataWorker';  
import type { Pane, RefArticle } from '../LawDataContext';
// 個別Worker
import LawListWorker from '../workers/lawListWorker?worker';
import RefDataWorker from '../workers/refDataWorker?worker';
import LawArticleWorker from '../workers/lawArticleWorker?worker';

export function useLawDataWorker() {  
  const listWorkerRef = useRef<Worker | null>(null);
  const articleWorkersRef = useRef<Map<string, Worker>>(new Map());
  const refWorkerRef = useRef<Worker | null>(null);
  type WorkerSuccessHandler<T = unknown> = (data: T, message: WorkerResponse) => void;
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
    <T = unknown>(callback: (data: T) => void, onError?: WorkerErrorHandler) => {
      listWorkerRef.current = new LawListWorker();
      const worker = listWorkerRef.current;
      worker.onmessage = handleWorkerMessage((data) => callback(data as T), onError);
      postMessage(worker, { type: 'FETCH_LAW_LIST' });  
    },  
    [handleWorkerMessage, postMessage]  
  );  
  
  const fetchLawArticle = useCallback(  
    <T = unknown>(pane: Pane, lawId: string, callback: (data: T) => void, onError?: WorkerErrorHandler) => {
      // pane単位のWorkerを管理
      const oldWorker = articleWorkersRef.current.get(pane);
      if (oldWorker) oldWorker.terminate(); // 前の処理を中断
      const newWorker = new LawArticleWorker();
      articleWorkersRef.current.set(pane, newWorker);

      newWorker.onmessage = handleWorkerMessage((data) => callback(data as T), onError);
      postMessage(  
        newWorker, { type: 'FETCH_LAW_ARTICLE', payload: { pane, lawId } }
      );  
    },[handleWorkerMessage, postMessage]  
  );  
  
  const fetchRefData = useCallback(  
    <T = unknown>(refItm: RefArticle, callback: (data: T) => void, onError?: WorkerErrorHandler) => {  
      refWorkerRef.current?.terminate();
      const worker = new RefDataWorker();
      refWorkerRef.current = worker;
      worker.onmessage = handleWorkerMessage((data) => callback(data as T), onError);
      postMessage(worker, { type: 'FETCH_REF_DATA', payload: { refItm } });  
    },  
    [handleWorkerMessage, postMessage]  
  );

  // クリーンアップ
  useEffect(() => {  
    const articleWorkers = articleWorkersRef.current;
    return () => {
      listWorkerRef.current?.terminate();  
      refWorkerRef.current?.terminate();
      articleWorkers.forEach((worker) => worker.terminate());
      articleWorkers.clear();
    };  
  }, []);

  return {  
    fetchLawList,  
    fetchLawArticle,
    fetchRefData,  
  };  
}
