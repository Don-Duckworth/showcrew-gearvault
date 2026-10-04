-- RLS / MFA checks. Run after local-stub.sql + 0001_init.sql:  psql -v ON_ERROR_STOP=1 -f rls-test.sql
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'don@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'mallory@example.com') on conflict do nothing;

create or replace function pg_temp.as_user(uid text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, false);
end $$;
create temp table results (ok boolean, label text);
grant all on results to authenticated, anon;

-- ===== Don at aal2: full CRUD =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal2');
set role authenticated;
insert into public.settings (currency) values ('USD');
insert into public.categories (name, position) values ('Laptop – Mac', 0);
insert into public.items (id, name, serial, price) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Show laptop', 'C02', 3499);
insert into public.kits (id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Rack A');
insert into public.kit_items (kit_id, item_id) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.trips (id, name) values ('cccccccc-0000-0000-0000-000000000001', 'London');
insert into public.trip_kits (trip_id, kit_id) values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001');
insert into public.trip_items (trip_id, item_id, mode) values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'exclude');
insert into public.attachments (id, item_id, name, path) values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'r.pdf', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/dddddddd');
insert into storage.objects (bucket_id, name) values ('gear-files', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/dddddddd');
update public.items set price = 3000 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into results select count(*) = 1, 'aal2 owner sees own item' from public.items;
insert into results select (select owner_id from public.items limit 1) = '11111111-1111-1111-1111-111111111111', 'owner_id defaults to auth.uid()';
insert into results select (select updated_at > created_at or updated_at = created_at from public.items limit 1), 'updated_at trigger ok';
insert into results select count(*) = 1, 'aal2 owner sees own storage object' from storage.objects;
reset role;

-- ===== Don at aal1 (password only): nothing =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal1');
set role authenticated;
insert into results select count(*) = 0, 'aal1: items hidden' from public.items;
insert into results select count(*) = 0, 'aal1: kits hidden' from public.kits;
insert into results select count(*) = 0, 'aal1: attachments hidden' from public.attachments;
insert into results select count(*) = 0, 'aal1: storage objects hidden' from storage.objects;
do $$ begin
  begin insert into public.items (name) values ('sneaky'); insert into results values (false, 'aal1: insert item blocked');
  exception when insufficient_privilege then insert into results values (true, 'aal1: insert item blocked'); end;
  begin insert into storage.objects (bucket_id, name) values ('gear-files', '11111111-1111-1111-1111-111111111111/x'); insert into results values (false, 'aal1: storage upload blocked');
  exception when insufficient_privilege then insert into results values (true, 'aal1: storage upload blocked'); end;
end $$;
with u as (update public.items set name = 'x' returning 1) insert into results select count(*) = 0, 'aal1: update affects 0 rows' from u;
with d as (delete from public.items returning 1) insert into results select count(*) = 0, 'aal1: delete affects 0 rows' from d;
reset role;

-- ===== Mallory at aal2: cannot see or touch Don's data =====
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'aal2');
set role authenticated;
insert into results select count(*) = 0, 'other user: items hidden' from public.items;
insert into results select count(*) = 0, 'other user: settings hidden' from public.settings;
insert into results select count(*) = 0, 'other user: storage hidden' from storage.objects;
with u as (update public.items set name = 'pwned' returning 1) insert into results select count(*) = 0, 'other user: update 0 rows' from u;
with d as (delete from public.kits returning 1) insert into results select count(*) = 0, 'other user: delete 0 rows' from d;
do $$ begin
  begin insert into public.items (owner_id, name) values ('11111111-1111-1111-1111-111111111111', 'forged'); insert into results values (false, 'other user: cannot insert with forged owner_id');
  exception when insufficient_privilege then insert into results values (true, 'other user: cannot insert with forged owner_id'); end;
  begin insert into storage.objects (bucket_id, name) values ('gear-files', '11111111-1111-1111-1111-111111111111/evil.png'); insert into results values (false, 'other user: cannot upload into owner folder');
  exception when insufficient_privilege then insert into results values (true, 'other user: cannot upload into owner folder'); end;
  -- own kit referencing Don's item must fail on the composite FK
  insert into public.kits (id, name) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Mal kit');
  begin insert into public.kit_items (kit_id, item_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001'); insert into results values (false, 'other user: cannot link someone else''s item');
  exception when foreign_key_violation then insert into results values (true, 'other user: cannot link someone else''s item'); end;
  begin insert into public.attachments (item_id, path) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222/x'); insert into results values (false, 'other user: cannot attach to someone else''s item');
  exception when foreign_key_violation then insert into results values (true, 'other user: cannot attach to someone else''s item'); end;
  -- a path outside your own folder is rejected by the check constraint
  insert into public.items (id, name) values ('aaaaaaaa-0000-0000-0000-000000000002', 'mal item');
  begin insert into public.attachments (item_id, path) values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111/x'); insert into results values (false, 'attachment path must be in own folder');
  exception when check_violation then insert into results values (true, 'attachment path must be in own folder'); end;
  begin update public.items set owner_id = '11111111-1111-1111-1111-111111111111' where id = 'aaaaaaaa-0000-0000-0000-000000000002'; insert into results values (false, 'cannot give a row to another owner');
  exception when insufficient_privilege then insert into results values (true, 'cannot give a row to another owner'); end;
end $$;
reset role;

-- ===== anon: no privileges at all =====
reset role; select set_config('request.jwt.claims', '', false);
set role anon;
do $$ begin
  begin perform 1 from public.items; insert into results values (false, 'anon: no table access');
  exception when insufficient_privilege then insert into results values (true, 'anon: no table access'); end;
end $$;
reset role;

-- ===== cascades =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal2');
set role authenticated;
delete from public.items where id = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into results select (select count(*) from public.kit_items) = 0 and (select count(*) from public.trip_items) = 0 and (select count(*) from public.attachments) = 0, 'deleting an item cascades kit/trip links + attachment rows';
reset role;

select case when ok then 'PASS ' else 'FAIL ' end || label as result from results;
select case when bool_and(ok) then 'ALL ' || count(*) || ' RLS CHECKS PASS' else 'SOME RLS CHECKS FAILED' end as summary from results;
