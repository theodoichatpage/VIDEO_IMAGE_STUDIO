-- Free-plan disk IO: a project's unchanging text (script, rewrite, part and scene descriptions, prompts) moves to
-- its own column. The studio-api function writes it only when it changed, so image results and status updates
-- rewrite only the small rest of the row instead of the whole ~1 MB project. Reads merge it back.
-- Safe to run more than once. The function keeps working without it (everything stays in `record`).
alter table public.studio_sessions add column if not exists texts jsonb;
notify pgrst, 'reload schema';
