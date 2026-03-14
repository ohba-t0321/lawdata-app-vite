const normalizeLawTitle = (title: string): string =>
  title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ \u3000\t\r\n]/g, '')
    .replace(/[[\]()（）「」『』［］【】・,，.。]/g, '');

const tokenizeLawTitle = (title: string): string[] => {
  const normalized = normalizeLawTitle(title);
  if (!normalized) {
    return [];
  }
  if (normalized.length === 1) {
    return [normalized];
  }

  const tokens: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.push(normalized.slice(index, index + 2));
  }
  return tokens;
};

type TermFrequency = Map<string, number>;

const buildTermFrequency = (tokens: string[]): TermFrequency => {
  const termFrequency = new Map<string, number>();
  tokens.forEach((token) => {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  });
  return termFrequency;
};

interface RankedDocument<T> {
  item: T;
  score: number;
}

/**
 * 日本語タイトルを文字2-gramに分解し、クライアントだけで計算できる簡易BM25で順位付けする。
 */
export const rankByLawTitleSimilarity = <T>(
  queryTitle: string,
  items: readonly T[],
  getDocumentTitle: (item: T) => string,
): RankedDocument<T>[] => {
  const queryTokens = tokenizeLawTitle(queryTitle);
  if (queryTokens.length === 0) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const documents = items.map((item) => {
    const tokens = tokenizeLawTitle(getDocumentTitle(item));
    return {
      item,
      tokens,
      termFrequency: buildTermFrequency(tokens),
    };
  });

  const totalDocuments = documents.length;
  const averageLength = totalDocuments > 0
    ? documents.reduce((sum, document) => sum + document.tokens.length, 0) / totalDocuments
    : 0;

  const documentFrequency = new Map<string, number>();
  documents.forEach((document) => {
    new Set(document.tokens).forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    });
  });

  const k1 = 1.2;
  const b = 0.75;

  return documents.map((document) => {
    const docLength = document.tokens.length || 1;
    let score = 0;

    queryTokens.forEach((token) => {
      const termFrequency = document.termFrequency.get(token) ?? 0;
      if (termFrequency === 0) {
        return;
      }
      const frequency = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (totalDocuments - frequency + 0.5) / (frequency + 0.5));
      const denominator = termFrequency + k1 * (1 - b + b * (docLength / (averageLength || 1)));
      score += idf * ((termFrequency * (k1 + 1)) / denominator);
    });

    return { item: document.item, score };
  });
};
