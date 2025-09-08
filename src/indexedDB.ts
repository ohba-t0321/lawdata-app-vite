import type { LawData, LawArticle } from './LawDataContext'
export const CACHE_EXPIRE_MS:number = 1000 * 60 * 60 * 24; // 24時間

export interface LawListCache {
  id:string,
  data:LawData[],
  timestamp:number,
}

export interface LawDataCache {
  lawNo:string,
  lawArticle:LawArticle,
  timestamp:number,
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("LawCacheDB", 3);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // 既存の "laws" ストアがない場合のみ作成（既にあるときはスキップ）
      if (!db.objectStoreNames.contains("laws")) {
        const store = db.createObjectStore("laws", { keyPath: "lawNo" });
        store.createIndex("lawData", "lawData", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      // 新しい "lawList" ストア（一覧データ用）を追加
      if (!db.objectStoreNames.contains("lawList")) {
        db.createObjectStore("lawList", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLawToCache(lawNo:string, lawArticle:LawArticle) {
  const db = await openDB();
  const tx = db.transaction("laws", "readwrite");
  const store = tx.objectStore("laws");
  lawNo = decodeURIComponent(lawNo);
  const record = {lawNo, lawArticle, timestamp: Date.now() };
  store.put(record);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLawFromCache(lawNo:string) {
  const db = await openDB();
  const tx = db.transaction("laws", "readonly");
  const store = tx.objectStore("laws");
  return new Promise((resolve) => {
    lawNo = decodeURIComponent(lawNo);
    const request = store.get(lawNo);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function saveLawListToCache(lawData: LawData[]) {
  const db = await openDB();
  const tx = db.transaction("lawList", "readwrite");
  const store = tx.objectStore("lawList");
  const record:LawListCache = {id: "LawList", data: lawData, timestamp: Date.now() };
  store.put(record);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getLawListFromCache() {
  const db = await openDB();
  const tx = db.transaction("lawList", "readonly");
  const store = tx.objectStore("lawList");
  return new Promise((resolve) => {
    const request = store.get("LawList");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
