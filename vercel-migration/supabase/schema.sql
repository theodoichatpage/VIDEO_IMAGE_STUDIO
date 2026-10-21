create table if not exists public.studio_sessions (
  id text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.studio_sessions enable row level security;

