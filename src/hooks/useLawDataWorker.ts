import { useEffect, useRef, useCallback } from 'react';  
import type { WorkerRequest, WorkerResponse } from '../workers/lawDataWorker';  
import type { Pane } from '../LawDataContext';
  
export function useLawDataWorker() {  
  const workerRef = useRef<Worker | null>(null);  
  const callbacksRef = useRef<Map<string, (data: any) => void>>(new Map());  
  
  useEffect(() => {  
    // Viteのworker importを使用  
    workerRef.current = new Worker(  
      new URL('../workers/lawDataWorker.ts', import.meta.url),  
      { type: 'module' }  
    );  
  
    workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {  
      const { type, data, error } = e.data;  
        
      const callback = callbacksRef.current.get(type);  
      if (callback) {  
        if (error) {  
          console.error(`Worker error (${type}):`, error);  
        } else {  
          callback(data);  
        }  
        callbacksRef.current.delete(type);  
      }  
    };  
  
    return () => {  
      workerRef.current?.terminate();  
    };  
  }, []);  
  
  const postMessage = useCallback(  
    <T>(request: WorkerRequest, callback: (data: T) => void) => {  
      if (!workerRef.current) {  
        console.error('Worker not initialized');  
        return;  
      }  
  
      const responseType = `${request.type}_SUCCESS`;  
      callbacksRef.current.set(responseType, callback);
      workerRef.current.postMessage(request);  
    },  
    []  
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
  
  return {  
    fetchLawList,  
    fetchLawArticle,  
  };  
}