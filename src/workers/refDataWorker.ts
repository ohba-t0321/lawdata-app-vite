import type { WorkerRequest, WorkerResponse } from './lawDataWorker';
import type { LawArticle, RefArticle, VNode } from "../LawDataContext";
import { saveLawToCache, getLawFromCache, getLawListFromCache } from '../indexedDB'
import type { LawDataCache, LawListCache } from "../indexedDB";
import { renderVirtualTree } from './lawDataWorker';
import { extractLawRevisionMarker } from './cacheRevision';
import type { JsonNode } from './lawDataWorker';

function isJsonNode(node: unknown): node is JsonNode {
  return typeof node === 'object' && node !== null && 'tag' in node && 'children' in node;
}

function flattenNodeText(node: JsonNode | string): string {
  if (typeof node === 'string') {
    return node;
  }
  return (node.children ?? []).map((child) => (
    typeof child === 'string' ? child : flattenNodeText(child)
  )).join('');
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, payload } = e.data;
  if (type !== 'FETCH_REF_DATA') return;
  try {
    const { refItm } = payload as { refItm: RefArticle };
    const lawId = refItm.lawNum;
    // ステップ1: 基本情報の送信  
    const cachedArticle = await getLawFromCache(lawId);
    const cachedLawList = await getLawListFromCache();
    const listLaw = (cachedLawList as LawListCache)?.data?.find((law) => law?.law_info?.law_num === lawId);
    const expectedRevisionMarker = extractLawRevisionMarker(listLaw);

    let lawArticle: LawArticle;
    if (cachedArticle && (!expectedRevisionMarker || (cachedArticle as LawDataCache).lawRevisionMarker === expectedRevisionMarker)) {
      lawArticle = (cachedArticle as LawDataCache).lawArticle;
    } else {
      const res = await fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`);
      lawArticle = await res.json() as LawArticle;
      saveLawToCache(lawId, lawArticle, [], extractLawRevisionMarker(lawArticle), []);
    }
    let refArticle: VNode[] | null;
    let refText = '';
    if (isJsonNode(lawArticle.law_full_text)) {
      const resolved = refArticleData(refItm, lawArticle.law_full_text);
      refArticle = resolved?.vnode ?? null;
      refText = resolved?.text ?? '';
    } else {
      refArticle = null;
    }
    self.postMessage({
      type: 'FETCH_REF_DATA_SUCCESS',
      data: { vnode: refArticle, text: refText },
    } as WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: `${type}_ERROR`,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as WorkerResponse);
  }
};

function searchArticle(json: JsonNode): JsonNode[] {
  const articleList: JsonNode[] = [];
  json.children.forEach((item) => {
    if (isJsonNode(item) && item.tag === 'Article') {
      articleList.push(item);
    } else if (isJsonNode(item) && item.children) {
      const subItem = searchArticle(item);
      if (subItem) {
        subItem.forEach(sub => {
          articleList.push(sub);
        });
      }
    }
  });
  return articleList;
}

function refArticleData(refItm: RefArticle, refArticle: JsonNode): { vnode: VNode[] | null; text: string } | null {
  if (refArticle) {
    // 法令データが取得できていれば、該当条文を表示
    const lawBody = refArticle.children?.find((child): child is JsonNode => isJsonNode(child) && child.tag === 'LawBody');
    if (lawBody?.children) {
      const refProvision = refItm?.provision=== 'MainProvision' ? 'MainProvision' : 'SupplProvision';
      const refAmendLawNum = (refItm?.provision=== 'MainProvision' || refItm?.provision === 'SupplProvision') ? undefined : refItm?.provision;
      const refLawData = lawBody.children.find((child): child is JsonNode => isJsonNode(child) && child.tag === refProvision && child.attr?.AmendLawNum === refAmendLawNum);
      if (refLawData) {
        const refArticleNode = searchArticle(refLawData).find(e => e.attr?.Num === refItm?.article);
        if (refArticleNode) {
          return {
            vnode: renderVirtualTree(refArticleNode, [], [], [], { lawTitleList: [], synonymList: {} }, 'ref'),
            text: flattenNodeText(refArticleNode).replace(/\s+/g, ' ').trim(),
          };
        } else {
          return null;
        }
      }
    }
  }
  return null;
}
