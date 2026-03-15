#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_BASE = 'https://laws.e-gov.go.jp/api/2'
LAW_TYPES = 'Constitution,Act,CabinetOrder,MinisterialOrdinance,Rule,Misc'
MANIFEST_FILE = '_meta.json'
UNKNOWN_MATCH = '★引用個所不明★'
NUM_CHARS = '〇零一二三四五六七八九十百千万元0-9'
ARTICLE_SIMILARITY_WEIGHT = 0.75
CONTEXT_SIMILARITY_WEIGHT = 0.25
LAW_NUM_PATTERN = (
    r'(?:令和|平成|昭和|大正|明治)'
    r'[' + NUM_CHARS + r']+年'
    r'[^）\n]{1,40}?'
    r'第[' + NUM_CHARS + r']+号'
)
CLAUSE_PATTERNS = (
    re.compile(
        r'[^。]*?(?:政令|省令|府令|規則|命令|条例|告示|内閣府令|主務省令)[^。]*?(?:定め|規定)[^。]*'
    ),
    re.compile(r'[^。]*?(?:に規定する|に掲げる|に該当する|をいう|とする|による)[^。]*'),
)
SOURCE_TERM_PATTERNS = (
    re.compile(r'に規定する(?P<term>[^、。()（）「」]{2,80}?)(?:をいう|とする|である|であって|、|。|$)'),
    re.compile(r'に掲げる(?P<term>[^、。()（）「」]{2,80}?)(?:をいう|とする|である|であって|、|。|$)'),
    re.compile(r'に該当する(?P<term>[^、。()（）「」]{2,80}?)(?:をいう|とする|者|もの|場合|、|。|$)'),
)
DEFINED_TERM_PATTERNS = (
    re.compile(r'以下「(?P<term>[^「」]{2,80})」という'),
    re.compile(r'「(?P<term>[^「」]{2,80})」とは'),
    re.compile(r'(?P<term>[^、。()（）「」\s]{2,80})とは'),
    re.compile(r'(?P<term>[^、。()（）「」\s]{2,80})をいう'),
)
MATCH_TERM_PATTERNS = (
    re.compile(r'[^。]*?以下「(?P<term>[^「」]{2,80})」という[^。]*'),
    re.compile(r'[^。]*?「(?P<term>[^「」]{2,80})」とは[^。]*'),
    re.compile(r'[^。]*?(?P<term>[^、。()（）「」\s]{2,80})をいう[^。]*'),
)
GENERIC_TERMS = {
    'もの',
    'こと',
    'とき',
    '場合',
    '者',
    '額',
    '事項',
    '方法',
    '行為',
    '事業',
    '事務',
    '情報',
    '書類',
    '命令',
    '規則',
    '政令',
    '省令',
    '府令',
    '条例',
    '告示',
    '項',
    '号',
    '欄',
    '表',
    '別表',
    '次',
    '前項',
    '前条',
    '同項',
    '同条',
}


class BuildError(RuntimeError):
    pass


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Build ref_json files from e-Gov API payloads.',
    )
    parser.add_argument('--out-dir', default='public/ref_json')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--law-num', action='append', default=[])
    parser.add_argument('--timeout', type=int, default=40)
    parser.add_argument('--retry', type=int, default=3)
    parser.add_argument('--sleep', type=float, default=0.0)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--updated-within-days', type=int, default=7)
    parser.add_argument('--sync-supabase', action='store_true')
    return parser.parse_args(argv)


def fetch_json(url: str, timeout: int, retry: int) -> Any:
    last_error: Optional[Exception] = None
    for attempt in range(1, retry + 1):
        req = Request(
            url,
            headers={
                'Accept': 'application/json',
                'User-Agent': 'lawdata-ref-json-builder/1.0',
            },
        )
        try:
            with urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < retry:
                time.sleep(0.5 * attempt)
    raise BuildError(f'Failed to fetch URL: {url} ({last_error})')


def build_law_list_url(limit: int) -> str:
    qs = urlencode({'law_type': LAW_TYPES, 'limit': str(limit)})
    return f'{API_BASE}/laws?{qs}'


def filter_recent_law_rows(
    law_rows: Sequence[Dict[str, Any]],
    updated_within_days: int,
) -> List[Dict[str, Any]]:
    if updated_within_days <= 0:
        return list(law_rows)
    threshold = datetime.now(timezone.utc) - timedelta(days=updated_within_days)
    return [row for row in law_rows if is_recently_updated(row, threshold)]


