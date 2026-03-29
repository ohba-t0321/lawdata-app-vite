import type { ArticleIndexEntry, LawData, LawArticle, VNode } from './LawDataContext'
export interface LawListCache {
  id:string,
  data:LawData[],
  revisionMarker: string | null,
  timestamp:number,
}

export interface LawDataCache {
  lawNo:string,
  lawArticle:LawArticle,
  lawRevisionMarker: string | null,
  vnodeJson?: string,
  articleIndexJson?: string,
  vnode?: VNode[],
  articleIndex?: ArticleIndexEntry[],
  timestamp:number,
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("LawCacheDB", 6);
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

export async function saveLawToCache(
  lawNo:string,
  lawArticle:LawArticle,
  vnode:VNode[],
  lawRevisionMarker: string | null = null,
  articleIndex: ArticleIndexEntry[] = [],
) {
  const db = await openDB();
  const tx = db.transaction("laws", "readwrite");
  const store = tx.objectStore("laws");
  lawNo = decodeURIComponent(lawNo);
  let vnodeJson: string | undefined;
  let articleIndexJson: string | undefined;
  try {
    vnodeJson = JSON.stringify(vnode);
  } catch (error) {
    console.error("vnode JSON stringify error; caching without vnode:", error);
  }
  try {
    articleIndexJson = JSON.stringify(articleIndex);
  } catch (error) {
    console.error("article index JSON stringify error; caching without articleIndex:", error);
  }
  const record: LawDataCache = {lawNo, lawArticle, vnodeJson, articleIndexJson, lawRevisionMarker, timestamp: Date.now() };
  try{
    store.put(record);
  } catch (error) {
    console.error("IndexedDBへの法令データ保存中にエラーが発生しました:", error, "record:", record);
  }
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

export async function saveLawListToCache(lawData: LawData[], revisionMarker: string | null) {
  const db = await openDB();
  const tx = db.transaction("lawList", "readwrite");
  const store = tx.objectStore("lawList");
  const record:LawListCache = {id: "LawList", data: lawData, revisionMarker, timestamp: Date.now() };
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
