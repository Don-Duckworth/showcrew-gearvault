-- ShowCrew GearVault v2 — Supabase schema, Row Level Security and private storage.
-- Run once in the Supabase SQL editor (safe to re-run: tables/indexes are "if not exists", policies are dropped and recreated).
--
-- Security model
--   * Every row carries owner_id (defaults to auth.uid()). PERMISSIVE policies let only the owner select/insert/update/delete.
--   * A RESTRICTIVE policy on every table additionally requires the JWT to be at assurance level aal2 (password + TOTP).
--     Restrictive policies are AND-ed with the permissive ones, so an aal1 (password-only) session sees nothing and can write nothing.
--   * Join tables use composite foreign keys (owner_id, x_id) so a row can only reference the same owner's items/kits/trips.
--   * Only the `authenticated` role gets table privileges; `anon` gets none.
--   * Files live in the private bucket `gear-files` under "<auth.uid()>/…"; storage policies enforce that prefix + aal2.

-- ---------- helpers ----------
create or replace function public.gv_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- tables ----------
create table if not exists public.settings (
  owner_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  currency    text not null default 'USD' check (char_length(currency) = 3),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  holder      text not null default '' check (char_length(holder) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.categories (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, name)
);

create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null default '' check (char_length(name) <= 200),
  category      text not null default 'Other' check (char_length(category) <= 80),
  make          text not null default '' check (char_length(make) <= 120),
  model         text not null default '' check (char_length(model) <= 120),
  serial        text not null default '' check (char_length(serial) <= 400),
  qty           integer not null default 1 check (qty >= 1),
  status        text not null default 'active' check (status in ('active', 'repair', 'sold', 'retired')),
  purchase_date date,
  price         numeric(14, 2) check (price >= 0),
  currency      text not null default 'USD' check (char_length(currency) = 3),
  current_value numeric(14, 2) check (current_value >= 0),
  vendor        text not null default '' check (char_length(vendor) <= 120),
  origin        text not null default '' check (char_length(origin) <= 80),
  weight        numeric(10, 3) check (weight >= 0),
  weight_unit   text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  notes         text not null default '' check (char_length(notes) <= 4000),
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, id)
);

create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id    uuid not null,
  name       text not null default 'file' check (char_length(name) <= 200),
  mime       text not null default '' check (char_length(mime) <= 100),
  size       bigint not null default 0 check (size >= 0),
  kind       text not null default 'photo' check (kind in ('photo', 'receipt')),
  path       text not null check (char_length(path) <= 300),
  thumb_path text check (char_length(thumb_path) <= 300),
  added_at   timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, item_id) references public.items (owner_id, id) on delete cascade,
  -- storage path must live under the owner's folder
  check (split_part(path, '/', 1) = owner_id::text),
  check (thumb_path is null or split_part(thumb_path, '/', 1) = owner_id::text)
);

create table if not exists public.kits (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  type       text not null default 'Kit' check (char_length(type) <= 40),
  notes      text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table if not exists public.kit_items (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kit_id     uuid not null,
  item_id    uuid not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kit_id, item_id),
  foreign key (owner_id, kit_id) references public.kits (owner_id, id) on delete cascade,
  foreign key (owner_id, item_id) references public.items (owner_id, id) on delete cascade
);

create table if not exists public.trips (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  destinations   text not null default '' check (char_length(destinations) <= 400),
  depart         date,
  return_date    date,
  carnet_no      text not null default '' check (char_length(carnet_no) <= 60),
  holder         text not null default '' check (char_length(holder) <= 200),
  purpose        text not null default '' check (char_length(purpose) <= 200),
  currency       text not null default 'USD' check (char_length(currency) = 3),
  weight_unit    text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  serial_in_desc boolean not null default false,
  notes          text not null default '' check (char_length(notes) <= 4000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_id, id)
);