def fetch_law_list(
    timeout: int,
    retry: int,
    updated_within_days: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    first = fetch_json(build_law_list_url(1), timeout=timeout, retry=retry)
    total_count = int(first.get('total_count') or 0)
    if total_count <= 0:
        return [], []
    payload = fetch_json(build_law_list_url(total_count), timeout=timeout, retry=retry)
    laws = payload.get('laws')
    law_rows = laws if isinstance(laws, list) else []
    recent_rows = filter_recent_law_rows(law_rows, updated_within_days=updated_within_days)
    return law_rows, recent_rows


def fetch_law_article(law_num: str, timeout: int, retry: int) -> Dict[str, Any]:
    encoded = urlencode({'x': law_num})[2:]
    url = f'{API_BASE}/law_data/{encoded}'
    payload = fetch_json(url, timeout=timeout, retry=retry)
    if not isinstance(payload, dict):
        raise BuildError(f'law_data payload is not an object: {law_num}')
    return payload


def extract_revision_marker(law_row: Dict[str, Any]) -> str:
    revision_info = (
        law_row.get('current_revision_info')
        or law_row.get('revision_info')
        or {}
    )
    candidates = [
        revision_info.get('law_revision_id'),
        revision_info.get('updated'),
        revision_info.get('amendment_enforcement_date'),
        revision_info.get('amendment_promulgate_date'),
    ]
    for candidate in candidates:
        text = str(candidate).strip() if candidate is not None else ''
        if text:
            return text
    return 'unknown'


def normalize_text_for_match(text: str) -> str:
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[「」『』（）()［］\[\]{}【】〈〉《》・,，。．\.\-ー―：:;；]', '', text)
    return text


def normalize_text_for_similarity(text: str) -> str:
    normalized = unicodedata.normalize('NFKC', str(text or '')).lower()
    normalized = re.sub(r'\s+', '', normalized)
    normalized = re.sub(r'[「」『』（）()［］\[\]{}【】〈〉《》・,，。．\.\-ー―：:;；/／]', '', normalized)
    return normalized


def tokenize_char_bigrams(text: str) -> List[str]:
    normalized = normalize_text_for_similarity(text)
    if not normalized:
        return []
    if len(normalized) == 1:
        return [normalized]
    return [
        normalized[index:index + 2]
        for index in range(len(normalized) - 1)
    ]


def build_term_frequency(tokens: Sequence[str]) -> Dict[str, int]:
    term_frequency: Dict[str, int] = {}
    for token in tokens:
        term_frequency[token] = term_frequency.get(token, 0) + 1
    return term_frequency


def cosine_similarity(source_text: str, target_text: str) -> float:
    source_tokens = tokenize_char_bigrams(source_text)
    target_tokens = tokenize_char_bigrams(target_text)
    if not source_tokens or not target_tokens:
        return 0.0

    source_tf = build_term_frequency(source_tokens)
    target_tf = build_term_frequency(target_tokens)
    dot = 0.0
    for token, count in source_tf.items():
        dot += count * target_tf.get(token, 0)

    source_norm = math.sqrt(sum(count * count for count in source_tf.values()))
    target_norm = math.sqrt(sum(count * count for count in target_tf.values()))
    if source_norm == 0.0 or target_norm == 0.0:
        return 0.0

    score = dot / (source_norm * target_norm)
    return max(0.0, min(1.0, score))


def clean_term_candidate(term: str) -> Optional[str]:
    text = str(term).strip()
    if not text:
        return None
    text = text.strip('「」『』（）()[]{}〈〉《》')
    text = re.sub(r'^[\s、,，・]+|[\s、,，・]+$', '', text)
    if not text:
        return None
    normalized = normalize_text_for_match(text)
    if len(normalized) < 2 or len(normalized) > 80:
        return None
    if normalized in GENERIC_TERMS:
        return None
    if not re.search(r'[一-龥ぁ-んァ-ヶA-Za-z0-9]', text):
        return None
    return text


def collect_pattern_terms(text: str, patterns: Sequence[re.Pattern[str]]) -> List[str]:
    terms: List[str] = []
    seen: Set[str] = set()
    for pattern in patterns:
        for match in pattern.finditer(text):
            raw_term = match.groupdict().get('term') or ''
            term = clean_term_candidate(raw_term)
            if not term:
                continue
            key = normalize_text_for_match(term)
            if key in seen:
                continue
            seen.add(key)
            terms.append(term)
    return terms


def extract_reference_terms(text: str) -> List[str]:
    return collect_pattern_terms(text, SOURCE_TERM_PATTERNS)


def extract_defined_terms(text: str) -> List[str]:
    return collect_pattern_terms(text, DEFINED_TERM_PATTERNS)


KANJI_DIGIT = {
    '零': 0,
    '〇': 0,
    '一': 1,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '元': 1,
}
SMALL_UNIT = {'十': 10, '百': 100, '千': 1000}
LARGE_UNIT = {'万': 10_000, '億': 100_000_000, '兆': 1_000_000_000_000}


def parse_under_10000(token: str) -> Optional[int]:
    if token == '':
        return 0
    total = 0
    current = 0
    has_any = False
    for ch in token:
        if ch.isdigit():
            current = current * 10 + int(ch)
            has_any = True
            continue
        if ch in KANJI_DIGIT:
            current = current * 10 + KANJI_DIGIT[ch]
            has_any = True
            continue
        if ch in SMALL_UNIT:
            has_any = True
            unit_value = SMALL_UNIT[ch]
            total += (current if current > 0 else 1) * unit_value
            current = 0
            continue
        return None
    if not has_any:
        return None
    return total + current


def japanese_number_to_int(token: Optional[str]) -> Optional[int]:
    if token is None:
        return None
    text = str(token).strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)

    total = 0
    chunk = ''
    for ch in text:
        if ch in LARGE_UNIT:
            chunk_value = parse_under_10000(chunk) if chunk else 1
            if chunk_value is None:
                return None
            total += chunk_value * LARGE_UNIT[ch]
            chunk = ''
        else:
            chunk += ch
    tail_value = parse_under_10000(chunk)
    if tail_value is None:
        return None
    total += tail_value
    return total


def to_number_str(token: Optional[str], default: str = '0') -> str:
    parsed = japanese_number_to_int(token)
    if parsed is None:
        return default
    return str(parsed)


def is_node(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get('tag'), str) and isinstance(value.get('children'), list)


def flatten_text(node: Any) -> str:
    if isinstance(node, str):
        return node
    if not is_node(node):
        return ''
    parts: List[str] = []
    for child in node.get('children', []):
        parts.append(flatten_text(child))
    return ''.join(parts)


@dataclass(frozen=True)
class Segment:
    provision_base: str
    provision_key: str
    article: str
    paragraph: str
    item: str
    text: str


@dataclass
class TraverseContext:
    provision_base: str = 'MainProvision'
    provision_key: str = 'MainProvision'
    article: str = '0'
    paragraph: str = '0'
    item: str = '0'


def normalize_attr_num(raw: Any, default: str = '0') -> str:
    if raw is None:
        return default
    token = str(raw).strip()
    if token == '':
        return default
    if '_' in token:
        left, right = token.split('_', 1)
        return f'{to_number_str(left)}_{to_number_str(right)}'
    return to_number_str(token, default=default)


