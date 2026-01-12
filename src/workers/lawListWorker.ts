import type { LawData } from "../LawDataContext";
import { isSameDateInJapan } from './lawDataWorker';
import type { WorkerRequest, WorkerResponse } from './lawDataWorker';
import { saveLawListToCache, getLawListFromCache } from '../indexedDB'
import type { LawListCache } from "../indexedDB";

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type } = e.data;
  try {
		if (type !== 'FETCH_LAW_LIST') return;
		const cached = await getLawListFromCache();
		const now = Date.now();
		let data: LawData[] = [];
		if (cached && isSameDateInJapan(now, (cached as LawListCache).timestamp)) {
			data = (cached as LawListCache).data;
		} else {
			// 法令一覧の取得
			let res = await fetch("https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc&limit=1");
			const total_count = await res.json().then(data => data.total_count);

			if (total_count > 0) {
				res = await fetch(`https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc&limit=${total_count}`);

			}
			data = (await res.json() as any)?.laws;
			if (data && data.length > 0) {
				saveLawListToCache(data);
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