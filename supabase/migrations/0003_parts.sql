-- ShowCrew GearVault v2.2 — parent/child parts & accessories. Safe to re-run. Needs Postgres 15+ (Supabase is 15/17).
--   items.parent_id  : the item this one belongs to (NULL = standalone). Composite FK (owner_id, parent_id) -> items(owner_id, id),
--                      so a part can only point at the SAME owner's item. Deleting a parent sets only parent_id to NULL
--                      (the app asks first and either deletes the parts too or keeps them standalone).
--   items.part_type  : 'installed' (inside the parent: carnet sub-line, not an extra piece) or 'accessory' (own carnet line).
--   trips.fold_parts : per-trip switch "Fold installed parts into parent line" on the carnet general list.
alter table public.items add column if not exists parent_id uuid;
alter table public.items add column if not exists part_type text;
alter table public.trips add column if not exists fold_parts boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_part_type_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_part_type_check check (part_type in ('installed', 'accessory'));  -- NULL passes
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_parent_not_self' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_parent_not_self check (parent_id is null or parent_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_parent_fk' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_parent_fk foreign key (owner_id, parent_id)
      references public.items (owner_id, id) on delete set null (parent_id);
  end if;
end $$;

-- Covers the composite FK (and "children of X" lookups).
create index if not exists items_parent_idx on public.items (owner_id, parent_id);

-- No cycles (A part of B part of A). Walks up from the new parent; runs as the caller, so RLS + the composite FK keep it to the
-- caller's own rows. A per-owner transaction lock serializes concurrent re-parenting so two sessions can't build a cycle together.
create or replace function public.gv_items_no_cycle() returns trigger
language plpgsql set search_path = '' as $$
declare
  cur uuid := new.parent_id;
  hops int := 0;
begin
  if new.parent_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.parent_id is not distinct from new.parent_id and old.id = new.id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gv_items_tree:' || new.owner_id::text, 0));
  while cur is not null loop
    if cur = new.id then
      raise exception 'GearVault: item % cannot be a part of its own part (cycle)', new.id using errcode = '23514';
    end if;
    hops := hops + 1;
    if hops > 64 then raise exception 'GearVault: parts nested too deep (max 64 levels)' using errcode = '23514'; end if;
    select i.parent_id into cur from public.items i where i.owner_id = new.owner_id and i.id = cur;
  end loop;
  return new;
end $$;
revoke all on function public.gv_items_no_cycle() from anon, public;

drop trigger if exists gv_items_no_cycle on public.items;
create trigger gv_items_no_cycle before insert or update of parent_id, id on public.items
  for each row execute function public.gv_items_no_cycle();