def collect_text_segments(node: Any, ctx: TraverseContext, out: List[Segment]) -> None:
    if isinstance(node, str):
        text = node.strip()
        if text:
            out.append(
                Segment(
                    provision_base=ctx.provision_base,
                    provision_key=ctx.provision_key,
                    article=ctx.article,
                    paragraph=ctx.paragraph,
                    item=ctx.item,
                    text=text,
                )
            )
        return
    if not is_node(node):
        return

    tag = node.get('tag')
    attr = node.get('attr') if isinstance(node.get('attr'), dict) else {}

    next_ctx = TraverseContext(
        provision_base=ctx.provision_base,
        provision_key=ctx.provision_key,
        article=ctx.article,
        paragraph=ctx.paragraph,
        item=ctx.item,
    )

    if tag == 'MainProvision':
        next_ctx.provision_base = 'MainProvision'
        next_ctx.provision_key = 'MainProvision'
        next_ctx.article = '0'
        next_ctx.paragraph = '0'
        next_ctx.item = '0'
    elif tag == 'SupplProvision':
        amend = str(attr.get('AmendLawNum') or '').strip()
        next_ctx.provision_base = 'SupplProvision'
        next_ctx.provision_key = amend if amend else 'SupplProvision'
        next_ctx.article = '0'
        next_ctx.paragraph = '0'
        next_ctx.item = '0'
    elif tag == 'Article':
        next_ctx.article = normalize_attr_num(attr.get('Num'))
        next_ctx.paragraph = '0'
        next_ctx.item = '0'
    elif tag == 'Paragraph':
        next_ctx.paragraph = normalize_attr_num(attr.get('Num'))
        next_ctx.item = '0'
    elif tag == 'Item':
        next_ctx.item = normalize_attr_num(attr.get('Num'))

    for child in node.get('children', []):
        collect_text_segments(child, next_ctx, out)


def collect_articles(node: Any, out: List[Dict[str, Any]]) -> None:
    if not is_node(node):
        return
    if node.get('tag') == 'Article':
        out.append(node)
    for child in node.get('children', []):
        collect_articles(child, out)


@dataclass(frozen=True)
class DefinitionEntry:
    provision: str
    article: str
    text: str


@dataclass
class ArticleLookup:
    main: Dict[str, Tuple[str, str]]
    suppl: Dict[str, List[Tuple[str, str]]]
    definitions: Dict[str, List[DefinitionEntry]]


def build_article_lookup(law_article: Dict[str, Any]) -> ArticleLookup:
    main: Dict[str, Tuple[str, str]] = {}
    suppl: Dict[str, List[Tuple[str, str]]] = {}
    definitions: Dict[str, List[DefinitionEntry]] = {}
    law_full_text = law_article.get('law_full_text')
    if not is_node(law_full_text):
        return ArticleLookup(main=main, suppl=suppl, definitions=definitions)

    law_body = None
    for child in law_full_text.get('children', []):
        if is_node(child) and child.get('tag') == 'LawBody':
            law_body = child
            break
    if not is_node(law_body):
        return ArticleLookup(main=main, suppl=suppl, definitions=definitions)

    for part in law_body.get('children', []):
        if not is_node(part):
            continue
        part_tag = part.get('tag')
        if part_tag not in ('MainProvision', 'SupplProvision'):
            continue

        attr = part.get('attr') if isinstance(part.get('attr'), dict) else {}
        provision_key = 'MainProvision'
        if part_tag == 'SupplProvision':
            amend = str(attr.get('AmendLawNum') or '').strip()
            provision_key = amend if amend else 'SupplProvision'

        articles: List[Dict[str, Any]] = []
        collect_articles(part, articles)
        for article in articles:
            article_attr = article.get('attr') if isinstance(article.get('attr'), dict) else {}
            article_num = normalize_attr_num(article_attr.get('Num'))
            if article_num == '0':
                continue
            text = flatten_text(article).strip()
            if part_tag == 'MainProvision':
                if article_num not in main:
                    main[article_num] = (provision_key, text)
            else:
                suppl.setdefault(article_num, [])
                suppl[article_num].append((provision_key, text))
            for term in extract_defined_terms(text):
                key = normalize_text_for_match(term)
                definitions.setdefault(key, [])
                entry = DefinitionEntry(
                    provision=provision_key,
                    article=article_num,
                    text=text,
                )
                if entry not in definitions[key]:
                    definitions[key].append(entry)

    return ArticleLookup(main=main, suppl=suppl, definitions=definitions)


def resolve_target_article(
    lookup: ArticleLookup,
    provision_guess: str,
    article_num: str,
) -> Optional[Tuple[str, str]]:
    if provision_guess == 'MainProvision':
        if article_num in lookup.main:
            return lookup.main[article_num]
        if article_num in lookup.suppl and lookup.suppl[article_num]:
            return lookup.suppl[article_num][0]
    else:
        if article_num in lookup.suppl and lookup.suppl[article_num]:
            return lookup.suppl[article_num][0]
        if article_num in lookup.main:
            return lookup.main[article_num]
    return None


def resolve_article_text(
    lookup: ArticleLookup,
    provision_key: str,
    article_num: str,
) -> str:
    if article_num == '0':
        return ''
    if provision_key == 'MainProvision':
        entry = lookup.main.get(article_num)
        if entry is not None:
            return entry[1]
    else:
        suppl_entries = lookup.suppl.get(article_num) or []
        for candidate_provision, text in suppl_entries:
            if candidate_provision == provision_key:
                return text
        if provision_key == 'SupplProvision' and suppl_entries:
            return suppl_entries[0][1]

    entry = lookup.main.get(article_num)
    if entry is not None:
        return entry[1]
    suppl_entries = lookup.suppl.get(article_num) or []
    if suppl_entries:
        return suppl_entries[0][1]
    return ''


def compute_similarity_score(
    source_article_text: str,
    source_context_text: str,
    target_article_text: str,
) -> float:
    article_base = source_article_text or source_context_text
    context_base = source_context_text or source_article_text
    if not article_base or not target_article_text:
        return 0.0

    article_similarity = cosine_similarity(article_base, target_article_text)
    context_similarity = cosine_similarity(context_base, target_article_text)
    score = (
        ARTICLE_SIMILARITY_WEIGHT * article_similarity
        + CONTEXT_SIMILARITY_WEIGHT * context_similarity
    )
    return round(max(0.0, min(1.0, score)), 6)


