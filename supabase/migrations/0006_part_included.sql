-- ShowCrew GearVault v2.5 — third part type 'included' (e.g. a power supply that came with the item: cost is in the parent, not a carnet line).
-- Safe to re-run: replaces the part_type check with one that also allows 'included'.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'items_part_type_check' and conrelid = 'public.items'::regclass
             and pg_get_constraintdef(oid) not like '%included%') then
    alter table public.items drop constraint items_part_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_part_type_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_part_type_check check (part_type in ('installed', 'accessory', 'included'));  -- NULL passes
  end if;
end $$;
