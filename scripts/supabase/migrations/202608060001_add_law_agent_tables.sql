create index if not exists law_references_source_article_idx
  on public.law_references (source_law_num, source_provision, source_article);

create index if not exists law_references_target_article_idx
  on public.law_references (target_law_num, target_provision, target_article);

alter table public.laws enable row level security;
alter table public.law_references enable row level security;

drop policy if exists laws_select_authenticated on public.laws;
create policy laws_select_authenticated on public.laws for select to authenticated using (true);

drop policy if exists law_references_select_authenticated on public.law_references;
create policy law_references_select_authenticated on public.law_references for select to authenticated using (true);

create or replace function public.get_law_reference_edges(
  p_law_num text,
  p_provision text default null,
  p_article text default null,
  p_direction text default 'outgoing',
  p_limit integer default 20
)
returns table (
  direction text,
  source_law_num text,
  source_law_title text,
  source_provision text,
  source_article text,
  source_paragraph text,
  source_item text,
  target_law_num text,
  target_law_title text,
  target_provision text,
  target_article text,
  target_paragraph text,
  target_item text,
  match_text text,
  match_type text,
  similarity_score double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_direction as direction,
    lr.source_law_num,
    source_law.law_title as source_law_title,
    lr.source_provision,
    lr.source_article,
    lr.source_paragraph,
    lr.source_item,
    lr.target_law_num,
    coalesce(target_law.law_title, lr.target_law_num) as target_law_title,
    lr.target_provision,
    lr.target_article,
    lr.target_paragraph,
    lr.target_item,
    lr.match_text,
    lr.match_type,
    lr.similarity_score
  from public.law_references lr
  join public.laws source_law on source_law.law_num = lr.source_law_num
  left join public.laws target_law on target_law.law_num = lr.target_law_num
  where p_direction in ('outgoing', 'incoming')
    and (
      (p_direction = 'outgoing'
        and lr.source_law_num = p_law_num
        and (p_provision is null or lr.source_provision = p_provision)
        and (p_article is null or lr.source_article = p_article))
      or
      (p_direction = 'incoming'
        and lr.target_law_num = p_law_num
        and (p_provision is null or lr.target_provision = p_provision)
        and (p_article is null or lr.target_article = p_article))
    )
  order by
    case when lr.match_type in ('exact', 'article') then 0 else 1 end,
    lr.similarity_score desc nulls last,
    lr.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.get_law_reference_edges(text, text, text, text, integer) from public;
grant execute on function public.get_law_reference_edges(text, text, text, text, integer) to authenticated;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_message_id uuid references public.chat_messages (id) on delete set null,
  assistant_message_id uuid references public.chat_messages (id) on delete set null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'cancel_requested', 'completed', 'partial', 'failed', 'cancelled')
  ),
  question text not null,
  start_context_json jsonb,
  limits_json jsonb not null default '{}'::jsonb,
  summary_json jsonb,
  model text,
  usage_json jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, request_id)
);

create index if not exists agent_runs_thread_idx on public.agent_runs (thread_id, created_at desc);
create index if not exists agent_runs_user_rate_idx on public.agent_runs (user_id, created_at desc);
create unique index if not exists agent_runs_one_active_per_thread_idx
  on public.agent_runs (thread_id)
  where status in ('queued', 'running', 'cancel_requested');

create table if not exists public.agent_run_steps (
  id bigserial primary key,
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null,
  event_type text not null,
  tool_name text,
  status text not null default 'completed',
  summary text not null,
  details_json jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists agent_run_steps_run_idx on public.agent_run_steps (run_id, seq);

alter table public.chat_messages
  add column if not exists agent_run_id uuid references public.agent_runs (id) on delete set null;
create index if not exists chat_messages_agent_run_idx on public.chat_messages (agent_run_id);

alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists agent_runs_select_own on public.agent_runs;
create policy agent_runs_select_own on public.agent_runs for select
  using (auth.uid() = user_id or public.current_user_is_admin());
drop policy if exists agent_runs_insert_own on public.agent_runs;
drop policy if exists agent_runs_update_own on public.agent_runs;
drop policy if exists agent_runs_request_cancel on public.agent_runs;
create policy agent_runs_request_cancel on public.agent_runs for update
  using (auth.uid() = user_id and status in ('queued', 'running'))
  with check (auth.uid() = user_id and status = 'cancel_requested');

drop policy if exists agent_run_steps_select_own on public.agent_run_steps;
create policy agent_run_steps_select_own on public.agent_run_steps for select
  using (auth.uid() = user_id or public.current_user_is_admin());
drop policy if exists agent_run_steps_insert_own on public.agent_run_steps;

revoke insert, delete on public.agent_runs from authenticated;
revoke update on public.agent_runs from authenticated;
grant select on public.agent_runs to authenticated;
grant update (status) on public.agent_runs to authenticated;
revoke insert, update, delete on public.agent_run_steps from authenticated;
grant select on public.agent_run_steps to authenticated;
grant select on public.laws, public.law_references to authenticated;
