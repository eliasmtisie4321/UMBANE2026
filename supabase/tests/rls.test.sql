-- RLS tests. Run AFTER migrations and seed.sql on a DEVELOPMENT/PREVIEW database
-- (Supabase SQL editor, or `psql -f`). Everything runs in one transaction and is rolled back.
-- Any failed expectation raises an exception with a clear message; success prints notices.

begin;

-- Helpers: act as a user (authenticated role + JWT claims) or as the table owner ------------
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
end $$;

create function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- Succeeds only if the statement raises an error (e.g. RLS violation or permission denied).
create function pg_temp.expect_error(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded but should have been blocked)', msg;
end $$;

-- Tenant isolation ----------------------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff, business 1
select pg_temp.expect((select count(*) from public.customers) = 2, 'staff sees only business 1 customers');
select pg_temp.expect(not exists (select 1 from public.customers where business_id = '11111111-0000-0000-0000-000000000002'), 'staff cannot see business 2 customers');
select pg_temp.expect((select count(*) from public.businesses) = 1, 'staff sees only their own business');

select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.customers) = 1, 'business 2 admin sees only business 2 customers');
select pg_temp.expect((select count(*) from public.invoices) = 0, 'business 2 admin sees no business 1 invoices');

-- Client isolation ----------------------------------------------------------------------------
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.customers) = 1, 'client sees only their own customer record');
select pg_temp.expect((select count(*) from public.properties) = 1, 'client sees only their own property');
select pg_temp.expect((select count(*) from public.electricity_meters) = 1, 'client sees only their own meter');
select pg_temp.expect((select count(*) from public.meter_readings) = 2, 'client sees readings for their own meter only');
select pg_temp.expect((select count(*) from public.leads) = 0, 'client cannot see leads');
select pg_temp.expect((select count(*) from public.products) = 0, 'client cannot see products');
select pg_temp.expect((select count(*) from public.invoices) = 1, 'client sees only sent invoices, not drafts');
select pg_temp.expect((select count(*) from public.support_tickets) = 1, 'client sees only their own tickets');
select pg_temp.expect((select count(*) from public.ticket_messages) = 1, 'client never sees internal ticket notes');
select pg_temp.expect((select count(*) from public.audit_logs) = 0, 'client cannot read audit logs');
select pg_temp.expect_error($$insert into public.leads (business_id, name) values ('11111111-0000-0000-0000-000000000001', 'x')$$, 'client cannot create leads');
select pg_temp.expect_error($$insert into public.support_tickets (business_id, customer_id, reference, subject) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'TKT-X', 'for someone else')$$, 'client cannot open a ticket for another customer');
select pg_temp.expect_error($$insert into public.ticket_messages (business_id, ticket_id, author_id, body, is_internal) values ('11111111-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'sneaky', true)$$, 'client cannot write internal notes');
insert into public.support_tickets (business_id, customer_id, reference, subject)
  values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'TKT-C1', 'Own ticket');
select pg_temp.expect((select count(*) from public.support_tickets) = 2, 'client can open a ticket for themselves');

-- Staff capabilities and limits -----------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.ticket_messages) = 2, 'staff sees internal and public ticket messages');
insert into public.customers (business_id, name) values ('11111111-0000-0000-0000-000000000001', 'Staff-created customer');
select pg_temp.expect_error($$insert into public.customers (business_id, name) values ('11111111-0000-0000-0000-000000000002', 'cross-business')$$, 'staff cannot create records in another business');
delete from public.customers where name = 'Staff-created customer';
select pg_temp.expect((select count(*) from public.customers where name = 'Staff-created customer') = 1, 'staff cannot delete (delete removed nothing)');
select pg_temp.expect_error($$update public.profiles set role = 'administrator' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'staff cannot promote themselves');
select pg_temp.expect((select count(*) from public.audit_logs) = 0, 'staff cannot read audit logs');
select pg_temp.expect_error($$insert into public.audit_logs (business_id, action) values ('11111111-0000-0000-0000-000000000001', 'forged')$$, 'nobody can forge audit log rows');

-- Manager ---------------------------------------------------------------------------------------
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
delete from public.customers where name = 'Staff-created customer';
select pg_temp.expect((select count(*) from public.customers where name = 'Staff-created customer') = 0, 'manager can delete');
select pg_temp.expect((select count(*) from public.audit_logs) >= 1, 'manager can read audit logs');
update public.profiles set role = 'administrator' where id = 'a3000000-0000-0000-0000-000000000001';
select pg_temp.expect((select role from public.profiles where id = 'a3000000-0000-0000-0000-000000000001') = 'staff', 'manager cannot change roles (update matched no rows)');

-- Administrator ---------------------------------------------------------------------------------
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
update public.profiles set role = 'manager' where id = 'a3000000-0000-0000-0000-000000000001';
select pg_temp.expect((select role from public.profiles where id = 'a3000000-0000-0000-0000-000000000001') = 'manager', 'administrator can change roles');
select pg_temp.expect_error($$update public.profiles set business_id = '11111111-0000-0000-0000-000000000002' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'nobody can move a user to another business');

-- Deactivation ---------------------------------------------------------------------------------
select pg_temp.as_owner();
update public.profiles set is_active = false where id = 'a2000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.customers) = 0, 'deactivated user sees nothing');

-- Anonymous --------------------------------------------------------------------------------------
select pg_temp.as_owner();
select pg_temp.expect_error($$set local role anon; select * from public.customers$$, 'anonymous role has no access to customers');
reset role;

rollback;
