import type { ArticleIndexEntry, LawData, LawArticle, RefArticle, RefData, VNode, VElement, TocItem } from "../LawDataContext";
import { saveLawToCache, getLawFromCache, getLawListFromCache } from '../indexedDB'
import type { LawListCache, LawDataCache } from "../indexedDB";
import type { WorkerRequest, WorkerResponse, JsonNode } from './lawDataWorker';
import { buildVirtualTree,renderVirtualTree } from './lawDataWorker';
import { extractLawRevisionMarker } from './cacheRevision';

const BASE = import.meta.env.BASE_URL;
const LOCAL_REFDATA_BASE_URL = `${BASE}ref_json`.replace(/\/+$/, '');
const EXTERNAL_REFDATA_BASE_URL = import.meta.env.VITE_REFDATA_BASE_URL?.trim()?.replace(/\/+$/, '') ?? '';
const VNODE_CHUNK_SIZE = 200;

function buildRefDataUrls(lawId: string) {
	const encodedLawId = encodeURIComponent(lawId);
	const urls = [`${LOCAL_REFDATA_BASE_URL}/${encodedLawId}.json`];
	if (EXTERNAL_REFDATA_BASE_URL && EXTERNAL_REFDATA_BASE_URL !== LOCAL_REFDATA_BASE_URL) {
		urls.push(`${EXTERNAL_REFDATA_BASE_URL}/${encodedLawId}.json`);
	}
	return urls;
}

async function fetchRefDataJson(lawId: string): Promise<RefData[]> {
	let lastError: unknown = null;
	for (const url of buildRefDataUrls(lawId)) {
		try {
			const res = await fetch(url);
			if (res.ok) {
				return await res.json() as RefData[];
			}
			lastError = new Error(`HTTP ${res.status}: ${url}`);
		} catch (error) {
			lastError = error;
		}
	}
	if (lastError) {
		console.error("法令参照JSONファイルを取得中にエラーが発生しました:", lastError);
	}
	return [];
}

function flattenNodeText(node: JsonNode | string): string {
	if (typeof node === 'string') {
		return node;
	}
	return (node.children ?? []).map((child) => (
		typeof child === 'string' ? child : flattenNodeText(child)
	)).join('');
}

function normalizePlainText(text: string): string {
	return text
		.replace(/\s+/g, ' ')
		.replace(/\u3000+/g, ' ')
		.trim();
}

function articleReferenceKey(provision: string, article: string): string {
	return `${provision}:${article}`;
}

function articleSourceId(lawNum: string, provision: string, article: string): string {
	return `${lawNum}:${provision}:${article}`;
}

function refArticleKey(item: Pick<RefArticle, 'lawNum' | 'provision' | 'article' | 'paragraph' | 'item'>): string {
	return `${item.lawNum}:${item.provision}:${item.article ?? ''}:${item.paragraph ?? ''}:${item.item ?? ''}`;
}

function collectArticles(node: JsonNode, out: JsonNode[]): void {
	if (node.tag === 'Article') {
		out.push(node);
	}
	(node.children ?? []).forEach((child) => {
		if (isJsonNode(child)) {
			collectArticles(child, out);
		}
	});
}

function buildArticleReferenceMap(refData: RefData[]): Map<string, RefArticle[]> {
	const refsByArticle = new Map<string, RefArticle[]>();
	refData.forEach((item) => {
		const referred = item.referred?.lawArticle;
		const ref = item.ref;
		if (!referred?.provision || !referred.article || !ref?.lawNum || !ref.lawArticle?.provision || !ref.lawArticle.article) {
			return;
		}
		const key = articleReferenceKey(referred.provision, referred.article);
		const nextRef: RefArticle = {
			lawNum: ref.lawNum,
			provision: ref.lawArticle.provision,
			article: ref.lawArticle.article,
			paragraph: ref.lawArticle.paragraph || null,
			item: ref.lawArticle.item || null,
			similarityScore: item.similarityScore ?? null,
		};
		const current = refsByArticle.get(key) ?? [];
		if (!current.some((existing) => refArticleKey(existing) === refArticleKey(nextRef))) {
			current.push(nextRef);
			refsByArticle.set(key, current);
		}
	});
	return refsByArticle;
}

