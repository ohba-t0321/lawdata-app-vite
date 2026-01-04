import { useEffect, useRef, useCallback } from 'react';  
import type { WorkerRequest, WorkerResponse } from '../workers/lawDataWorker';  
import type { Pane } from '../LawDataContext';
  
export function useLawDataWorker() {  
  const workerRef = useRef<Worker | null>(null);  
  const callbacksRef = useRef<Map<string, (data: any) => void>>(new Map());  
  const requestQueueRef = useRef<Array<{id: string, request: WorkerRequest, callback: (data: any) => void}>>([]);  
  const processingRef = useRef<boolean>(false);  

  // ユニークIDを生成  
  const generateRequestId = () => `${Date.now()}-${Math.random()}`;  
    
  const processQueue = useCallback(() => {  
    // if (processingRef.current || requestQueueRef.current.length === 0) return;  
    if (requestQueueRef.current.length === 0) return;  
    const { id, request, callback } = requestQueueRef.current[0];  
      
    callbacksRef.current.set(id, callback);  
    workerRef.current?.postMessage({ ...request, requestId: id });  
    processingRef.current = true;  
  }, []);  
        
  useEffect(() => {  
    // Viteのworker importを使用  
    workerRef.current = new Worker(  
      new URL('../workers/lawDataWorker.ts', import.meta.url),  
      { type: 'module' }  
    );  
    workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {  
      const { type, data, error, requestId } = e.data;  
      const callback = callbacksRef.current.get(requestId);  
      if (callback) {  
        if (error) {  
          console.error(`Worker error (${type}):`, error);  
        } else {
          if (data !== undefined && callback) {
            callback(data);  
          }  
        }  
        if (type.endsWith('_ERROR')||type.endsWith('_SUCCESS')) {
          // キューから処理済みのリクエストを削除  
          callbacksRef.current.delete(requestId);  
          requestQueueRef.current.shift();  
          processingRef.current = false;  
          // 次のリクエストを処理  
          processQueue();  
        }        
      }
    };    
  
    return () => {  
      workerRef.current?.terminate();  
    };  
  }, [processQueue]);  
  
  const postMessage = useCallback(  
    <T>(request: WorkerRequest, callback: (data: T) => void) => {  
      if (!workerRef.current) {  
        console.error('Worker not initialized');  
        return;  
      }  
  
      const pane = request.payload?.pane;
      // 古いリクエストをキャンセル
      requestQueueRef.current = requestQueueRef.current.filter(
        (req) => req.request.payload?.pane !== pane
      );

      const id = generateRequestId();  
      requestQueueRef.current.push({ id, request, callback });  
      processQueue();  
    },  
    [processQueue]  
  );  
  
  const fetchLawList = useCallback(  
    (callback: (data: any[]) => void) => {  
      postMessage({ type: 'FETCH_LAW_LIST' }, callback);  
    },  
    [postMessage]  
  );  
  
  const fetchLawArticle = useCallback(  
    (pane:Pane, lawId: string, callback: (data: any) => void) => {  
      postMessage(  
        { type: 'FETCH_LAW_ARTICLE', payload: { pane, lawId } },  
        callback  
      );  
    },  
    [postMessage]  
  );  
  
  const fetchRefData = useCallback(  
    ( refItm: any, callback: (data: any) => void) => {  
      postMessage(  
        { type: 'FETCH_REF_DATA', payload: { refItm } },  
        callback  
      );  
    },  
    [postMessage]  
  );  

  return {  
    fetchLawList,  
    fetchLawArticle,
    fetchRefData,  
  };  
}