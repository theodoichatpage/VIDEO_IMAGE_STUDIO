-- Frequent small reads/writes no longer touch the big `record` jsonb.
-- Before: every "anything new?" check unpacked the whole project (record->summary) and every heartbeat
-- rewrote it (jsonb_set), several times a second with 3-4 ChatGPT tabs. On a project with hundreds of scenes
-- that is megabytes per call and exhausts the database's disk IO.
-- After: `summary` (a few hundred bytes) answers the checks; `bridge_last_seen` takes heartbeats. Updating a
-- small column keeps the stored `record` as it is (Postgres reuses the unchanged large value).
-- Safe to run more than once. The studio-api function works with or without this migration.

alter table public.studio_sessions add column if not exists summary jsonb;
alter table public.studio_sessions add column if not exists bridge_last_seen bigint not null default 0;

update public.studio_sessions
set summary = record->'summary',
    bridge_last_seen = greatest(bridge_last_seen, coalesce((record->>'bridgeLastSeen')::bigint, 0))
where summary is null;

create or replace function public.studio_touch_session(session_id text, seen_at bigint)
returns void language sql security invoker set search_path = public as $$
  update public.studio_sessions
  set bridge_last_seen = greatest(bridge_last_seen, seen_at)
  where id = session_id and bridge_last_seen < seen_at;
$$;
revoke all on function public.studio_touch_session(text, bigint) from public, anon, authenticated;
grant execute on function public.studio_touch_session(text, bigint) to service_role;

-- PostgREST must see the new columns right away.
notify pgrst, 'reload schema';
