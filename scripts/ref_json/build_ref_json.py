#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import time
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
LAW_NUM_PATTERN = (
    r'(?:令和|平成|昭和|大正|明治)'
    r'[' + NUM_CHARS + r']+年'
    r'[^）\n]{1,40}?'
    r'第[' + NUM_CHARS + r']+号'
)
KEYWORD_PATTERN = re.compile(
    r'[^。]*?(?:政令|省令|府令|規則|命令|条例|告示|内閣府令|主務省令)[^。]*?定め[^。]*'
)


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


@dataclass
class ArticleLookup:
    main: Dict[str, Tuple[str, str]]
    suppl: Dict[str, List[Tuple[str, str]]]


def build_article_lookup(law_article: Dict[str, Any]) -> ArticleLookup:
    main: Dict[str, Tuple[str, str]] = {}
    suppl: Dict[str, List[Tuple[str, str]]] = {}
    law_full_text = law_article.get('law_full_text')
    if not is_node(law_full_text):
        return ArticleLookup(main=main, suppl=suppl)

    law_body = None
    for child in law_full_text.get('children', []):
        if is_node(child) and child.get('tag') == 'LawBody':
            law_body = child
            break
    if not is_node(law_body):
        return ArticleLookup(main=main, suppl=suppl)

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

    return ArticleLookup(main=main, suppl=suppl)


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


def extract_clauses(text: str) -> List[str]:
    clauses: List[str] = []
    for match in KEYWORD_PATTERN.finditer(text):
        clause = match.group(0).strip()
        if clause and clause not in clauses:
            clauses.append(clause)
    return clauses


def find_best_match(source_text: str, target_text: str) -> str:
    source_clauses = extract_clauses(source_text)
    if not source_clauses:
        return UNKNOWN_MATCH

    normalized_target = normalize_text_for_match(target_text)
    target_clauses = extract_clauses(target_text)
    normalized_target_clauses = {normalize_text_for_match(item) for item in target_clauses}

    for clause in source_clauses:
        normalized_clause = normalize_text_for_match(clause)
        if len(normalized_clause) < 6:
            continue
        if normalized_clause in normalized_target:
            return clause
        if normalized_clause in normalized_target_clauses:
            return clause
        for target_clause in normalized_target_clauses:
            if normalized_clause in target_clause or target_clause in normalized_clause:
                return clause
    return UNKNOWN_MATCH


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
        return {'laws': {}}
    try:
        raw = path.read_text(encoding='utf-8')
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return {'laws': {}}
    if not isinstance(payload, dict):
        return {'laws': {}}
    if not isinstance(payload.get('laws'), dict):
        payload['laws'] = {}
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


def path_exists_safe(path: Path) -> Tuple[bool, Optional[str]]:
    try:
        return path.exists(), None
    except OSError as exc:
        name_bytes = len(path.name.encode('utf-8', errors='ignore'))
        return False, f'Failed to inspect path: {path} (filename bytes: {name_bytes}) -> {exc}'


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
            'names': names,
            'revision_marker': extract_revision_marker(row),
        }
        for name in names:
            if len(name) >= 2:
                searchable_names.append((name, law_num))
    searchable_names.sort(key=lambda item: len(item[0]), reverse=True)
    return by_num, searchable_names


