import type { LawData } from "../LawDataContext";
import type { WorkerRequest, WorkerResponse } from './lawDataWorker';
import { saveLawListToCache, getLawListFromCache } from '../indexedDB'
import { buildLawListRevisionMarker } from './cacheRevision';
import type { LawListCache } from "../indexedDB";

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type } = e.data;
  try {
		if (type !== 'FETCH_LAW_LIST') return;
		const cached = await getLawListFromCache();
		let data: LawData[] = [];
		let shouldFetch = !(cached && (cached as LawListCache).data);

		if (!shouldFetch) {
			const currentTotalCountRes = await fetch("https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc&limit=1");
			const currentTotalCount = await currentTotalCountRes.json().then((responseData) => responseData.total_count);
			const cachedLawList = cached as LawListCache;
			const cachedMarker = cachedLawList.revisionMarker;
			const cachedData = cachedLawList.data ?? [];

			if (cachedData.length !== currentTotalCount || !cachedMarker) {
				shouldFetch = true;
			} else {
				const computedMarker = buildLawListRevisionMarker(cachedData);
				if (!computedMarker || computedMarker !== cachedMarker) {
					shouldFetch = true;
				}
			}

			if (!shouldFetch) {
				data = cachedData;
			}
		}

		if (shouldFetch) {
			// 法令一覧の取得
			let res = await fetch("https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc&limit=1");
			const total_count = await res.json().then(data => data.total_count);

			if (total_count > 0) {
				res = await fetch(`https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc&limit=${total_count}`);

			}
			const payload = await res.json() as { laws?: LawData[] };
			data = payload.laws ?? [];
			if (data && data.length > 0) {
				const revisionMarker = buildLawListRevisionMarker(data);
				saveLawListToCache(data, revisionMarker);
			}
		}
		self.postMessage({
			type: 'FETCH_LAW_LIST_SUCCESS',
			data: data,
		} as WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: `${type}_ERROR`,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as WorkerResponse);
  }
};