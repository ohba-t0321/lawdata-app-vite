alter table if exists public.law_references
  add column if not exists match_type text;