def extract_clauses(text: str) -> List[str]:
    clauses: List[str] = []
    seen: Set[str] = set()
    for pattern in CLAUSE_PATTERNS:
        for match in pattern.finditer(text):
            clause = match.group(0).strip()
            normalized = normalize_text_for_match(clause)
            if not clause or len(normalized) < 4 or normalized in seen:
                continue
            seen.add(normalized)
            clauses.append(clause)
    return clauses


def find_best_match(source_text: str, target_text: str) -> Tuple[str, str]:
    source_terms = extract_reference_terms(source_text)
    target_terms = extract_defined_terms(target_text)
    normalized_target_terms = {
        normalize_text_for_match(term): term
        for term in target_terms
    }
    for term in source_terms:
        normalized_term = normalize_text_for_match(term)
        if not normalized_term:
            continue
        if term in target_text:
            return term, 'definition_term'
        if normalized_term in normalized_target_terms:
            return normalized_target_terms[normalized_term], 'definition_term'
        for pattern in MATCH_TERM_PATTERNS:
            for match in pattern.finditer(target_text):
                candidate = match.group(0).strip()
                if normalized_term in normalize_text_for_match(candidate):
                    return candidate, 'definition_clause'

    source_clauses = extract_clauses(source_text)
    if not source_clauses:
        return UNKNOWN_MATCH, 'unknown'

    target_clauses = extract_clauses(target_text)
    normalized_target = normalize_text_for_match(target_text)
    normalized_target_clauses = {
        normalize_text_for_match(item): item
        for item in target_clauses
    }

    for clause in source_clauses:
        normalized_clause = normalize_text_for_match(clause)
        if len(normalized_clause) < 6:
            continue
        if normalized_clause in normalized_target:
            return clause, 'clause'
        if normalized_clause in normalized_target_clauses:
            return normalized_target_clauses[normalized_clause], 'clause'
        for target_clause_key, target_clause in normalized_target_clauses.items():
            if normalized_clause in target_clause_key or target_clause_key in normalized_clause:
                return target_clause, 'clause'
    return UNKNOWN_MATCH, 'unknown'


def resolve_definition_reference(
    lookup: ArticleLookup,
    source_text: str,
) -> Optional[DefinitionEntry]:
    candidates: Dict[Tuple[str, str], DefinitionEntry] = {}
    for term in extract_reference_terms(source_text):
        key = normalize_text_for_match(term)
        entries = lookup.definitions.get(key) or []
        if len(entries) == 1:
            entry = entries[0]
            candidates[(entry.provision, entry.article)] = entry
            continue

        main_entries = [entry for entry in entries if entry.provision == 'MainProvision']
        unique_main = {
            (entry.provision, entry.article): entry
            for entry in main_entries
        }
        if len(unique_main) == 1:
            entry = next(iter(unique_main.values()))
            candidates[(entry.provision, entry.article)] = entry
    if len(candidates) == 1:
        return next(iter(candidates.values()))
    return None


def split_csv(values: Sequence[str]) -> List[str]:
    out: List[str] = []
    for value in values:
        for item in str(value).split(','):
            item = item.strip()
            if item:
                out.append(item)
    return out


def parse_revision_datetime(raw: Any) -> Optional[datetime]:
    text = str(raw).strip() if raw is not None else ''
    if not text:
        return None

    normalized = text.replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        parsed = None

    if parsed is None:
        for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y%m%d'):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_recently_updated(law_row: Dict[str, Any], threshold: datetime) -> bool:
    current_revision_info = (
        law_row.get('current_revision_info')
        if isinstance(law_row.get('current_revision_info'), dict)
        else {}
    )
    revision_info = law_row.get('revision_info') if isinstance(law_row.get('revision_info'), dict) else {}

    for info in (current_revision_info, revision_info):
        updated_at = parse_revision_datetime(info.get('updated'))
        if updated_at is None:
            updated_at = parse_revision_datetime(info.get('amendment_enforcement_date'))
        if updated_at is None:
            updated_at = parse_revision_datetime(info.get('amendment_promulgate_date'))
        if updated_at is not None and updated_at >= threshold:
            return True
    return False


