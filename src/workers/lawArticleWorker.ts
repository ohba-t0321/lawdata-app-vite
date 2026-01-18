import type { LawData, LawArticle, RefData, VNode, VElement } from "../LawDataContext";
import { saveLawToCache, getLawFromCache, getLawListFromCache } from '../indexedDB'
import type { LawListCache, LawDataCache } from "../indexedDB";
import type { WorkerRequest, WorkerResponse } from './lawDataWorker';
import { isSameDateInJapan,buildVirtualTree,renderVirtualTree } from './lawDataWorker';

const BASE = import.meta.env.BASE_URL;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type, payload } = e.data;

	if (type !== 'FETCH_LAW_ARTICLE') return;
	try {
		// 個別法令データの取得  
		const { pane, lawId } = payload;

		// ステップ1: 基本情報の送信  
		const cachedArticle = await getLawFromCache(lawId);
		const now = Date.now();
		let lawArticle: any;
		let vnode: VNode[] = [];

		if (cachedArticle && isSameDateInJapan(now, (cachedArticle as LawDataCache).timestamp)) {
			lawArticle = (cachedArticle as LawDataCache).lawArticle;
			vnode = (cachedArticle as LawDataCache).vnode;
			if (!(vnode)) {
				vnode = [];
			}
		} else {
			const res = await fetch(`https://laws.e-gov.go.jp/api/2/law_data/${lawId}`);
			lawArticle = await res.json();
			saveLawToCache(lawId, lawArticle, []);
		}
		// 部分的な結果を送信  
		self.postMessage({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: { progress: 'basic_data_loaded' },
		} as WorkerResponse);

		// ステップ1-2: vnodeが既にキャッシュにある場合は以降の処理を省略してvnodeをそのまま返却
		if ((vnode)&&(vnode.length > 0)) {
			self.postMessage({
				type: 'FETCH_LAW_ARTICLE_SUCCESS',
				data: { vnode, progress: 'complete' },
			} as WorkerResponse);
			return;
		}
		// ステップ2: 参照データの取得  
		const cachedLawList = await getLawListFromCache();
		let refData: RefData[] = [];
		try {
			const refRes = await fetch(`${BASE}ref_json/${lawId}.json`);
			if (refRes.ok) {
				refData = await refRes.json();
			}
		} catch (error) {
			console.error("法令参照JSONファイルを取得中にエラーが発生しました:", error);
		}
		const refLawTitle = await getRefLaw(lawArticle);
		self.postMessage({
			type: 'FETCH_LAW_ARTICLE_PROGRESS',
			data: { refData, refLawTitle, progress: 'reference_data_loaded' },
		} as WorkerResponse);

		// ステップ3: 仮想ツリーの構築（分割可能であれば分割）  
		const lawBody = lawArticle.law_full_text.children.filter((child: any) => child.tag === 'LawBody')[0].children;
		lawBody.forEach((bodyPart: any, index: number) => {
			if (typeof (bodyPart) !== 'object' || !bodyPart.children || bodyPart.tag === 'LawTitle' || bodyPart.tag === 'TOC') {
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
        console.log('vnodePart:', vnodePart);
				// 途中結果を送信  
				self.postMessage({
					type: 'FETCH_LAW_ARTICLE_PROGRESS',
					data: { vnodePart, loading: `本則・附則(${index + 1} / ${lawBody.length})`, progress: 'article_data_loading' },
				} as WorkerResponse);
			} else {
				bodyPart.children.forEach((articlePart: any,articleIndex: number) => {
					const vnodePart = renderVirtualTree(
						articlePart,
						[buildVirtualTree(bodyPart) as VElement],
						(cachedLawList as LawListCache)?.data,
						refData,
						refLawTitle,
						pane
					);
					vnode.push(...vnodePart);
          console.log('vnodePart:', vnodePart);
					// 途中結果を送信  
					self.postMessage({
						type: 'FETCH_LAW_ARTICLE_PROGRESS',
						data: { vnodePart, loading: `本則・附則(${index + 1} / ${lawBody.length})　章(${articleIndex + 1} / ${bodyPart.children.length})`, progress: 'article_data_loading' },
					} as WorkerResponse);
				});
			}
		});
		saveLawToCache(lawId, lawArticle, vnode);

		// 最終結果を送信  
		self.postMessage({
			type: 'FETCH_LAW_ARTICLE_SUCCESS',
			data: { vnode, progress: 'complete' },
		} as WorkerResponse);
		
	} catch (error) {
		self.postMessage({
			type: `${type}_ERROR`,
			error: error instanceof Error ? error.message : 'Unknown error',
		} as WorkerResponse);
	}
};