-- Which kits a trip pulls in (in order).
create table if not exists public.trip_kits (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id    uuid not null,
  kit_id     uuid not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, kit_id),
  foreign key (owner_id, trip_id) references public.trips (owner_id, id) on delete cascade,
  foreign key (owner_id, kit_id) references public.kits (owner_id, id) on delete cascade
);

-- Individually added items (mode 'include') and kit items left off this trip (mode 'exclude').
create table if not exists public.trip_items (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id    uuid not null,
  item_id    uuid not null,
  mode       text not null default 'include' check (mode in ('include', 'exclude')),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, item_id),
  foreign key (owner_id, trip_id) references public.trips (owner_id, id) on delete cascade,
  foreign key (owner_id, item_id) references public.items (owner_id, id) on delete cascade
);

-- ---------- indexes (owner_id is in every RLS predicate) ----------
create index if not exists items_owner_idx       on public.items (owner_id);
create index if not exists attachments_owner_idx on public.attachments (owner_id);
create index if not exists attachments_item_idx  on public.attachments (owner_id, item_id);
create index if not exists kits_owner_idx        on public.kits (owner_id);
create index if not exists kit_items_owner_idx   on public.kit_items (owner_id);
create index if not exists kit_items_item_idx    on public.kit_items (owner_id, item_id);
create index if not exists trips_owner_idx       on public.trips (owner_id);
create index if not exists trip_kits_owner_idx   on public.trip_kits (owner_id);
create index if not exists trip_kits_kit_idx     on public.trip_kits (owner_id, kit_id);
create index if not exists trip_items_owner_idx  on public.trip_items (owner_id);
create index if not exists trip_items_item_idx   on public.trip_items (owner_id, item_id);

-- ---------- updated_at triggers, privileges, RLS ----------
do $$
declare t text;
begin
  foreach t in array array['settings', 'categories', 'items', 'attachments', 'kits', 'kit_items', 'trips', 'trip_kits', 'trip_items'] loop
    execute format('drop trigger if exists gv_updated_at on public.%I', t);
    execute format('create trigger gv_updated_at before update on public.%I for each row execute function public.gv_set_updated_at()', t);

    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('alter table public.%I enable row level security', t);

    -- Owner-only access (permissive).
    execute format('drop policy if exists "owner can read" on public.%I', t);
    execute format('drop policy if exists "owner can insert" on public.%I', t);
    execute format('drop policy if exists "owner can update" on public.%I', t);
    execute format('drop policy if exists "owner can delete" on public.%I', t);
    execute format('create policy "owner can read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "owner can insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "owner can update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "owner can delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t);

    -- MFA required for everything (restrictive => AND-ed with the policies above).
    execute format('drop policy if exists "require mfa (aal2)" on public.%I', t);
    execute format($p$create policy "require mfa (aal2)" on public.%I as restrictive for all to authenticated
                     using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2')$p$, t);
  end loop;
end $$;

revoke all on function public.gv_set_updated_at() from anon, public;

-- ---------- storage: private bucket + per-user folder policies ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gear-files', 'gear-files', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "gear-files: owner read"   on storage.objects;
drop policy if exists "gear-files: owner insert" on storage.objects;
drop policy if exists "gear-files: owner update" on storage.objects;
drop policy if exists "gear-files: owner delete" on storage.objects;
drop policy if exists "gear-files: require mfa (aal2)" on storage.objects;

create policy "gear-files: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'gear-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "gear-files: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'gear-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "gear-files: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'gear-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'aal') = 'aal2')
  with check (bucket_id = 'gear-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'aal') = 'aal2');
create policy "gear-files: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'gear-files' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'aal') = 'aal2');
-- Belt and braces: restrictive aal2 gate scoped to this bucket only (other buckets in the project are unaffected).
create policy "gear-files: require mfa (aal2)" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'gear-files' or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (bucket_id <> 'gear-files' or (select auth.jwt() ->> 'aal') = 'aal2');
