-- Electromaxx # checks. Run after local-stub.sql + 0001 + 0002 (tools/test-sql.sh).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'don@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'mallory@example.com') on conflict do nothing;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, false); end $$;
-- returns true when the statement fails with the expected SQLSTATE
create or replace function pg_temp.fails(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create temp table results (ok boolean, label text);
grant all on results to authenticated;

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into public.items (id, name, electromaxx_no) values ('eeeeeeee-0000-0000-0000-000000000001', 'Laptop', '004217');
insert into public.items (id, name) values ('eeeeeeee-0000-0000-0000-000000000002', 'No sticker');
insert into public.items (id, name) values ('eeeeeeee-0000-0000-0000-000000000003', 'No sticker 2');
insert into results select count(*) = 3, 'items with and without Electromaxx # (NULL allowed, several NULLs ok)' from public.items;
insert into results select pg_temp.fails($$insert into public.items (name, electromaxx_no) values ('x', '12345')$$, '23514'), '5 digits rejected';
insert into results select pg_temp.fails($$insert into public.items (name, electromaxx_no) values ('x', '1234567')$$, '23514'), '7 digits rejected';
insert into results select pg_temp.fails($$insert into public.items (name, electromaxx_no) values ('x', 'A12345')$$, '23514'), 'letters rejected';
insert into results select pg_temp.fails($$insert into public.items (name, electromaxx_no) values ('x', '')$$, '23514'), 'empty string rejected (use NULL)';
insert into results select pg_temp.fails($$insert into public.items (name, electromaxx_no) values ('dup', '004217')$$, '23505'), 'duplicate number for same owner rejected';
insert into results select pg_temp.fails($$update public.items set electromaxx_no = '004217' where id = 'eeeeeeee-0000-0000-0000-000000000002'$$, '23505'), 'duplicate via update rejected';
update public.items set electromaxx_no = '100001' where id = 'eeeeeeee-0000-0000-0000-000000000002';
insert into results select (select electromaxx_no from public.items where id = 'eeeeeeee-0000-0000-0000-000000000002') = '100001', 'valid update accepted';
insert into public.trips (id, name) values ('ffffffff-0000-0000-0000-000000000001', 'Trip');
insert into results select (select show_emx from public.trips) = false, 'trips.show_emx defaults to false';
reset role;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
insert into public.items (name, electromaxx_no) values ('Mallory gear', '004217');
insert into results select count(*) = 1, 'another user may use the same number (unique per owner)' from public.items;
reset role;

select ok, label from results;
select case when bool_and(ok) then 'ALL ' || count(*) || ' ELECTROMAXX CHECKS PASS' else 'FAILURES: ' || string_agg(label, '; ') filter (where not ok) end as summary from results;