function searchLawData(json: any): any[] {
  const lawArticleList: any[] = [];
  if (json.children) {
    json.children.forEach((item: any) => {
      if (typeof (item) === 'string') {
        lawArticleList.push(item);
      } else if (typeof (item) === 'object' && item.children) {
        let subItem = searchLawData(item);
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
  let lawArticleList: any[] = [];
  const cached = await getLawListFromCache();
  const lawData: LawData[] = (cached as LawListCache).data;
  if (article.law_full_text) {
    lawArticleList = searchLawData(article.law_full_text);
  }
  const refLaw = new Set<string>();
  const regex = /(?<=（)((?:令和|平成|昭和|大正|明治)[元一二三四五六七八九十]+年(?:法律|政令|(?:[^）]?省令)|内閣府令)第[一二三四五六七八九十百千万]+号)(?:。以下「([^）]*?)」という。)?(?=）)/g;
  const synonym: { [key: string]: string } = {};
  lawArticleList.forEach((text: any) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        refLaw.add(match[1]);
        if (match[2]) {
          synonym[match[1]] = match[2];
        }
      }
    };
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
    const synonymRegex = new RegExp(law + '（以下「(.*?)」という。）', 'g');
    lawArticleList.forEach((text: any) => {
      let match: RegExpExecArray | null;
      while ((match = synonymRegex.exec(text)) !== null) {
        if (match[1]) {
          if (typeof (lawNum) == 'string' && !(synonym[lawNum])) { //附則で改正法令によって上書きしていることがあるため、最初に出てきたものを優先する
            synonym[lawNum] = match[1];
          }
        }
      }
    });
  });

  // refLawはSet型なので、配列に変換して返す
  const refLawList: string[] = Array.from(refLaw);

  return { lawTitleList: refLawList, synonymList: synonym };
};


// function buildVirtualTree(json: JsonNode | string): VNode {
//   if (typeof json === "string") {
//     return { type: "text", value: json };
//   }

//   const tag = json.tag;
//   const attr = normalizeAttrKeys(json.attr ?? {});
//   const children = json.children ?? [];

//   return {
//     type: "element",
//     tag,
//     attr,
//     children: children.map(buildVirtualTree),
//   };
// }

// function renderVirtualTree(json: JsonNode | string, ancestors: VElement[] = [], lawData: LawData[] | null, refData: RefData[] = [], refLawTitle: RefLawTitleList, pane: Pane | 'ref'): VNode[] {
//   const hiddenTags = ["LawTitle", "LawNum", "TOC", "ArticleTitle"]; // 非表示にするタグ名の配列
//   const unwrapTags = ["Law", "LawBody", "ParagraphSentence", "ItemSentence"]; // 中身だけ表示するタグ名の配列

//   // 各タグを対応するReactコンポーネント or HTMLタグにマップ
//   const tagMap: Record<string, string> = {
//     Table: "table",
//     TableRow: "tr",
//     TableColumn: "td",
//   };
//   // 祖先の中から一番近い Article を探す
//   const provisionAncestor = [...ancestors]
//     .reverse()
//     .find(a => a.tag === "MainProvision" || a.tag === "SupplProvision");
//   // 祖先の中から一番近い Article を探す
//   const articleAncestor = [...ancestors]
//     .reverse()
//     .find(a => a.tag === "Article");
//   const paragraphAncestor = [...ancestors]
//     .reverse()
//     .find(a => a.tag === "Paragraph");
//   const itemAncestor = [...ancestors]
//     .reverse()
//     .find(a => subitemNode.includes(a.tag) || a.tag === "Item");
//   const articleNo = articleAncestor?.attr?.num;
//   const paragraphNo = paragraphAncestor?.attr?.num;
//   const itemNo = itemAncestor?.attr?.num;
//   // 直前の親タグを取得
//   const parentNode = ancestors[ancestors.length - 1];

//   const refDataMatch = refData && refData.filter((data: RefData) => data.match !== "★引用個所不明★");
//   if (typeof json === "string") {
//     if (parentNode.tag.includes("Num") || parentNode.tag.includes("Title")) {
//       // Num、Titleを含む直下のテキストノードの場合、後続に全角スペースを追加
//       return [{ type: "text", value: `${json}　` }];
//     };
//     if (json.replace(/\s/g, '') === "附則" && provisionAncestor?.attr?.amendlawnum) {
//       //
//       return [{ type: "text", value: json + "（" + provisionAncestor.attr.amendlawnum + "）" + (provisionAncestor.attr.extract === 'true' ? "　抄" : "") }];
//     }
//     if (pane === 'left' || pane === 'right') {
//       let refTextData: RefData[] | undefined = refDataMatch && refDataMatch.filter((data: RefData) => {
//         return data.match &&
//           data.referred?.lawArticle.provision === (provisionAncestor && !provisionAncestor?.attr?.amendlawnum && provisionAncestor?.tag) &&
//           data.referred?.lawArticle.article === (articleNo || 0).toString() &&
//           data.referred?.lawArticle.paragraph == (paragraphNo || 0).toString() &&
//           data.referred?.lawArticle.item == (itemNo || 0).toString()
//       });
//       const brackets: Record<string, string> = {
//         "（": "）",
//         "「": "」",
//       };
//       let innerHTML = (json: string): string => {
//         // カッコの一致を確認
//         function checkParenthesesBalance(text: string): boolean {
//           const stack = [];
//           for (let char of text) {
//             if (char in brackets) {
//               stack.push(char);
//             } else if ((stack.length > 0) && (char === brackets[stack[stack.length - 1]])) {
//               stack.pop();
//             } else if ((char === "）") || (char === "」")) {
//               return false; // 対応する開きがない場合
//             }
//           }
//           return stack.length === 0; // 最後にスタックが空なら一致している
//         }
//         // カッコの色分け
//         function colorizeParentheses(text: string): string {
//           let depth = 0;
//           return text.replace(/(（|）|「|」)/g, (match) => {
//             if (match === "（" || (match === "「")) {
//               depth++;
//               return `<span class='annotation lv${((depth - 1) % 5) + 1}'>${match}`;
//             } else if ((match === "）") || (match === "」")) {
//               depth--;
//               return `${match}</span>`;
//             }
//             return match;
//           });
//         }
//         if (checkParenthesesBalance(json)) {
//           return colorizeParentheses(json);
//         }
//         return json;
//       }

//       const LinkifyWithLawText = (text: string, refLawTitle: RefLawTitleList | undefined, lawData: LawData[] | undefined): string => {
//         const synonym = refLawTitle?.synonymList;
//         let regex: RegExp

//         refLawTitle?.lawTitleList.forEach(lawNum => {
//           const law = lawData?.filter(law => law.law_info?.law_num === lawNum)[0]?.current_revision_info?.law_title;
//           // 法令名を長い順にソートする
//           regex = new RegExp(
//             '(?:' + law + ((synonym && synonym[lawNum]) ? '|' + synonym[lawNum] : '') + ')'
//             + '(?:（(?:' + lawNum + ')?。?(?:以下「[^「]*?」という。)?）)?(附則)?第([一二三四五六七八九十百千万]+)条(?:の([一二三四五六七八九十百千万]+))?(?:第([一二三四五六七八九十百千万]+)項)?',
//             'g'
//           );
//           text = text.replaceAll(regex, (match, suppl, lawArticleNum, lawArticleSubNum, lawParagraphNum) => {
//             const provision = !(suppl);
//             lawArticleNum = kanjiToNumber(lawArticleNum);
//             lawArticleSubNum = kanjiToNumber(lawArticleSubNum);
//             lawParagraphNum = kanjiToNumber(lawParagraphNum);
//             const lawLink = `data-law-num=${lawNum}${provision ? ' data-provision="MainProvision"' : ' data-provision="SupplProvision"'}${lawArticleNum ? ' data-article=' + lawArticleNum : ''}${lawArticleSubNum ? '_' + lawArticleSubNum : ''}${lawParagraphNum ? ' data-paragraph=' + lawParagraphNum : ''}`
//             return `<span class="refLink" ${lawLink}>${match}</span>`;
//           });
//         });
//         return text;
//       }
//       const LinkifyWithWrap = (text: string, refTextData: RefData[]) => {
//         // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
//         refTextData = Array.from(new Set(refTextData)); // 重複削除
//         refTextData = refTextData.filter(data => data.match && data.match !== "★引用個所不明★"); // マッチするものだけ抽出

//         // マッチするテキストがあるものを先に処理する
//         refTextData.sort((a, b) => {
//           if (a.match && b.match) {
//             return text.indexOf(a.match) - text.indexOf(b.match); // マッチ位置が早い順
//           } else if (a.match) {
//             return -1;
//           } else if (b.match) {
//             return 1;
//           } else {
//             return 0;
//           }
//         });

//         refTextData.forEach((data: RefData) => {
//           if (data.match) {
//             const lawNum = data.ref?.lawNum;
//             const provision = data.ref?.lawArticle.provision;
//             const lawArticleNum = data.ref?.lawArticle.article || '';
//             const lawParagraphNum = data.ref?.lawArticle.paragraph || '';
//             const lawLink = `data-law-num=${lawNum}${provision ? ' data-provision="MainProvision"' : ' data-provision="SupplProvision"'}${lawArticleNum ? ' data-article=' + lawArticleNum : ''}${lawParagraphNum ? ' data-paragraph=' + lawParagraphNum : ''}`

//             text = text.replace(data.match, `<span class="refLink" ${lawLink}>${data.match}</span>`);
//           }
//         });
//         return (text);
//       }
//       return [{ type: "text", value: innerHTML(LinkifyWithWrap(LinkifyWithLawText(json, refLawTitle, lawData ?? undefined), refTextData)) }];
//     }
//     return [{ type: "text", value: json }];
//   }
//   let { tag, attr = {}, children } = json;
//   attr = normalizeAttrKeys(attr ?? {});
//   if (hiddenTags.includes(tag)) {
//     // 非表示タグはレンダリングしない
//     return [];
//   }

//   const mergedTag = tagMap[tag] ?? "span";
//   const provisionNode = tag === 'MainProvision' || tag === 'SupplProvision' ? json : provisionAncestor && provisionAncestor;
//   const dataProvision = provisionNode?.tag === 'MainProvision'
//     ? 'MainProvision'
//     : (provisionNode?.tag === 'SupplProvision'
//       ? (provisionNode.attr?.amendlawnum ?? 'SupplProvision')
//       : undefined);
//   const dataArticle = dataProvision ? `${dataProvision}-${tag === 'Article' ? attr['num'] : articleNo || 0}` : undefined;
//   const dataItem = dataArticle ? `${dataArticle}-${tag === 'Paragrapch' ? attr['num'] : paragraphNo || 0}` : undefined;
//   // 既存のclassNameにtagを追加。data-article、data-paragraphなどの属性はそのまま維持
//   const mergedAttr = {
//     ...attr,
//     className: [`xml-${tag}`, attr.className].filter(Boolean).join(" "),
//     "data-provision": dataProvision,
//     "data-article": dataArticle,
//     "data-item": dataItem,
//     "onContextMenu": tag === "Article" ? "handleRightClick" : undefined,
//   };
//   const renderedChildren = children
//     .flatMap(child => renderVirtualTree(child, [...ancestors, buildVirtualTree(json) as VElement], lawData, refData, refLawTitle, pane))
//     .filter(Boolean);
//   // --- unwrap対象タグなら、自身はスキップして中身だけ出す ---
//   if (unwrapTags.includes(tag)) {
//     return renderedChildren;
//   }
//   // Tableタグの直下にtbodyが含まれていないので手動で追加する
//   if (tag === "Table") {
//     return [{ type: "element", tag: "table", attr: mergedAttr, children: [{ type: "element", tag: "tbody", attr: mergedAttr, children: renderedChildren }] }];
//   }
//   // ParagraphNumタグで子要素が空の場合、第1項とみなして祖先のArticleTitleのテキストを取得して表示する
//   if (tag === "ParagraphNum" && children.length === 0) {
//     let titleText = '';
//     const articleTitle = articleAncestor?.children
//       .filter(child => child?.type === "element" && child?.tag === "ArticleTitle")[0]
//     if (articleTitle?.type === "element") {
//       articleTitle.children.forEach(child => {
//         if (child?.type === "text") {
//           titleText = `${child.value}　`;
//         }
//       });
//       return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: [{ type: "text", value: titleText }] }];
//     }
//   }
//   if (tag === "Paragraph" || tag === "Item") {
//     // ParagraphまたはItemタグの場合、引用条文が存在する場合hrenderdChildrenの前にLinkifyNoMatchコンポーネントを追加する
//     // let refTextData: RefData[] | undefined;
//     let refTextData: RefData[] | undefined = refData && refData.filter((data: RefData) => {
//       return data.match === "★引用個所不明★" &&
//         data.referred?.lawArticle.provision === (provisionAncestor && !provisionAncestor?.attr?.amendlawnum && provisionAncestor?.tag) &&
//         data.referred?.lawArticle.article === (articleNo || 0).toString() &&
//         data.referred?.lawArticle.paragraph == (tag === "Paragraph"? attr?.num : paragraphNo || 0).toString() &&
//         data.referred?.lawArticle.item == (tag === "Item"? attr?.num : 0).toString()
//     });
//     if (refTextData && refTextData.length > 0) {
//       let children: VNode = { type: "text", value: "★引用条文★" };
//       refTextData.forEach((data: RefData) => {
//         const lawLink = { "data-law-num": data.ref?.lawNum, "data-provision": data.ref?.lawArticle.provision, "data-article": data.ref?.lawArticle.article, "data-paragraph": data.ref?.lawArticle.paragraph, "data-item": data.ref?.lawArticle.item };
//         children = { type: "element", tag: "span", attr: { className: "refLink", ...lawLink }, children: [children] };
//       });
//       renderedChildren.push({ type: "element", tag: "span", attr: { className: "refSentence", refTextData: refTextData }, children: [children] });
//     }

//     return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: renderedChildren }];

//   }
//   return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: renderedChildren }];
// }