def load_manifest(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {'laws': {}, 'targets': {}, 'sources': {}}
    try:
        raw = path.read_text(encoding='utf-8')
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return {'laws': {}, 'targets': {}, 'sources': {}}
    if not isinstance(payload, dict):
        return {'laws': {}, 'targets': {}, 'sources': {}}

    laws = payload.get('laws') if isinstance(payload.get('laws'), dict) else {}
    targets = payload.get('targets') if isinstance(payload.get('targets'), dict) else laws
    sources = payload.get('sources') if isinstance(payload.get('sources'), dict) else {}

    payload['targets'] = targets
    payload['laws'] = targets
    payload['sources'] = sources
    return payload


def write_json(path: Path, payload: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        path.write_text(text + '\n', encoding='utf-8')
    except OSError as exc:
        name_bytes = len(path.name.encode('utf-8', errors='ignore'))
        raise BuildError(
            f'Failed to write file: {path} (filename bytes: {name_bytes}) -> {exc}'
        ) from exc


def run_supabase_sync(out_dir: Path) -> None:
    commands = [
        ['node', 'scripts/supabase/apply-migration.mjs'],
        ['node', 'scripts/supabase/replace-law-references-from-ref-json.mjs', '--ref-dir', str(out_dir)],
    ]
    env = dict(os.environ)
    for command in commands:
        try:
            subprocess.run(command, check=True, env=env)
        except FileNotFoundError as exc:
            raise BuildError(f'Command not found while syncing Supabase: {command[0]}') from exc
        except subprocess.CalledProcessError as exc:
            raise BuildError(f'Supabase sync command failed: {" ".join(command)} (exit code {exc.returncode})') from exc


def path_exists_safe(path: Path) -> Tuple[bool, Optional[str]]:
    try:
        return path.exists(), None
    except OSError as exc:
        name_bytes = len(path.name.encode('utf-8', errors='ignore'))
        return False, f'Failed to inspect path: {path} (filename bytes: {name_bytes}) -> {exc}'


def infer_context_aliases(law_title: str, law_type: str) -> Set[str]:
    aliases: Set[str] = set()
    title = law_title.strip()
    law_type = law_type.strip()
    if '法律' in title or law_type == 'Act':
        aliases.add('同法')
    if '政令' in title or law_type == 'CabinetOrder':
        aliases.update({'同令', '同政令'})
    if '内閣府令' in title:
        aliases.update({'同内閣府令', '同府令', '同令'})
    elif '省令' in title or law_type == 'MinisterialOrdinance':
        aliases.add('同省令')
    elif '府令' in title:
        aliases.add('同府令')
    if '規則' in title or law_type == 'Rule':
        aliases.add('同規則')
    if '命令' in title:
        aliases.add('同命令')
    if '条例' in title:
        aliases.add('同条例')
    if '告示' in title:
        aliases.add('同告示')
    return aliases


def make_law_name_indexes(
    law_rows: Sequence[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[str, str]]]:
    by_num: Dict[str, Dict[str, Any]] = {}
    searchable_names: List[Tuple[str, str]] = []
    for row in law_rows:
        law_info = row.get('law_info') if isinstance(row.get('law_info'), dict) else {}
        revision = (
            row.get('current_revision_info')
            if isinstance(row.get('current_revision_info'), dict)
            else {}
        )
        law_num = str(law_info.get('law_num') or '').strip()
        if not law_num:
            continue
        law_type = str(law_info.get('law_type') or '').strip()
        law_title = str(revision.get('law_title') or '').strip()
        abbrev_raw = str(revision.get('abbrev') or '').strip()
        abbrevs = [item.strip() for item in re.split(r'[、,，/／]', abbrev_raw) if item.strip()]
        names: Set[str] = set()
        if law_title:
            names.add(law_title)
        names.add(law_num)
        names.update(abbrevs)
        by_num[law_num] = {
            'law_num': law_num,
            'law_title': law_title,
            'law_type': law_type,
            'names': names,
            'context_aliases': infer_context_aliases(law_title=law_title, law_type=law_type),
            'revision_marker': extract_revision_marker(row),
        }
        for name in names:
            if len(name) >= 2:
                searchable_names.append((name, law_num))
    searchable_names.sort(key=lambda item: len(item[0]), reverse=True)
    return by_num, searchable_names


def resolve_law_name_token(
    token: str,
    name_index: Dict[str, Dict[str, Any]],
) -> Optional[str]:
    raw = str(token).strip()
    if not raw:
        return None

    exact_matches = [
        law_num
        for law_num, info in name_index.items()
        if raw in (info.get('names') or set())
    ]
    if len(exact_matches) == 1:
        return exact_matches[0]

    suffix_candidates: List[Tuple[int, str]] = []
    for law_num, info in name_index.items():
        for name in info.get('names') or set():
            if name and raw.endswith(name):
                suffix_candidates.append((len(name), law_num))
    if not suffix_candidates:
        return None

    max_len = max(length for length, _ in suffix_candidates)
    resolved = {
        law_num
        for length, law_num in suffix_candidates
        if length == max_len
    }
    if len(resolved) == 1:
        return next(iter(resolved))
    return None


def extract_alias_map(full_text: str, name_index: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    alias_by_num: Dict[str, str] = {}
    explicit_law_num = re.compile(
        rf'（(?P<law_num>{LAW_NUM_PATTERN})。?以下「(?P<alias>[^「」]+?)」という。?）'
    )
    explicit_title = re.compile(
        r'(?P<law_name>[^（\n]{2,120}?)（以下「(?P<alias>[^「」]+?)」という。?）'
    )
    for match in explicit_law_num.finditer(full_text):
        law_num = (match.group('law_num') or '').strip()
        alias = (match.group('alias') or '').strip()
        if law_num in name_index and alias and law_num not in alias_by_num:
            alias_by_num[law_num] = alias
    for match in explicit_title.finditer(full_text):
        law_name = (match.group('law_name') or '').strip()
        alias = (match.group('alias') or '').strip()
        law_num = resolve_law_name_token(law_name, name_index)
        if law_num in name_index and alias and law_num not in alias_by_num:
            alias_by_num[law_num] = alias
    return alias_by_num


def find_segment_explicit_mentions(
    text: str,
    candidate_law_nums: Iterable[str],
    law_index: Dict[str, Dict[str, Any]],
    alias_map: Dict[str, str],
) -> List[str]:
    mentions: List[Tuple[int, str]] = []
    for law_num in candidate_law_nums:
        target = law_index.get(law_num)
        if not target:
            continue
        names = set(target.get('names') or set())
        alias = alias_map.get(law_num)
        if alias:
            names.add(alias)
        position = max((text.rfind(name) for name in names if name), default=-1)
        if position >= 0:
            mentions.append((position, law_num))
    mentions.sort()
    return [law_num for _, law_num in mentions]


def build_segment_context_aliases(
    explicit_mentions: Sequence[str],
    recent_aliases: Dict[str, str],
    law_index: Dict[str, Dict[str, Any]],
) -> Dict[str, str]:
    segment_aliases = dict(recent_aliases)
    alias_candidates: Dict[str, Set[str]] = {}
    for law_num in explicit_mentions:
        target = law_index.get(law_num)
        if not target:
            continue
        for alias in target.get('context_aliases') or set():
            alias_candidates.setdefault(alias, set()).add(law_num)
    for alias, law_nums in alias_candidates.items():
        if len(law_nums) == 1:
            segment_aliases[alias] = next(iter(law_nums))
    return segment_aliases


def build_ref_regex(names: Iterable[str], law_num: str) -> Optional[re.Pattern[str]]:
    escaped_names = sorted({re.escape(name) for name in names if name}, key=len, reverse=True)
    if not escaped_names:
        return None
    joined = '|'.join(escaped_names)
    pattern = (
        rf'(?:{joined})'
        rf'(?:（(?:{re.escape(law_num)})?。?(?:以下「[^「」]*?」という。)?）)?'
        rf'(附則)?'
        rf'第([{NUM_CHARS}]+)条'
        rf'(?:の([{NUM_CHARS}]+))?'
        rf'(?:第([{NUM_CHARS}]+)項)?'
        rf'(?:第([{NUM_CHARS}]+)号)?'
    )
    return re.compile(pattern)


def load_ref_rows(path: Path, warnings: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        if warnings is not None:
            warnings.append(f'Failed to load ref rows: {path} -> {exc}')
        return []
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def row_side(row: Dict[str, Any], key: str) -> Dict[str, Any]:
    value = row.get(key)
    return value if isinstance(value, dict) else {}


def row_law_num(row: Dict[str, Any], key: str) -> str:
    return str(row_side(row, key).get('lawNum') or '').strip()


def row_article_fields(row: Dict[str, Any], key: str) -> Dict[str, str]:
    side = row_side(row, key)
    law_article = side.get('lawArticle')
    if not isinstance(law_article, dict):
        return {'provision': '', 'article': '', 'paragraph': '', 'item': ''}
    return {
        'provision': str(law_article.get('provision') or '').strip(),
        'article': str(law_article.get('article') or '').strip(),
        'paragraph': str(law_article.get('paragraph') or '').strip(),
        'item': str(law_article.get('item') or '').strip(),
    }


def ref_row_key(row: Dict[str, Any]) -> Tuple[str, ...]:
    ref_article = row_article_fields(row, 'ref')
    referred_article = row_article_fields(row, 'referred')
    return (
        row_law_num(row, 'referred'),
        referred_article['provision'],
        referred_article['article'],
        referred_article['paragraph'],
        referred_article['item'],
        row_law_num(row, 'ref'),
        ref_article['provision'],
        ref_article['article'],
        ref_article['paragraph'],
        ref_article['item'],
        str(row.get('match') or ''),
        str(row.get('matchType') or ''),
    )


def group_rows_by_target(rows: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        target_law_num = row_law_num(row, 'referred')
        if not target_law_num:
            continue
        grouped.setdefault(target_law_num, []).append(row)
    return grouped


def merge_target_rows(
    existing_rows: Sequence[Dict[str, Any]],
    source_law_num: str,
    replacement_rows: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    deduped: Dict[Tuple[str, ...], Dict[str, Any]] = {}
    for row in existing_rows:
        if row_law_num(row, 'ref') == source_law_num:
            continue
        deduped[ref_row_key(row)] = row
    for row in replacement_rows:
        deduped[ref_row_key(row)] = row
    return [deduped[key] for key in sorted(deduped)]


def read_target_laws_from_source_entry(entry: Any) -> List[str]:
    if not isinstance(entry, dict):
        return []
    raw = entry.get('target_laws')
    if not isinstance(raw, list):
        return []
    return sorted({str(item).strip() for item in raw if str(item).strip()})


def scan_existing_target_laws(
    out_dir: Path,
    source_law_num: str,
    warnings: List[str],
) -> List[str]:
    targets: List[str] = []
    for path in sorted(out_dir.glob('*.json')):
        if path.name == MANIFEST_FILE:
            continue
        rows = load_ref_rows(path, warnings=warnings)
        if any(row_law_num(row, 'ref') == source_law_num for row in rows):
            targets.append(path.stem)
    return targets


def resolve_existing_target_laws(
    out_dir: Path,
    source_law_num: str,
    manifest_sources: Dict[str, Any],
    warnings: List[str],
) -> List[str]:
    entry = manifest_sources.get(source_law_num)
    target_laws = read_target_laws_from_source_entry(entry)
    if target_laws:
        return target_laws
    return scan_existing_target_laws(out_dir, source_law_num, warnings)


def determine_source_targets(
    law_rows: Sequence[Dict[str, Any]],
    law_index: Dict[str, Dict[str, Any]],
    manifest_sources: Dict[str, Any],
    out_dir: Path,
    explicit_law_nums: Sequence[str],
    run_all: bool,
    warnings: List[str],
) -> List[str]:
    if explicit_law_nums:
        targets: List[str] = []
        for law_num in explicit_law_nums:
            if law_num in law_index:
                targets.append(law_num)
        return targets

    if run_all:
        return [row['law_num'] for row in law_index.values()]

    targets = []
    for row in law_rows:
        law_info = row.get('law_info') if isinstance(row.get('law_info'), dict) else {}
        law_num = str(law_info.get('law_num') or '').strip()
        if not law_num:
            continue
        revision_marker = extract_revision_marker(row)
        entry = manifest_sources.get(law_num)
        entry_marker = ''
        if isinstance(entry, dict):
            entry_marker = str(entry.get('revision_marker') or '')

        if not entry_marker:
            targets.append(law_num)
            continue
        if entry_marker and entry_marker != revision_marker:
            targets.append(law_num)
            continue

        for target_law_num in read_target_laws_from_source_entry(entry):
            file_path = out_dir / f'{target_law_num}.json'
            exists, exists_error = path_exists_safe(file_path)
            if exists_error:
                warnings.append(exists_error)
                targets.append(law_num)
                break
            if not exists:
                targets.append(law_num)
                break
    return targets


def build_ref_data_for_law(
    source_law_num: str,
    source_article: Dict[str, Any],
    law_index: Dict[str, Dict[str, Any]],
    searchable_names: Sequence[Tuple[str, str]],
    target_lookup_cache: Dict[str, ArticleLookup],
    timeout: int,
    retry: int,
) -> List[Dict[str, Any]]:
    law_full_text = source_article.get('law_full_text')
    if not is_node(law_full_text):
        return []
    source_lookup = build_article_lookup(source_article)

    segments: List[Segment] = []
    collect_text_segments(law_full_text, TraverseContext(), segments)
    if not segments:
        return []

    full_text = '\n'.join(seg.text for seg in segments)
    alias_map = extract_alias_map(full_text, law_index)

    candidate_law_nums: Set[str] = set()
    for match in re.finditer(LAW_NUM_PATTERN, full_text):
        token = match.group(0).strip()
        if token in law_index:
            candidate_law_nums.add(token)
    for law_num in alias_map:
        if law_num in law_index:
            candidate_law_nums.add(law_num)
    for name, law_num in searchable_names:
        if law_num == source_law_num:
            continue
        if name in full_text:
            candidate_law_nums.add(law_num)

    regex_cache: Dict[Tuple[str, Tuple[str, ...]], re.Pattern[str]] = {}
    rows: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str, str, str, str, str, str, str, str, str, str]] = set()
    recent_aliases: Dict[str, str] = {}
    source_article_text_cache: Dict[Tuple[str, str], str] = {}

    for seg in segments:
        text = seg.text
        if not text:
            continue
        source_cache_key = (seg.provision_key, seg.article)
        if source_cache_key not in source_article_text_cache:
            source_article_text_cache[source_cache_key] = resolve_article_text(
                source_lookup,
                provision_key=seg.provision_key,
                article_num=seg.article,
            )
        source_article_text = source_article_text_cache[source_cache_key]
        explicit_mentions = find_segment_explicit_mentions(
            text=text,
            candidate_law_nums=candidate_law_nums,
            law_index=law_index,
            alias_map=alias_map,
        )
        segment_aliases = build_segment_context_aliases(
            explicit_mentions=explicit_mentions,
            recent_aliases=recent_aliases,
            law_index=law_index,
        )
        for target_law_num in candidate_law_nums:
            if target_law_num == source_law_num:
                continue
            target = law_index.get(target_law_num)
            if not target:
                continue

            names = set(target.get('names') or set())
            alias = alias_map.get(target_law_num)
            if alias:
                names.add(alias)
            for context_alias, resolved_law_num in segment_aliases.items():
                if resolved_law_num == target_law_num:
                    names.add(context_alias)

            if not any(name in text for name in names if name):
                continue

            cache_key = (target_law_num, tuple(sorted(names)))
            if cache_key not in regex_cache:
                regex = build_ref_regex(names, target_law_num)
                if regex is None:
                    continue
                regex_cache[cache_key] = regex
            regex = regex_cache[cache_key]
            matched_locator = False

            for match in regex.finditer(text):
                suppl = match.group(1)
                article_num = to_number_str(match.group(2))
                article_sub_num = to_number_str(match.group(3), default='')
                paragraph_num = to_number_str(match.group(4))
                item_num = to_number_str(match.group(5))
                article_key = article_num if not article_sub_num else f'{article_num}_{article_sub_num}'
                provision_guess = 'SupplProvision' if suppl else 'MainProvision'

                if target_law_num not in target_lookup_cache:
                    target_article = fetch_law_article(target_law_num, timeout=timeout, retry=retry)
                    target_lookup_cache[target_law_num] = build_article_lookup(target_article)
                lookup = target_lookup_cache[target_law_num]
                target_resolved = resolve_target_article(lookup, provision_guess, article_key)
                if target_resolved is None:
                    continue
                target_provision, target_text = target_resolved
                match_text, match_type = find_best_match(text, target_text)
                similarity_score = compute_similarity_score(
                    source_article_text=source_article_text,
                    source_context_text=text,
                    target_article_text=target_text,
                )
                matched_locator = True

                dedupe_key = (
                    source_law_num,
                    seg.provision_base,
                    seg.article,
                    seg.paragraph,
                    seg.item,
                    target_law_num,
                    target_provision,
                    article_key,
                    paragraph_num,
                    item_num,
                    match_text,
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                rows.append(
                    {
                        'ref': {
                            'lawNum': source_law_num,
                            'lawArticle': {
                                'provision': seg.provision_base,
                                'article': seg.article,
                                'paragraph': seg.paragraph,
                                'item': seg.item,
                            },
                        },
                        'referred': {
                            'lawNum': target_law_num,
                            'lawArticle': {
                                'provision': target_provision,
                                'article': article_key,
                                'paragraph': paragraph_num,
                                'item': item_num,
                            },
                        },
                        'match': match_text,
                        'matchType': match_type if match_type != 'unknown' else 'locator_exact',
                        'similarityScore': similarity_score,
                    }
                )

            if matched_locator:
                continue
            if target_law_num not in target_lookup_cache:
                target_article = fetch_law_article(target_law_num, timeout=timeout, retry=retry)
                target_lookup_cache[target_law_num] = build_article_lookup(target_article)
            lookup = target_lookup_cache[target_law_num]
            definition_entry = resolve_definition_reference(lookup, text)
            if definition_entry is None:
                continue

            target_text = definition_entry.text
            match_text, match_type = find_best_match(text, target_text)
            similarity_score = compute_similarity_score(
                source_article_text=source_article_text,
                source_context_text=text,
                target_article_text=target_text,
            )
            dedupe_key = (
                source_law_num,
                seg.provision_base,
                seg.article,
                seg.paragraph,
                seg.item,
                target_law_num,
                definition_entry.provision,
                definition_entry.article,
                '0',
                '0',
                match_text,
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            rows.append(
                {
                    'ref': {
                        'lawNum': source_law_num,
                        'lawArticle': {
                            'provision': seg.provision_base,
                            'article': seg.article,
                            'paragraph': seg.paragraph,
                            'item': seg.item,
                        },
                    },
                    'referred': {
                        'lawNum': target_law_num,
                        'lawArticle': {
                            'provision': definition_entry.provision,
                            'article': definition_entry.article,
                            'paragraph': '0',
                            'item': '0',
                        },
                    },
                    'match': match_text,
                    'matchType': match_type if match_type != 'unknown' else 'definition_lookup',
                    'similarityScore': similarity_score,
                }
            )

        for law_num in explicit_mentions:
            target = law_index.get(law_num)
            if not target:
                continue
            for context_alias in target.get('context_aliases') or set():
                recent_aliases[context_alias] = law_num
    return rows


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / MANIFEST_FILE
    manifest = load_manifest(manifest_path)
    manifest_targets = manifest.get('targets')
    if not isinstance(manifest_targets, dict):
        manifest_targets = {}
    manifest['targets'] = manifest_targets
    manifest['laws'] = manifest_targets
    manifest_sources = manifest.get('sources')
    if not isinstance(manifest_sources, dict):
        manifest_sources = {}
        manifest['sources'] = manifest_sources

    explicit_law_nums = split_csv(args.law_num)
    warnings: List[str] = []

    print('loading law list from e-Gov API...')
    law_rows, recent_law_rows = fetch_law_list(
        timeout=args.timeout,
        retry=args.retry,
        updated_within_days=args.updated_within_days,
    )
    law_index, searchable_names = make_law_name_indexes(law_rows)
    print(f'law list loaded: total={len(law_rows)}, recent={len(recent_law_rows)}')

    source_targets = determine_source_targets(
        law_rows=law_rows if args.all else recent_law_rows,
        law_index=law_index,
        manifest_sources=manifest_sources,
        out_dir=out_dir,
        explicit_law_nums=explicit_law_nums,
        run_all=args.all,
        warnings=warnings,
    )
    if args.limit and args.limit > 0:
        source_targets = source_targets[:args.limit]

    if not source_targets:
        print('source laws to rebuild: 0')
    else:
        print(f'source laws to rebuild: {len(source_targets)}')

    target_lookup_cache: Dict[str, ArticleLookup] = {}
    target_row_cache: Dict[str, List[Dict[str, Any]]] = {}
    failed: List[str] = []
    processed = 0
    touched_target_laws: Set[str] = set()

    for idx, law_num in enumerate(source_targets, start=1):
        try:
            print(f'[{idx}/{len(source_targets)}] rebuilding source: {law_num}')
            source_article = fetch_law_article(law_num, timeout=args.timeout, retry=args.retry)
            rows = build_ref_data_for_law(
                source_law_num=law_num,
                source_article=source_article,
                law_index=law_index,
                searchable_names=searchable_names,
                target_lookup_cache=target_lookup_cache,
                timeout=args.timeout,
                retry=args.retry,
            )
            grouped_rows = group_rows_by_target(rows)
            current_target_laws = sorted(grouped_rows)
            previous_target_laws = resolve_existing_target_laws(
                out_dir=out_dir,
                source_law_num=law_num,
                manifest_sources=manifest_sources,
                warnings=warnings,
            )
            affected_target_laws = sorted(set(previous_target_laws) | set(current_target_laws))

            if args.dry_run:
                print(f'  dry-run: refs={len(rows)}, target_files={len(affected_target_laws)}')
            else:
                staged_target_rows: Dict[str, List[Dict[str, Any]]] = {}
                for target_law_num in affected_target_laws:
                    file_path = out_dir / f'{target_law_num}.json'
                    if target_law_num not in target_row_cache:
                        target_row_cache[target_law_num] = load_ref_rows(file_path, warnings=warnings)
                    merged_rows = merge_target_rows(
                        existing_rows=target_row_cache[target_law_num],
                        source_law_num=law_num,
                        replacement_rows=grouped_rows.get(target_law_num, []),
                    )
                    staged_target_rows[target_law_num] = merged_rows
                for target_law_num, merged_rows in staged_target_rows.items():
                    target_row_cache[target_law_num] = merged_rows
                    touched_target_laws.add(target_law_num)
                print(f'  buffered: refs={len(rows)}, target_files={len(affected_target_laws)}')
            processed += 1
            revision_marker = str((law_index.get(law_num) or {}).get('revision_marker') or 'unknown')
            manifest_sources[law_num] = {
                'revision_marker': revision_marker,
                'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'references': len(rows),
                'target_laws': current_target_laws,
            }
            if args.sleep > 0:
                time.sleep(args.sleep)
        except Exception as exc:  # noqa: BLE001
            failed.append(f'{law_num}: {exc}')
            print(f'  failed: {law_num} -> {exc}', file=sys.stderr)

    if not args.dry_run:
        for target_law_num in sorted(touched_target_laws):
            try:
                file_path = out_dir / f'{target_law_num}.json'
                merged_rows = target_row_cache.get(target_law_num, [])
                write_json(file_path, merged_rows)
                manifest_targets[target_law_num] = {
                    'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    'references': len(merged_rows),
                }
            except Exception as exc:  # noqa: BLE001
                failed.append(f'{target_law_num}: {exc}')
                print(f'  failed write: {target_law_num} -> {exc}', file=sys.stderr)
        manifest['generated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        manifest['source'] = 'scripts/ref_json/build_ref_json.py'
        manifest['law_count'] = len(law_index)
        manifest['format_version'] = 4
        manifest['layout'] = 'target_law_num'
        write_json(manifest_path, manifest)
        if args.sync_supabase and not failed:
            print('syncing law_references to Supabase...')
            run_supabase_sync(out_dir)
        elif args.sync_supabase and failed:
            print('skipped Supabase sync because ref_json build had failures.', file=sys.stderr)

    status = 'success' if not failed else ('partial_success' if processed > 0 else 'failed')
    if args.dry_run:
        print(f'done: status={status}, processed_sources={processed}, failed={len(failed)}')
    else:
        print(
            f'done: status={status}, processed_sources={processed}, '
            f'updated_target_files={len(touched_target_laws)}, failed={len(failed)}'
        )
    if warnings:
        print(f'warnings: {len(warnings)}', file=sys.stderr)
        for line in warnings:
            print(line, file=sys.stderr)
    if failed:
        for line in failed:
            print(line, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
