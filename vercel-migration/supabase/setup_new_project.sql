-- One-time setup of a NEW Supabase project for VIDEO IMAGE STUDIO / AI MANAGER.
-- Paste all of this into SQL Editor → Run. Safe to run more than once.
-- The picture bucket (studio-images) is created by the studio-api function on first use.

create table if not exists public.studio_sessions (
  id text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now(),
  summary jsonb,
  bridge_last_seen bigint not null default 0
);
alter table public.studio_sessions add column if not exists summary jsonb;
alter table public.studio_sessions add column if not exists bridge_last_seen bigint not null default 0;

-- Only the studio-api function (service role) may touch the table; browsers cannot read it directly.
alter table public.studio_sessions enable row level security;
revoke all on table public.studio_sessions from anon, authenticated;
grant select, insert, update, delete on table public.studio_sessions to service_role;

create or replace function public.studio_touch_session(session_id text, seen_at bigint)
returns void language sql security invoker set search_path = public as $$
  update public.studio_sessions
  set bridge_last_seen = greatest(bridge_last_seen, seen_at)
  where id = session_id and bridge_last_seen < seen_at;
$$;
revoke all on function public.studio_touch_session(text, bigint) from public, anon, authenticated;
grant execute on function public.studio_touch_session(text, bigint) to service_role;

notify pgrst, 'reload schema';

-- Separation results (layers made by the Local Engine), one row per separation job; written by studio_save_separation.
create table if not exists public.studio_separations (
  session_id text not null references public.studio_sessions(id) on delete cascade,
  job_id text not null,
  entry jsonb not null,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  primary key (session_id, job_id)
);
alter table public.studio_separations enable row level security;
revoke all on table public.studio_separations from anon, authenticated;
grant select, insert, update, delete on table public.studio_separations to service_role;

create or replace function public.studio_save_separation(session_id text, entry jsonb)
returns void language sql security invoker set search_path = public as $$
  insert into public.studio_separations (session_id, job_id, entry, updated_at)
  values ($1, $2->>'jobId', $2, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  on conflict on constraint studio_separations_pkey
  do update set entry = excluded.entry, updated_at = excluded.updated_at;
$$;
revoke all on function public.studio_save_separation(text, jsonb) from public, anon, authenticated;
grant execute on function public.studio_save_separation(text, jsonb) to service_role;

notify pgrst, 'reload schema';
