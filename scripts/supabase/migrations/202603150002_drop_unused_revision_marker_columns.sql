drop index if exists public.law_references_source_idx;

alter table if exists public.law_references
  drop column if exists source_revision_marker;

create index if not exists law_references_source_idx
  on public.law_references (source_law_num);

alter table if exists public.laws
  drop column if exists revision_marker;
