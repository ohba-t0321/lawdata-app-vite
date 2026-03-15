import type { LawData, RefData, RefLawTitleList, VNode, VElement, Pane } from "../LawDataContext";
import kanjiToNumber from '../assets/KanjiToNumber'

export type JsonAttrValue = string | number | boolean | null | undefined;
export type JsonAttr = Record<string, JsonAttrValue>;

export interface JsonNode {
  tag: string;
  attr?: JsonAttr;
  children: (JsonNode | string)[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const subitemNode: string[] = []
for (let i = 1; i < 10; i++) {
  subitemNode.push(`Subitem${i}`)
}

export interface WorkerRequest {
  type: 'FETCH_LAW_LIST' | 'FETCH_LAW_ARTICLE' | 'FETCH_REF_DATA';
  payload?: Record<string, unknown>;
}

export interface WorkerResponse {
  type: string;
  data?: unknown;
  error?: string;
}

export function isSameDateInJapan(ts1: number, ts2: number) {
  // 日本時間で日付を比較するため、タイムゾーンを指定してフォーマット
  // ts1とts2はミリ秒単位のタイムスタンプ
  // indexedDBのタイムスタンプが同日だった場合、取得済としてindexedDBから取得する
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };

  const date1 = new Date(ts1).toLocaleDateString('ja-JP', options);
  const date2 = new Date(ts2).toLocaleDateString('ja-JP', options);

  return date1 === date2;
}

function normalizeAttrKeys(attr: JsonAttr): JsonAttr {
  const normalized: JsonAttr = {};
  const specialKeyMap: { [key: string]: string } = {
    rowspan: 'rowSpan',
    colspan: 'colSpan',
    WritingMode: 'writingMode',
  };

  for (const key in attr) {
    if (Object.prototype.hasOwnProperty.call(attr, key)) {
      const lowerKey = key in specialKeyMap ? specialKeyMap[key] : key.toLowerCase();
      normalized[lowerKey] = attr[key];
    }
  }
  return normalized;
}

function formatSimilarityScore(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  const normalized = Math.max(0, Math.min(1, score));
  return normalized.toFixed(6);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}

function buildRefLinkDataset(data: RefData | null | undefined): Record<string, string> {
  const dataset: Record<string, string> = {};
  const ref = data?.ref;
  const lawArticle = ref?.lawArticle;

  if (ref?.lawNum) dataset['data-law-num'] = ref.lawNum;
  if (lawArticle?.provision) dataset['data-provision'] = lawArticle.provision;
  if (lawArticle?.article) dataset['data-article'] = lawArticle.article;
  if (lawArticle?.paragraph) dataset['data-paragraph'] = lawArticle.paragraph;
  if (lawArticle?.item) dataset['data-item'] = lawArticle.item;

  const similarityScore = formatSimilarityScore(data?.similarityScore);
  if (similarityScore) {
    dataset['data-similarity-score'] = similarityScore;
  }

  return dataset;
}

function buildRefLinkAttrString(data: RefData | null | undefined): string {
  return Object.entries(buildRefLinkDataset(data))
    .map(([key, value]) => `${key}="${escapeHtmlAttr(value)}"`)
    .join(' ');
}

function buildRefLinkAttr(data: RefData | null | undefined): JsonAttr {
  const attr: JsonAttr = {};
  Object.entries(buildRefLinkDataset(data)).forEach(([key, value]) => {
    attr[key] = value;
  });
  return attr;
}

export function buildVirtualTree(json: JsonNode | string): VNode {
  if (typeof json === "string") {
    return { type: "text", value: json };
  }

  const tag = json.tag;
  const attr = normalizeAttrKeys(json.attr ?? {});
  const children = json.children ?? [];

  return {
    type: "element",
    tag,
    attr,
    children: children.map(buildVirtualTree),
  };
}

export function renderVirtualTree(json: JsonNode | string, ancestors: VElement[] = [], lawData: LawData[] | null, refData: RefData[] = [], refLawTitle: RefLawTitleList, pane: Pane | 'ref'): VNode[] {
  const hiddenTags = ["LawTitle", "LawNum", "TOC", "ArticleTitle"]; // 非表示にするタグ名の配列
  const unwrapTags = ["Law", "LawBody", "ParagraphSentence", "ItemSentence"]; // 中身だけ表示するタグ名の配列

  // 各タグを対応するReactコンポーネント or HTMLタグにマップ
  const tagMap: Record<string, string> = {
    Table: "table",
    TableRow: "tr",
    TableColumn: "td",
  };
  // 祖先の中から一番近い Article を探す
  const provisionAncestor = [...ancestors]
    .reverse()
    .find(a => a.tag === "MainProvision" || a.tag === "SupplProvision");
  // 祖先の中から一番近い Article を探す
  const articleAncestor = [...ancestors]
    .reverse()
    .find(a => a.tag === "Article");
  const chapterAncestor = [...ancestors]
    .reverse()
    .find(a => a.tag === "Chapter");
  const paragraphAncestor = [...ancestors]
    .reverse()
    .find(a => a.tag === "Paragraph");
  const itemAncestor = [...ancestors]
    .reverse()
    .find(a => subitemNode.includes(a.tag) || a.tag === "Item");
  const articleNo = articleAncestor?.attr?.num;
  const paragraphNo = paragraphAncestor?.attr?.num;
  const itemNo = itemAncestor?.attr?.num;
  // 直前の親タグを取得
  const parentNode = ancestors[ancestors.length - 1];

  const refDataMatch = refData && refData.filter((data: RefData) => data.match !== "★引用個所不明★");
  if (typeof json === "string") {
    if (parentNode.tag.includes("Num") || parentNode.tag.includes("Title")) {
      // Num、Titleを含む直下のテキストノードの場合、後続に全角スペースを追加
      return [{ type: "text", value: `${json}` }];
    };
    if (json.replace(/\s/g, '') === "附則" && provisionAncestor?.attr?.amendlawnum) {
      //
      return [{ type: "text", value: json + "（" + provisionAncestor.attr.amendlawnum + "）" + (provisionAncestor.attr.extract === 'true' ? "　抄" : "") }];
    }
    if (pane === 'left' || pane === 'right') {
      const refTextData: RefData[] | undefined = refDataMatch && refDataMatch.filter((data: RefData) => {
        return data.match &&
          data.referred?.lawArticle.provision === (provisionAncestor && !provisionAncestor?.attr?.amendlawnum && provisionAncestor?.tag) &&
          data.referred?.lawArticle.article === (articleNo || 0).toString() &&
          data.referred?.lawArticle.paragraph == (paragraphNo || 0).toString() &&
          data.referred?.lawArticle.item == (itemNo || 0).toString()
      });
      const brackets: Record<string, string> = {
        "（": "）",
        "「": "」",
      };
      const innerHTML = (json: string): string => {
        // カッコの一致を確認
        function checkParenthesesBalance(text: string): boolean {
          const stack = [];
          for (const char of text) {
            if (char in brackets) {
              stack.push(char);
            } else if ((stack.length > 0) && (char === brackets[stack[stack.length - 1]])) {
              stack.pop();
            } else if ((char === "）") || (char === "」")) {
              return false; // 対応する開きがない場合
            }
          }
          return stack.length === 0; // 最後にスタックが空なら一致している
        }
        // カッコの色分け
        function colorizeParentheses(text: string): string {
          let depth = 0;
          return text.replace(/(（|）|「|」)/g, (match) => {
            if (match === "（" || (match === "「")) {
              depth++;
              return `<span class='annotation lv${((depth - 1) % 5) + 1}'>${match}`;
            } else if ((match === "）") || (match === "」")) {
              depth--;
              return `${match}</span>`;
            }
            return match;
          });
        }
        if (checkParenthesesBalance(json)) {
          return colorizeParentheses(json);
        }
        return json;
      }

      const LinkifyWithLawText = (text: string, refLawTitle: RefLawTitleList | undefined, lawData: LawData[] | undefined): string => {
        const synonym = refLawTitle?.synonymList;
        let regex: RegExp

        refLawTitle?.lawTitleList.forEach(lawNum => {
          const law = lawData?.filter(law => law.law_info?.law_num === lawNum)[0]?.current_revision_info?.law_title;
          const aliases = (synonym?.[lawNum] ?? []).filter(Boolean);
          const alternatives = [law, ...aliases]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .map(escapeRegExp);
          if (alternatives.length === 0) return;
          // 法令名を長い順にソートする
          regex = new RegExp(
            '(?:' + alternatives.join('|') + ')'
            + '(?:（(?:' + lawNum + ')?。?(?:以下「[^「]*?」という。)?）)?(附則)?第([一二三四五六七八九十百千万]+)条(?:の([一二三四五六七八九十百千万]+))?(?:第([一二三四五六七八九十百千万]+)項)?',
            'g'
          );
          text = text.replaceAll(regex, (match, suppl, lawArticleNum, lawArticleSubNum, lawParagraphNum) => {
            const provision = !(suppl);
            lawArticleNum = kanjiToNumber(lawArticleNum);
            lawArticleSubNum = kanjiToNumber(lawArticleSubNum);
            lawParagraphNum = kanjiToNumber(lawParagraphNum);
            const lawLink = `data-law-num=${lawNum}${provision ? ' data-provision="MainProvision"' : ' data-provision="SupplProvision"'}${lawArticleNum ? ' data-article=' + lawArticleNum : ''}${lawArticleSubNum ? '_' + lawArticleSubNum : ''}${lawParagraphNum ? ' data-paragraph=' + lawParagraphNum : ''}`
            return `<span class="refLink" ${lawLink}>${match}</span>`;
          });
        });
        return text;
      }
      const LinkifyWithWrap = (text: string, refTextData: RefData[]) => {
        // ノードを文字列化（装飾付きspanでも中のテキストは拾える）
        refTextData = Array.from(new Set(refTextData)); // 重複削除
        refTextData = refTextData.filter(data => data.match && data.match !== "★引用個所不明★"); // マッチするものだけ抽出

        // マッチするテキストがあるものを先に処理する
        refTextData.sort((a, b) => {
          if (a.match && b.match) {
            return text.indexOf(a.match) - text.indexOf(b.match); // マッチ位置が早い順
          } else if (a.match) {
            return -1;
          } else if (b.match) {
            return 1;
          } else {
            return 0;
          }
        });

        refTextData.forEach((data: RefData) => {
          if (data.match) {
            const lawLink = buildRefLinkAttrString(data);

            text = text.replace(data.match, `<span class="refLink" ${lawLink}>${data.match}</span>`);
          }
        });
        return (text);
      }
      return [{ type: "text", value: innerHTML(LinkifyWithWrap(LinkifyWithLawText(json, refLawTitle, lawData ?? undefined), refTextData)) }];
    }
    return [{ type: "text", value: json }];
  }
  const { tag, children } = json;
  const attr = normalizeAttrKeys(json.attr ?? {});
  if (hiddenTags.includes(tag)) {
    // 非表示タグはレンダリングしない
    return [];
  }

  const mergedTag = tagMap[tag] ?? "span";
  const provisionNode = tag === 'MainProvision' || tag === 'SupplProvision' ? json : provisionAncestor && provisionAncestor;
  const dataProvision = provisionNode?.tag === 'MainProvision'
    ? 'MainProvision'
    : (provisionNode?.tag === 'SupplProvision'
      ? (provisionNode.attr?.amendlawnum ?? 'SupplProvision')
      : undefined);
  const dataArticle = dataProvision ? `${dataProvision}-${tag === 'Article' ? attr['num'] : articleNo || 0}` : undefined;
  const dataItem = dataArticle ? `${dataArticle}-${tag === 'Paragrapch' ? attr['num'] : paragraphNo || 0}` : undefined;
  // 既存のclassNameにtagを追加。data-article、data-paragraphなどの属性はそのまま維持
  const chapterId = tag === 'Chapter'
    ? `toc-chapter-${attr?.num ?? ''}`
    : undefined;
  const sectionId = tag === 'Section'
    ? `toc-chapter-${chapterAncestor?.attr?.num ?? '0'}-section-${attr?.num ?? ''}`
    : undefined;
  const supplProvisionId = tag === 'SupplProvision' ? 'toc-suppl-provision' : undefined;
  const mergedAttr = {
    ...attr,
    id: chapterId ?? sectionId ?? supplProvisionId ?? attr.id,
    className: [`xml-${tag}`, attr.className].filter(Boolean).join(" "),
    "data-provision": dataProvision,
    "data-article": dataArticle,
    "data-item": dataItem,
    "onContextMenu": tag === "Article" ? "handleRightClick" : undefined,
  };
  const renderedChildren = children
    .flatMap(child => renderVirtualTree(child, [...ancestors, buildVirtualTree(json) as VElement], lawData, refData, refLawTitle, pane))
    .filter(Boolean);
  // --- unwrap対象タグなら、自身はスキップして中身だけ出す ---
  if (unwrapTags.includes(tag)) {
    return renderedChildren;
  }
  // Tableタグの直下にtbodyが含まれていないので手動で追加する
  if (tag === "Table") {
    return [{ type: "element", tag: "table", attr: mergedAttr, children: [{ type: "element", tag: "tbody", attr: mergedAttr, children: renderedChildren }] }];
  }
  // ParagraphNumタグで子要素が空の場合、第1項とみなして祖先のArticleTitleのテキストを取得して表示する
  if (tag === "ParagraphNum" && children.length === 0) {
    let titleText = '';
    const articleTitle = articleAncestor?.children
      .filter(child => child?.type === "element" && child?.tag === "ArticleTitle")[0]
    if (articleTitle?.type === "element") {
      articleTitle.children.forEach(child => {
        if (child?.type === "text") {
          titleText = `${child.value} `;
        }
      });
      return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: [{ type: "text", value: titleText }] }];
    }
  }
  if (tag === "Paragraph" || tag === "Item") {
    // ParagraphまたはItemタグの場合、引用条文が存在する場合hrenderdChildrenの前にLinkifyNoMatchコンポーネントを追加する
    // let refTextData: RefData[] | undefined;
    const paragraphMatchValue = tag === "Paragraph" ? (attr?.num ?? paragraphNo ?? 0) : (paragraphNo ?? 0);
    const itemMatchValue = tag === "Item" ? (attr?.num ?? 0) : 0;
    const refTextData: RefData[] | undefined = refData && refData.filter((data: RefData) => {
      return data.match === "★引用個所不明★" &&
        data.referred?.lawArticle.provision === (provisionAncestor && !provisionAncestor?.attr?.amendlawnum && provisionAncestor?.tag) &&
        data.referred?.lawArticle.article === (articleNo || 0).toString() &&
        data.referred?.lawArticle.paragraph == String(paragraphMatchValue) &&
        data.referred?.lawArticle.item == String(itemMatchValue)
    });
    if (refTextData && refTextData.length > 0) {
      let children: VNode = { type: "text", value: "★引用条文★" };
      refTextData.forEach((data: RefData) => {
        const lawLink = buildRefLinkAttr(data);
        children = { type: "element", tag: "span", attr: { className: "refLink", ...lawLink }, children: [children] };
      });
      renderedChildren.push({ type: "element", tag: "span", attr: { className: "refSentence", refTextData: refTextData }, children: [children] });
    }

    return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: renderedChildren }];

  }
  return [{ type: "element", tag: mergedTag, attr: mergedAttr, children: renderedChildren }];
}
