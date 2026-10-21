-- Heartbeats must never replace an entire project read before a result arrived.
create or replace function public.studio_touch_session(session_id text, seen_at bigint)
returns void language sql security invoker set search_path = public as $$
  update public.studio_sessions
  set record = jsonb_set(record, '{bridgeLastSeen}', to_jsonb(greatest(coalesce((record->>'bridgeLastSeen')::bigint, 0), seen_at)))
  where id = session_id;
$$;
revoke all on function public.studio_touch_session(text, bigint) from public, anon, authenticated;
grant execute on function public.studio_touch_session(text, bigint) to service_role;
