create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'pro' check (role in ('admin', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_auth_user_created();

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '新規スレッド',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_threads_user_id_idx on public.chat_threads (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations_json jsonb,
  source_snapshot_json jsonb,
  model text,
  usage_json jsonb,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_id_idx on public.chat_messages (thread_id, created_at asc);
create index if not exists chat_messages_user_id_idx on public.chat_messages (user_id, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists chat_threads_set_updated_at on public.chat_threads;
create trigger chat_threads_set_updated_at
  before update on public.chat_threads
  for each row execute procedure public.set_updated_at();

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
  on public.profiles
  for select
  using (auth.uid() = id or public.current_user_is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  using (auth.uid() = id or public.current_user_is_admin())
  with check (auth.uid() = id or public.current_user_is_admin());

drop policy if exists chat_threads_select_own on public.chat_threads;
create policy chat_threads_select_own
  on public.chat_threads
  for select
  using (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_threads_insert_own on public.chat_threads;
create policy chat_threads_insert_own
  on public.chat_threads
  for insert
  with check (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_threads_update_own on public.chat_threads;
create policy chat_threads_update_own
  on public.chat_threads
  for update
  using (auth.uid() = user_id or public.current_user_is_admin())
  with check (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_threads_delete_own on public.chat_threads;
create policy chat_threads_delete_own
  on public.chat_threads
  for delete
  using (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own
  on public.chat_messages
  for select
  using (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own
  on public.chat_messages
  for insert
  with check (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own
  on public.chat_messages
  for update
  using (auth.uid() = user_id or public.current_user_is_admin())
  with check (auth.uid() = user_id or public.current_user_is_admin());

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own
  on public.chat_messages
  for delete
  using (auth.uid() = user_id or public.current_user_is_admin());