function collectArticleIndex(
	lawId: string,
	lawTitle: string,
	lawArticle: LawArticle,
	refData: RefData[],
): ArticleIndexEntry[] {
	const lawFullText = lawArticle.law_full_text;
	if (!isJsonNode(lawFullText)) return [];
	const lawBody = lawFullText.children?.find((child): child is JsonNode => isJsonNode(child) && child.tag === 'LawBody');
	if (!lawBody?.children) return [];

	const refsByArticle = buildArticleReferenceMap(refData);
	const entries: ArticleIndexEntry[] = [];

	lawBody.children.forEach((part) => {
		if (!isJsonNode(part) || (part.tag !== 'MainProvision' && part.tag !== 'SupplProvision')) {
			return;
		}
		const provision = part.tag === 'MainProvision'
			? 'MainProvision'
			: (typeof part.attr?.AmendLawNum === 'string' && part.attr.AmendLawNum.trim()
				? part.attr.AmendLawNum.trim()
				: 'SupplProvision');
		const articles: JsonNode[] = [];
		collectArticles(part, articles);
		articles.forEach((articleNode) => {
			const articleValue = articleNode.attr?.Num;
			const article = typeof articleValue === 'string' || typeof articleValue === 'number'
				? String(articleValue)
				: '';
			if (!article) {
				return;
			}
			const text = normalizePlainText(flattenNodeText(articleNode));
			if (!text) {
				return;
			}
			entries.push({
				sourceId: articleSourceId(lawId, provision, article),
				lawNum: lawId,
				lawTitle,
				provision,
				article,
				text,
				references: refsByArticle.get(articleReferenceKey(provision, article)) ?? [],
			});
		});
	});

	return entries;
}

function resolveLawTitle(listLaw: LawData | undefined, lawArticle: LawArticle, lawId: string): string {
	const listTitle = listLaw?.current_revision_info?.law_title;
	if (typeof listTitle === 'string' && listTitle.trim()) {
		return listTitle.trim();
	}
	const revisionInfoTitle = lawArticle.revision_info && typeof lawArticle.revision_info === 'object'
		? lawArticle.revision_info['law_title']
		: null;
	if (typeof revisionInfoTitle === 'string' && revisionInfoTitle.trim()) {
		return revisionInfoTitle.trim();
	}
	return lawId;
}