def extract_alias_map(full_text: str, name_index: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    alias_by_num: Dict[str, str] = {}
    explicit = re.compile(
        rf'（(?P<law_num>{LAW_NUM_PATTERN})。?以下「(?P<alias>[^「」]+?)」という。?）'
    )
    for match in explicit.finditer(full_text):
        law_num = (match.group('law_num') or '').strip()
        alias = (match.group('alias') or '').strip()
        if law_num in name_index and alias and law_num not in alias_by_num:
            alias_by_num[law_num] = alias
    return alias_by_num


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


def determine_targets(
    law_rows: Sequence[Dict[str, Any]],
    law_index: Dict[str, Dict[str, Any]],
    manifest: Dict[str, Any],
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

    manifest_laws = manifest.get('laws') if isinstance(manifest.get('laws'), dict) else {}
    targets = []
    for row in law_rows:
        law_info = row.get('law_info') if isinstance(row.get('law_info'), dict) else {}
        law_num = str(law_info.get('law_num') or '').strip()
        if not law_num:
            continue
        revision_marker = extract_revision_marker(row)
        file_path = out_dir / f'{law_num}.json'
        exists, exists_error = path_exists_safe(file_path)
        if exists_error:
            warnings.append(exists_error)
            # Continue processing this law; write phase will emit a concrete error and continue.
            targets.append(law_num)
            continue
        entry = manifest_laws.get(law_num) if isinstance(manifest_laws, dict) else None
        entry_marker = ''
        if isinstance(entry, dict):
            entry_marker = str(entry.get('revision_marker') or '')

        if not exists:
            targets.append(law_num)
            continue
        if entry_marker and entry_marker != revision_marker:
            targets.append(law_num)
            continue
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

    regex_cache: Dict[Tuple[str, str], re.Pattern[str]] = {}
    rows: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str, str, str, str, str, str, str, str]] = set()

    for seg in segments:
        text = seg.text
        if not text:
            continue
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

            if not any(name in text for name in names if name):
                continue

            cache_key = (target_law_num, alias or '')
            if cache_key not in regex_cache:
                regex = build_ref_regex(names, target_law_num)
                if regex is None:
                    continue
                regex_cache[cache_key] = regex
            regex = regex_cache[cache_key]

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
                match_text = find_best_match(text, target_text)

                dedupe_key = (
                    source_law_num,
                    seg.provision_base,
                    seg.article,
                    seg.paragraph,
                    seg.item,
                    target_law_num,
                    target_provision,
                    article_key,
                    match_text,
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                rows.append(
                    {
                        'ref': {
                            'lawNum': target_law_num,
                            'lawArticle': {
                                'provision': target_provision,
                                'article': article_key,
                                'paragraph': paragraph_num,
                                'item': item_num,
                            },
                            'text': target_text,
                        },
                        'referred': {
                            'lawNum': source_law_num,
                            'lawArticle': {
                                'provision': seg.provision_base,
                                'article': seg.article,
                                'paragraph': seg.paragraph,
                                'item': seg.item,
                            },
                            'text': text,
                        },
                        'match': match_text,
                    }
                )
    return rows


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / MANIFEST_FILE
    manifest = load_manifest(manifest_path)
    manifest_laws = manifest.get('laws')
    if not isinstance(manifest_laws, dict):
        manifest_laws = {}
        manifest['laws'] = manifest_laws

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

    baseline_time = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if not args.dry_run:
        # Bootstrap marker state for already-existing files so incremental runs can compare revisions.
        for law_num, info in law_index.items():
            if law_num in manifest_laws:
                continue
            file_path = out_dir / f'{law_num}.json'
            exists, exists_error = path_exists_safe(file_path)
            if exists_error:
                warnings.append(exists_error)
                continue
            if not exists:
                continue
            manifest_laws[law_num] = {
                'revision_marker': str(info.get('revision_marker') or 'unknown'),
                'generated_at': baseline_time,
                'references': None,
            }

    targets = determine_targets(
        law_rows=law_rows if args.all else recent_law_rows,
        law_index=law_index,
        manifest=manifest,
        out_dir=out_dir,
        explicit_law_nums=explicit_law_nums,
        run_all=args.all,
        warnings=warnings,
    )
    if args.limit and args.limit > 0:
        targets = targets[:args.limit]

    if not targets:
        print('target laws: 0')
    else:
        print(f'target laws: {len(targets)}')

    target_lookup_cache: Dict[str, ArticleLookup] = {}
    failed: List[str] = []
    processed = 0

    for idx, law_num in enumerate(targets, start=1):
        try:
            print(f'[{idx}/{len(targets)}] building: {law_num}')
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
            if args.dry_run:
                print(f'  dry-run: refs={len(rows)}')
            else:
                write_json(out_dir / f'{law_num}.json', rows)
                print(f'  wrote: refs={len(rows)}')
            processed += 1
            revision_marker = str((law_index.get(law_num) or {}).get('revision_marker') or 'unknown')
            manifest_laws[law_num] = {
                'revision_marker': revision_marker,
                'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'references': len(rows),
            }
            if args.sleep > 0:
                time.sleep(args.sleep)
        except Exception as exc:  # noqa: BLE001
            failed.append(f'{law_num}: {exc}')
            print(f'  failed: {law_num} -> {exc}', file=sys.stderr)

    if not args.dry_run:
        manifest['generated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        manifest['source'] = 'scripts/ref_json/build_ref_json.py'
        manifest['law_count'] = len(law_index)
        write_json(manifest_path, manifest)

    status = 'success' if not failed else ('partial_success' if processed > 0 else 'failed')
    print(f'done: status={status}, processed={processed}, failed={len(failed)}')
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
