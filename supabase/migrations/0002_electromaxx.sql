-- ShowCrew GearVault v2.1 — Electromaxx gear number (6-digit asset sticker with barcode).
-- Safe to re-run.
alter table public.items add column if not exists electromaxx_no text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_electromaxx_no_format' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_electromaxx_no_format check (electromaxx_no ~ '^[0-9]{6}$');  -- NULL passes
  end if;
end $$;

-- One sticker number per owner (different users may reuse numbers).
create unique index if not exists items_owner_electromaxx_uidx
  on public.items (owner_id, electromaxx_no) where electromaxx_no is not null;

-- Per-trip toggle: print the Electromaxx # as an extra column on the carnet general list (default off — it's an internal asset tag).
alter table public.trips add column if not exists show_emx boolean not null default false;
