-- Parts (parent/child) checks. Run after local-stub.sql + 0001 + 0002 + 0003 (tools/test-sql.sh).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'don@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'mallory@example.com') on conflict do nothing;
create or replace function pg_temp.as_user(uid text, aal text default 'aal2') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, false); end $$;
create or replace function pg_temp.fails(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create temp table results (ok boolean, label text);
grant all on results to authenticated;

-- Mallory has an item first
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
insert into public.items (id, name) values ('99999999-0000-0000-0000-000000000001', 'SAMPLE Mallory laptop');
reset role;

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into public.items (id, name) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'SAMPLE Rack PC');
insert into public.items (id, name, parent_id, part_type) values
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'SAMPLE GPU', 'aaaaaaaa-0000-0000-0000-00000000000a', 'installed'),
  ('aaaaaaaa-0000-0000-0000-00000000000c', 'SAMPLE GPU bracket', 'aaaaaaaa-0000-0000-0000-00000000000b', 'installed'),
  ('aaaaaaaa-0000-0000-0000-00000000000d', 'SAMPLE Power cable', 'aaaaaaaa-0000-0000-0000-00000000000a', 'accessory');
insert into results select count(*) = 3, 'parts linked to own items (installed + accessory, 2 levels)' from public.items where parent_id is not null;
insert into results select pg_temp.fails($$insert into public.items (name, parent_id, part_type) values ('x', 'aaaaaaaa-0000-0000-0000-00000000000a', 'inside')$$, '23514'), 'part_type must be installed/accessory';
insert into results select pg_temp.fails($$update public.items set parent_id = id where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '23514'), 'item cannot be its own parent';
insert into results select pg_temp.fails($$update public.items set parent_id = 'aaaaaaaa-0000-0000-0000-00000000000b' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '23514'), '2-item cycle rejected (A→B→A)';
insert into results select pg_temp.fails($$update public.items set parent_id = 'aaaaaaaa-0000-0000-0000-00000000000c' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '23514'), '3-level cycle rejected (A→C→B→A)';
insert into results select pg_temp.fails($$insert into public.items (name, parent_id) values ('x', '99999999-0000-0000-0000-000000000001')$$, '23503'), 'cannot link to another user''s item (composite FK)';
insert into results select pg_temp.fails($$insert into public.items (name, parent_id) values ('x', 'aaaaaaaa-0000-0000-0000-0000000000ff')$$, '23503'), 'cannot link to a missing item';
-- moving a subtree is fine (not a cycle)
update public.items set parent_id = 'aaaaaaaa-0000-0000-0000-00000000000d' where id = 'aaaaaaaa-0000-0000-0000-00000000000c';
insert into results select (select parent_id from public.items where id = 'aaaaaaaa-0000-0000-0000-00000000000c') = 'aaaaaaaa-0000-0000-0000-00000000000d', 're-parenting to a non-ancestor allowed';
-- multi-row upsert, parents before children in one statement (how the app saves)
insert into public.items (id, name, parent_id, part_type) values
  ('aaaaaaaa-0000-0000-0000-000000000010', 'SAMPLE Laptop', null, null),
  ('aaaaaaaa-0000-0000-0000-000000000011', 'SAMPLE SSD', 'aaaaaaaa-0000-0000-0000-000000000010', 'installed')
  on conflict (id) do update set parent_id = excluded.parent_id;
insert into results select count(*) = 1, 'one statement inserts parent + child' from public.items where parent_id = 'aaaaaaaa-0000-0000-0000-000000000010';
-- swap: laptop becomes part of SSD's position in one statement, SSD first goes standalone (app orders roots first)
insert into public.items (id, name, parent_id, part_type) values
  ('aaaaaaaa-0000-0000-0000-000000000011', 'SAMPLE SSD', null, null),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'SAMPLE Laptop', 'aaaaaaaa-0000-0000-0000-000000000011', 'accessory')
  on conflict (id) do update set parent_id = excluded.parent_id, part_type = excluded.part_type;
insert into results select (select parent_id from public.items where id = 'aaaaaaaa-0000-0000-0000-000000000010') = 'aaaaaaaa-0000-0000-0000-000000000011', 'reversing a link in one ordered statement works (roots first)';
-- deleting a parent keeps the part, parent_id -> NULL (owner_id untouched)
delete from public.items where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
insert into results select (select parent_id is null and owner_id = '11111111-1111-1111-1111-111111111111' from public.items where id = 'aaaaaaaa-0000-0000-0000-00000000000b'), 'deleting a parent sets only parent_id to NULL';
insert into public.trips (id, name) values ('ffffffff-0000-0000-0000-00000000000f', 'SAMPLE Trip');
insert into results select (select fold_parts from public.trips where id = 'ffffffff-0000-0000-0000-00000000000f') = false, 'trips.fold_parts defaults to false';
reset role;

-- aal1 cannot re-parent; Mallory cannot touch Don's tree or point her items at it
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal1');
set role authenticated;
with u as (update public.items set parent_id = null returning 1) insert into results select count(*) = 0, 'aal1: cannot change parent links' from u;
reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
with u as (update public.items set parent_id = null where id = 'aaaaaaaa-0000-0000-0000-00000000000c' returning 1) insert into results select count(*) = 0, 'other user: cannot unlink Don''s parts' from u;
insert into results select pg_temp.fails($$update public.items set parent_id = 'aaaaaaaa-0000-0000-0000-000000000010' where id = '99999999-0000-0000-0000-000000000001'$$, '23503'), 'other user: cannot attach own item under Don''s item';
reset role;

select ok, label from results;
select case when bool_and(ok) then 'ALL ' || count(*) || ' PARTS CHECKS PASS' else 'FAILURES: ' || string_agg(label, '; ') filter (where not ok) end as summary from results;
