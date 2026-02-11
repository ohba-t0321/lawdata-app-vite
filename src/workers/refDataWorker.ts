import type { WorkerRequest, WorkerResponse } from './lawDataWorker';
import type { VNode } from "../LawDataContext";
import { saveLawToCache, getLawFromCache, getLawListFromCache } from '../indexedDB'
import type { LawDataCache, LawListCache } from "../indexedDB";
import { renderVirtualTree } from './lawDataWorker';
import { extractLawRevisionMarker } from './cacheRevision';
import type { JsonNode } from './lawDataWorker';

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, payload } = e.data;
  if (type !== 'FETCH_REF_DATA') return;
  try {
    const { refItm } = payload;
    const lawId = refItm.lawNum;
    // ステップ1: 基本情報の送信  
    const cachedArticle = await getLawFromCache(lawId);
    const cachedLawList = await getLawListFromCache();
    const listLaw = (cachedLawList as LawListCache)?.data?.find((law) => law?.law_info?.law_num === lawId);
    const expectedRevisionMarker = extractLawRevisionMarker(listLaw);

    let lawArticle: any;
    if (cachedArticle && (!expectedRevisionMarker || (cachedArticle as LawDataCache).lawRevisionMarker === expectedRevisionMarker)) {
      lawArticle = (cachedArticle as LawDataCache).lawArticle;
    } else {
      const res = await fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`);
      lawArticle = await res.json();
      saveLawToCache(lawId, lawArticle, [], extractLawRevisionMarker(lawArticle));
    }
    let refArticle: VNode | null;
    if (lawArticle.law_full_text) {
      refArticle = refArticleData(refItm, lawArticle.law_full_text);
    } else {
      refArticle = null;
    }
    self.postMessage({
      type: 'FETCH_REF_DATA_SUCCESS',
      data: refArticle || '該当条文が見つかりませんでした',
    } as WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: `${type}_ERROR`,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as WorkerResponse);
  }
};

function searchArticle(json: any): any[] {
  const articleList: any[] = [];
  json.children.forEach((item: any) => {
    if (item?.tag === 'Article') {
      articleList.push(item);
    } else if (typeof (item) === 'object' && item.children) {
      let subItem = searchArticle(item);
      if (subItem) {
        subItem.forEach(sub => {
          articleList.push(sub);
        });
      }
    }
  });
  return articleList;
};

function refArticleData(refItm: any, refArticle: JsonNode): any {
  if (refArticle) {
    // 法令データが取得できていれば、該当条文を表示
    let lawBody = refArticle.children?.filter(child => (typeof (child) === 'object') && (child?.tag === 'LawBody'))[0]
    if (typeof (lawBody) === 'object' && lawBody?.children) {
      const refProvision = refItm?.provision=== 'MainProvision' ? 'MainProvision' : 'SupplProvision';
      const refAmendLawNum = (refItm?.provision=== 'MainProvision' || refItm?.provision === 'SupplProvision') ? undefined : refItm?.provision;
      let refLawData = lawBody.children.filter(child => typeof (child) === 'object' && child?.tag === refProvision && child?.attr?.AmendLawNum === refAmendLawNum)[0]
      if (refLawData) {
        let refArticleNode = searchArticle(refLawData).filter(e => e.attr.Num === refItm?.article)[0];
        if (refArticleNode) {
          return renderVirtualTree(refArticleNode, [], [], [], { lawTitleList: [], synonymList: {} }, 'ref');
        } else {
          return null;
        }
      }
    }
  } else {
    return null;
  }
};