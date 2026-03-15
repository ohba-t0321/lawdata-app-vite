alter table if exists public.law_references
  add column if not exists similarity_score double precision;
