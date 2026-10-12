-- ShowCrew GearVault v2.3 — fair-market-value lookups (SerpApi Google Shopping via the fmv-lookup Edge Function).
-- Safe to re-run. current_value stays what the carnet uses; fmv_* records the last reviewed lookup.
alter table public.items add column if not exists fmv_value numeric;
alter table public.items add column if not exists fmv_low numeric;
alter table public.items add column if not exists fmv_high numeric;
alter table public.items add column if not exists fmv_count int;
alter table public.items add column if not exists fmv_checked_at timestamptz;
alter table public.items add column if not exists fmv_sources jsonb;
alter table public.items add column if not exists fmv_query text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_fmv_sources_array' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_fmv_sources_array check (fmv_sources is null or (jsonb_typeof(fmv_sources) = 'array' and jsonb_array_length(fmv_sources) <= 10));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_fmv_query_len' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_fmv_query_len check (fmv_query is null or length(fmv_query) <= 200);
  end if;
end $$;
