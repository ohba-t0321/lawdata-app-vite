import type { LawData, LawArticle } from "../LawDataContext";

type RevisionCarrier = {
  current_revision_info?: Record<string, unknown> | null;
  revision_info?: Record<string, unknown> | null;
  law_info?: Record<string, unknown> | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function pickRevisionInfo(source: RevisionCarrier | null | undefined): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null;
  return source.current_revision_info ?? source.revision_info ?? null;
}

export function extractLawRevisionMarker(source: LawData | LawArticle | RevisionCarrier | null | undefined): string | null {
  const revisionInfo = pickRevisionInfo(source);
  const lawRevisionId = asString(revisionInfo?.law_revision_id);
  if (lawRevisionId) {
    return `law_revision_id:${lawRevisionId}`;
  }

  const updated = asString(revisionInfo?.updated);
  if (updated) {
    return `updated:${updated}`;
  }

  const amendmentEnforcementDate = asString(revisionInfo?.amendment_enforcement_date);
  if (amendmentEnforcementDate) {
    return `amendment_enforcement_date:${amendmentEnforcementDate}`;
  }

  const amendmentPromulgateDate = asString(revisionInfo?.amendment_promulgate_date);
  if (amendmentPromulgateDate) {
    return `amendment_promulgate_date:${amendmentPromulgateDate}`;
  }

  return null;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function buildLawListRevisionMarker(laws: LawData[]): string | null {
  if (!laws || laws.length === 0) return null;
  const markers = laws
    .map((law) => {
      const lawId = asString(law?.law_info?.law_id) ?? asString(law?.law_info?.law_num) ?? 'unknown';
      const revisionMarker = extractLawRevisionMarker(law);
      if (!revisionMarker) return null;
      return `${lawId}:${revisionMarker}`;
    })
    .filter((value): value is string => !!value)
    .sort();

  if (markers.length === 0) return null;
  return `count:${laws.length}:hash:${fnv1a(markers.join('|'))}`;
}
