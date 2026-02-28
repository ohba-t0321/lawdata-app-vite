create extension if not exists pgcrypto;

create table if not exists public.laws (
  law_num text primary key,
  law_id text,
  law_type text,
  law_title text not null,
  revision_marker text not null,
  current_revision_id text,
  updated_source timestamptz,
  source_law_info jsonb,
  source_revision_info jsonb,
  source_current_revision_info jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.law_versions (
  id uuid primary key default gen_random_uuid(),
  law_num text not null references public.laws (law_num) on delete cascade,
  revision_marker text not null,
  is_current boolean not null default false,
  source_revision_info jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (law_num, revision_marker)
);

create unique index if not exists law_versions_current_unique
  on public.law_versions (law_num)
  where is_current;

create index if not exists law_versions_law_num_idx on public.law_versions (law_num);

create table if not exists public.law_assets (
  version_id uuid primary key references public.law_versions (id) on delete cascade,
  raw_json_path text not null,
  vnode_json_path text not null,
  toc_json_path text not null,
  ref_data_json_path text not null,
  ref_law_title_json_path text not null,
  article_map_json_path text not null,
  payload_hash text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.law_references (
  id bigserial primary key,
  source_law_num text not null references public.laws (law_num) on delete cascade,
  source_revision_marker text not null,
  source_provision text,
  source_article text,
  source_paragraph text,
  source_item text,
  target_law_num text not null,
  target_provision text not null,
  target_article text not null,
  target_paragraph text,
  target_item text,
  match_text text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists law_references_source_idx
  on public.law_references (source_law_num, source_revision_marker);

create table if not exists public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  changed_law_count integer not null default 0,
  processed_count integer not null default 0,
  failed_count integer not null default 0,
  error_log text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