function isJsonNode(node: unknown): node is JsonNode {
	return typeof node === 'object' && node !== null && 'tag' in node && 'children' in node;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
	if (size <= 0) return [arr];
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

function postMessageSafe(message: WorkerResponse, jsonKey?: 'vnodePart' | 'vnode') {
	try {
		self.postMessage(message);
	} catch (error) {
		if (!(error instanceof RangeError) || !jsonKey) throw error;
		const data = (message.data ?? {}) as Record<string, unknown>;
		if (!(jsonKey in data)) throw error;
		let json: string;
		try {
			json = JSON.stringify(data[jsonKey]);
		} catch {
			throw error;
		}
		const nextData: Record<string, unknown> = { ...data, [`${jsonKey}Json`]: json };
		delete nextData[jsonKey];
		self.postMessage({ ...message, data: nextData } as WorkerResponse);
	}
}

function emitVnodeParts(vnodePart: VNode[], loading: string) {
	if (!vnodePart || vnodePart.length === 0) return;
	const chunks = vnodePart.length > VNODE_CHUNK_SIZE ? chunkArray(vnodePart, VNODE_CHUNK_SIZE) : [vnodePart];
	const total = chunks.length;
	chunks.forEach((chunk, chunkIndex) => {
		postMessageSafe({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: {
				vnodePart: chunk,
				loading,
				progress: 'article_data_loading',
				chunkIndex: chunkIndex + 1,
				chunkTotal: total,
			},
		} as WorkerResponse, 'vnodePart');
	});
}

function emitCachedVnode(vnode: VNode[]) {
	if (!vnode || vnode.length === 0) return;
	const chunks = vnode.length > VNODE_CHUNK_SIZE ? chunkArray(vnode, VNODE_CHUNK_SIZE) : [vnode];
	const total = chunks.length;
	chunks.forEach((chunk, chunkIndex) => {
		postMessageSafe({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: {
				vnodePart: chunk,
				loading: `キャッシュ読込(${chunkIndex + 1} / ${total})`,
				progress: 'article_data_loading',
				fromCache: true,
				chunkIndex: chunkIndex + 1,
				chunkTotal: total,
			},
		} as WorkerResponse, 'vnodePart');
	});
}
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, payload } = e.data;

	if (type !== 'FETCH_LAW_ARTICLE') return;
	try {
		// 個別法令データの取得  
		const { pane, lawId } = payload as { pane: 'left' | 'right'; lawId: string };

		// ステップ1: 基本情報の送信  
		const cachedArticle = await getLawFromCache(lawId);
		const cachedLawList = await getLawListFromCache();
		const listLaw = (cachedLawList as LawListCache)?.data?.find((law) => law?.law_info?.law_num === lawId);
		const expectedRevisionMarker = extractLawRevisionMarker(listLaw);

		let lawArticle: LawArticle;
		let vnode: VNode[] = [];
		let articleIndex: ArticleIndexEntry[] = [];
		let tocItems: TocItem[] = [];

		if (cachedArticle && (!expectedRevisionMarker || (cachedArticle as LawDataCache).lawRevisionMarker === expectedRevisionMarker)) {
			lawArticle = (cachedArticle as LawDataCache).lawArticle;
			const cachedVnodeJson = (cachedArticle as LawDataCache).vnodeJson;
			if (cachedVnodeJson) {
				try {
					const parsed = JSON.parse(cachedVnodeJson);
					vnode = Array.isArray(parsed) ? parsed : [];
				} catch (error) {
					console.error("cached vnode JSON parse error:", error);
					vnode = [];
				}
			} else {
				vnode = (cachedArticle as LawDataCache).vnode ?? [];
			}
			const cachedArticleIndexJson = (cachedArticle as LawDataCache).articleIndexJson;
			if (cachedArticleIndexJson) {
				try {
					const parsed = JSON.parse(cachedArticleIndexJson);
					articleIndex = Array.isArray(parsed) ? (parsed as ArticleIndexEntry[]) : [];
				} catch (error) {
					console.error("cached article index JSON parse error:", error);
					articleIndex = [];
				}
			} else {
				articleIndex = (cachedArticle as LawDataCache).articleIndex ?? [];
			}
		} else {
			const res = await fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`);
			lawArticle = await res.json() as LawArticle;
			const lawRevisionMarker = extractLawRevisionMarker(lawArticle);
			saveLawToCache(lawId, lawArticle, [], lawRevisionMarker, []);
		}
		tocItems = buildTocItems(lawArticle);
		const lawTitle = resolveLawTitle(listLaw, lawArticle, lawId);
		// 部分的な結果を送信  
		postMessageSafe({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: { progress: 'basic_data_loaded', tocItems },
		} as WorkerResponse);

		if ((vnode)&&(vnode.length > 0)) {
			emitCachedVnode(vnode);
		}

		// ステップ2: 参照データの取得  
		const needsArticleIndex = articleIndex.length === 0;
		if (vnode.length > 0 && !needsArticleIndex) {
			postMessageSafe({
				type: 'FETCH_LAW_ARTICLE_SUCCESS',
				data: { vnode, articleIndex, progress: 'complete', tocItems },
			} as WorkerResponse);
			return;
		}
		const refData = await fetchRefDataJson(lawId);
		if (needsArticleIndex) {
			articleIndex = collectArticleIndex(lawId, lawTitle, lawArticle, refData);
		}
		if (vnode.length > 0) {
			saveLawToCache(lawId, lawArticle, vnode, extractLawRevisionMarker(lawArticle), articleIndex);
			postMessageSafe({
				type: 'FETCH_LAW_ARTICLE_SUCCESS',
				data: { vnode, articleIndex, progress: 'complete', tocItems },
			} as WorkerResponse);
			return;
		}
		const refLawTitle = await getRefLaw(lawArticle);
		postMessageSafe({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: { refData, refLawTitle, progress: 'reference_data_loaded' },
		} as WorkerResponse);
		// ステップ3: 仮想ツリーの構築（分割可能であれば分割）  
		const lawFullText = lawArticle.law_full_text as JsonNode | null;
		const lawBodyNode = lawFullText?.children?.find((child): child is JsonNode => isJsonNode(child) && child.tag === 'LawBody');
		const lawBody = lawBodyNode?.children ?? [];
		try{
			lawBody.forEach((bodyPart, index: number) => {
				if (!isJsonNode(bodyPart) || !bodyPart.children || bodyPart.tag === 'LawTitle' || bodyPart.tag === 'TOC') {
					return;
				} else if (typeof (bodyPart.children[0]) === 'string') {
						const vnodePart = renderVirtualTree(
						bodyPart,
						[],
						(cachedLawList as LawListCache)?.data,
						refData,
						refLawTitle,
						pane
					);           
					vnode.push(...vnodePart);
					// 途中結果を送信  
					// postMessageSafe({
					//   type: 'FETCH_LAW_ARTICLE_PROGRESS',
					// 	data: { vnodePart, loading: `本則・附則(${index + 1} / ${lawBody.length})`, progress: 'article_data_loading' },
					// } as WorkerResponse, 'vnodePart');
          emitVnodeParts(vnodePart, `本則・附則(${index + 1} / ${lawBody.length})`);
				} else {
					bodyPart.children.forEach((articlePart,articleIndex: number) => {
            if (!isJsonNode(articlePart)) return;
						const vnodePart = renderVirtualTree(
							articlePart,
							[buildVirtualTree(bodyPart) as VElement],
							(cachedLawList as LawListCache)?.data,
							refData,
							refLawTitle,
							pane
						);
						vnode.push(...vnodePart);
            emitVnodeParts(vnodePart, `本則・附則(${index + 1} / ${lawBody.length}) 章(${articleIndex + 1} / ${bodyPart.children.length})`);
					});
				}
			});
		} catch (error) {
			console.error("法令本文の仮想ツリー構築中にエラーが発生しました:", error, "vnode:", vnode);
		}
		saveLawToCache(lawId, lawArticle, vnode, extractLawRevisionMarker(lawArticle), articleIndex);
		// 最終結果を送信  
		postMessageSafe({
			type: 'FETCH_LAW_ARTICLE_SUCCESS',
			data: { vnode, articleIndex, progress: 'complete', tocItems },
		} as WorkerResponse, 'vnode');
		
	} catch (error) {
		self.postMessage({
			type: `${type}_ERROR`,
			error: error instanceof Error ? error.message : 'Unknown error',
		} as WorkerResponse);
	}
};

function searchLawData(json: JsonNode): string[] {
  const lawArticleList: string[] = [];
  if (json.children) {
    json.children.forEach((item) => {
      if (typeof (item) === 'string') {
        lawArticleList.push(item);
      } else if (isJsonNode(item) && item.children) {
        const subItem = searchLawData(item);
        if (subItem) {
          subItem.forEach(sub => {
            lawArticleList.push(sub);
          });
        }
      }
    });
    return lawArticleList;
  } else {
    return [];
  }
};

async function getRefLaw(article: LawArticle) {
  let lawArticleList: string[] = [];
  const cached = await getLawListFromCache();
  const lawData: LawData[] = (cached as LawListCache).data;
  if (isJsonNode(article.law_full_text)) {
    lawArticleList = searchLawData(article.law_full_text);
  }
  const refLaw = new Set<string>();
  const regex = /(?<=（)((?:令和|平成|昭和|大正|明治)[元一二三四五六七八九十]+年(?:法律|政令|(?:[^）]?省令)|内閣府令)第[一二三四五六七八九十百千万]+号)(?:。以下「([^）]*?)」という。)?(?=）)/g;
  const titleAliasRegex = /([^（\n]{2,120}?)（以下「([^」]+?)」という。?）/g;
  const synonym: { [key: string]: string[] } = {};
  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pushSynonym = (lawNum: string, alias: string) => {
    if (!synonym[lawNum]) {
      synonym[lawNum] = [];
    }
    if (!synonym[lawNum].includes(alias)) {
      synonym[lawNum].push(alias);
    }
  };
  lawArticleList.forEach((text) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        refLaw.add(match[1]);
        if (match[2]) {
          pushSynonym(match[1], match[2]);
        }
      }
    };
    while ((match = titleAliasRegex.exec(text)) !== null) {
      const rawName = match[1]?.trim();
      const alias = match[2]?.trim();
      if (!rawName || !alias) continue;
      const matchedLaw = lawData.find((law) => {
        const title = law?.current_revision_info?.law_title;
        return typeof title === 'string' && rawName.endsWith(title);
      });
      const lawNum = matchedLaw?.law_info?.law_num;
      if (typeof lawNum === 'string') {
        refLaw.add(lawNum);
        pushSynonym(lawNum, alias);
      }
    }
  });
  refLaw.forEach(lawNum => {
    /*
    法令の参照では以下の記述となっていることが多いので、正規表現で該当するところを取得した。
    [法令名が初めて現れる場合]：(法令名)（元号○○年法律/政令/...第○号）第○条第○項
    [法令名が初めて現れる場合で、法令を省略する場合](法令名)（元号○○年法律/政令/...第○号。以下「○○法」という。）第○条第○項
    [法令名が2回目以降の場合](法令名もしくは略称名)第○条第○項
    なお、「第○条」のところは「第○条の○」となるケースもあるため、それに対応している
    法律によっては第○条の○条の○…と続くことがあるが、それは対応が難しいので非対応
    */
    const law = lawData?.filter(law => law.law_info?.law_num === lawNum)[0]?.current_revision_info?.law_title;
    if (!law) return;
    const synonymRegex = new RegExp(escapeRegExp(law) + '（以下「(.*?)」という。）', 'g');
    lawArticleList.forEach((text) => {
      let match: RegExpExecArray | null;
      while ((match = synonymRegex.exec(text)) !== null) {
        if (match[1]) {
          if (typeof (lawNum) == 'string') {
            pushSynonym(lawNum, match[1]);
          }
        }
      }
    });
  });

  // refLawはSet型なので、配列に変換して返す
  const refLawList: string[] = Array.from(refLaw);
  const referencedLaws = refLawList
    .map((lawNum) => lawData?.find((law) => law?.law_info?.law_num === lawNum))
    .filter(Boolean);
  const uniqueByType = (aliases: string[], lawType: string) => {
    const matched = referencedLaws.filter((law) => law?.law_info?.law_type === lawType);
    if (matched.length !== 1) return;
    const lawNum = matched[0]?.law_info?.law_num;
    if (typeof lawNum !== 'string') return;
    aliases.forEach((alias) => pushSynonym(lawNum, alias));
  };
  uniqueByType(['同法'], 'Act');
  uniqueByType(['同令', '同政令'], 'CabinetOrder');
  uniqueByType(['同省令'], 'MinisterialOrdinance');
  uniqueByType(['同規則'], 'Rule');

  return { lawTitleList: refLawList, synonymList: synonym };
};

function flattenTocText(children: (JsonNode | string)[]): string {
  return children.map((child) => {
    if (typeof child === 'string') return child;
    if (child?.children) return flattenTocText(child.children);
    return '';
  }).join('');
}

function findTocNode(node: JsonNode | null | undefined): JsonNode | null {
  if (!node) return null;
  if (node.tag === 'TOC') return node;
  if (node.children) {
    for (const child of node.children) {
      if (isJsonNode(child)) {
        const found = findTocNode(child);
        if (found) return found;
      }
    }
  }
  return null;
}

function buildTocItems(lawArticle: LawArticle): TocItem[] {
  const tocItems: TocItem[] = [];
  if (!isJsonNode(lawArticle.law_full_text)) return tocItems;
  const tocNode = findTocNode(lawArticle.law_full_text);
  if (!tocNode?.children) return tocItems;

  tocNode.children.forEach((child) => {
    if (!isJsonNode(child)) return;
    if (child.tag === 'TOCChapter') {
      const chapterNum = child.attr?.Num ?? '';
      const chapterTitleNode = child.children?.find((c): c is JsonNode => isJsonNode(c) && c.tag === 'ChapterTitle');
      let articleRange = '';
      const articleRangeNode = child.children?.find((c): c is JsonNode => isJsonNode(c) && c.tag === 'ArticleRange');
      if (articleRangeNode) {
        articleRange = flattenTocText(articleRangeNode.children ?? []);
      }
      const chapterLabel = chapterTitleNode ? flattenTocText(chapterTitleNode.children ?? []) : '';
      if (chapterLabel) {
        tocItems.push({
          id: `toc-chapter-${chapterNum || chapterLabel}`,
          label: chapterLabel + articleRange,
          depth: 0,
        });
      }
      (child.children ?? []).forEach((section) => {
        if (!isJsonNode(section) || section.tag !== 'TOCSection') return;
        const sectionNum = section.attr?.Num ?? '';
        const sectionTitleNode = section.children?.find((c): c is JsonNode => isJsonNode(c) && c.tag === 'SectionTitle');
        articleRange = '';
        const sectionRangeNode = section.children?.find((c): c is JsonNode => isJsonNode(c) && c.tag === 'ArticleRange');
        if (sectionRangeNode) {
          articleRange = flattenTocText(sectionRangeNode.children ?? []);
        }
        const sectionLabel = sectionTitleNode ? flattenTocText(sectionTitleNode.children ?? []) : '';
        if (sectionLabel) {
          tocItems.push({
            id: `toc-chapter-${chapterNum || '0'}-section-${sectionNum || sectionLabel}`,
            label: sectionLabel + articleRange,
            depth: 1,
          });
        }
      });
    }

    if (child.tag === 'TOCSupplProvision') {
      const labelNode = child.children?.find((c): c is JsonNode => isJsonNode(c) && c.tag === 'SupplProvisionLabel');
      const label = labelNode ? flattenTocText(labelNode.children ?? []) : '附則';
      tocItems.push({
        id: 'toc-suppl-provision',
        label,
        depth: 0,
      });
    }
  });

  return tocItems;
}
