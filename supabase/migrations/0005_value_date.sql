-- ShowCrew GearVault v2.4 — "Value as of": the date the current (fair market) value was obtained. Safe to re-run.
alter table public.items add column if not exists value_as_of date;
-- Backfill once from the last applied value lookup.
update public.items set value_as_of = fmv_checked_at::date where value_as_of is null and fmv_checked_at is not null;
