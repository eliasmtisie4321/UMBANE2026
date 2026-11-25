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

-- Dashboard views (security_invoker: they must obey the caller's RLS) ---------------------------
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.invoice_balances) = 1, 'client sees only their own non-draft invoice balances');
select pg_temp.expect((select balance from public.invoice_balances) = 250.00, 'client invoice balance = total minus payments (1150 - 900)');
select pg_temp.expect((select count(*) from public.product_stock) = 0, 'client cannot see stock levels through the view');
select pg_temp.expect((select outstanding_amount from public.invoice_summary) = 250.00 and (select outstanding_count from public.invoice_summary) = 1 and (select overdue_count from public.invoice_summary) = 0, 'client summary covers only their own invoices');

select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) from public.invoice_balances) = 3, 'staff sees every invoice balance in their business');
select pg_temp.expect((select is_overdue from public.invoice_balances where invoice_number = 'INV-0003'), 'unpaid invoice past due date is overdue');
select pg_temp.expect(not (select is_overdue from public.invoice_balances where invoice_number = 'INV-0001'), 'invoice not yet due is not overdue');
select pg_temp.expect((select outstanding_amount from public.invoice_summary) = 550.00 and (select outstanding_count from public.invoice_summary) = 2 and (select overdue_count from public.invoice_summary) = 1, 'staff summary: 250 + 300 outstanding, 2 invoices, 1 overdue (drafts excluded)');
select pg_temp.expect((select count(*) from public.monthly_revenue) = 3, 'staff sees three months of revenue');
select pg_temp.expect((select sum(total) from public.monthly_revenue) = 900.00, 'monthly revenue totals the payments received');
select pg_temp.expect((select stock_on_hand from public.product_stock where sku = 'MTR-PREPAID') = 3, 'stock on hand = sum of signed transactions');
select pg_temp.expect((select is_low from public.product_stock where sku = 'MTR-PREPAID'), 'stock at or below threshold is flagged low');

select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.invoice_balances) = 0, 'other business sees no invoice balances');
select pg_temp.expect((select count(*) from public.invoice_summary) = 0, 'other business sees no invoice summary');
select pg_temp.expect((select count(*) from public.monthly_revenue) = 0, 'other business sees no revenue');
select pg_temp.expect((select count(*) from public.product_stock) = 0, 'other business sees no stock');

select pg_temp.as_owner();
select pg_temp.expect_error($$set local role anon; select * from public.invoice_balances$$, 'anonymous cannot read invoice balances');
select pg_temp.expect_error($$set local role anon; select * from public.invoice_summary$$, 'anonymous cannot read the invoice summary');
select pg_temp.expect_error($$set local role anon; select * from public.monthly_revenue$$, 'anonymous cannot read monthly revenue');
select pg_temp.expect_error($$set local role anon; select * from public.product_stock$$, 'anonymous cannot read stock levels');

-- Customer and property rules (Phase 3) ----------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into public.customers (business_id, name, customer_type, segment, id_number, province, postal_code, status)
  values ('11111111-0000-0000-0000-000000000001', 'Phase 3 Customer', 'individual', 'residential', '9001015800088', 'Gauteng', '2196', 'pending');
select pg_temp.expect((select count(*) from public.customers where name = 'Phase 3 Customer' and status = 'pending') = 1, 'staff can create a customer with the new fields and a pending status');
insert into public.customers (name) values ('Default business customer');
select pg_temp.expect((select business_id from public.customers where name = 'Default business customer') = '11111111-0000-0000-0000-000000000001', 'business_id defaults to the caller business');
select pg_temp.expect_error($$insert into public.customers (business_id, name, email) values ('11111111-0000-0000-0000-000000000001', 'Dup', 'CLIENT1@umbane.test')$$, 'duplicate email is refused, ignoring case');
select pg_temp.expect_error($$insert into public.customers (business_id, name, id_number) values ('11111111-0000-0000-0000-000000000001', 'Dup', '9001015800088')$$, 'duplicate ID number is refused');
select pg_temp.expect_error($$insert into public.customers (business_id, name, customer_type, company_name, registration_number) values ('11111111-0000-0000-0000-000000000001', 'Dup', 'business', 'Other Co', '2019/482190/07')$$, 'duplicate company registration number is refused');
select pg_temp.expect_error($$insert into public.customers (business_id, name, id_number) values ('11111111-0000-0000-0000-000000000001', 'Bad', '12345')$$, 'ID number must be 13 digits');
select pg_temp.expect_error($$insert into public.customers (business_id, name, segment) values ('11111111-0000-0000-0000-000000000001', 'Bad', 'galactic')$$, 'unknown customer segment is refused');
select pg_temp.expect_error($$insert into public.customers (business_id, name, status) values ('11111111-0000-0000-0000-000000000001', 'Bad', 'deleted')$$, 'unknown customer status is refused');
select pg_temp.expect_error($$insert into public.customers (business_id, name, province) values ('11111111-0000-0000-0000-000000000001', 'Bad', 'Narnia')$$, 'unknown province is refused');
select pg_temp.expect_error($$insert into public.customers (business_id, name, customer_type) values ('11111111-0000-0000-0000-000000000001', 'Bad', 'business')$$, 'a business customer must name the company');
select pg_temp.expect_error($$insert into public.customers (business_id, name, postal_code) values ('11111111-0000-0000-0000-000000000001', 'Bad', '21')$$, 'postal code must be four digits');
select pg_temp.expect_error($$update public.customers set business_id = '11111111-0000-0000-0000-000000000002' where name = 'Phase 3 Customer'$$, 'staff cannot move a customer to another business');

insert into public.properties (business_id, customer_id, name, address, suburb, city, province, property_type, units, reference)
  values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Second block', '99 Bree Street', 'City Bowl', 'Cape Town', 'Western Cape', 'mixed_use', 8, 'PROP-2001');
select pg_temp.expect((select count(*) from public.properties where reference = 'PROP-2001') = 1, 'staff can register a property');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address, suburb, city) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '99 BREE STREET', 'city bowl', 'cape town')$$, 'the same customer cannot register the same address twice, ignoring case');
insert into public.properties (business_id, customer_id, address, suburb, city)
  values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '99 Bree Street', 'City Bowl', 'Cape Town');
select pg_temp.expect((select count(*) from public.properties where address = '99 Bree Street') = 2, 'different customers may share a building address');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address, reference) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '1 Other Road', 'prop-2001')$$, 'duplicate property reference is refused, ignoring case');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address, property_type) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '2 Other Road', 'castle')$$, 'unknown property type is refused');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address, units) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '3 Other Road', 0)$$, 'a property needs at least one unit');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address, status) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '4 Other Road', 'haunted')$$, 'unknown property status is refused');

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
update public.customers set name = 'Hacked' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select name from public.customers where id = 'c1000000-0000-0000-0000-000000000001') = 'Cleo Client', 'a client cannot edit their own customer record');
select pg_temp.expect_error($$insert into public.properties (business_id, customer_id, address) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Client-made')$$, 'a client cannot register a property');
update public.properties set status = 'offline' where id = 'd1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select status from public.properties where id = 'd1000000-0000-0000-0000-000000000001') = 'active', 'a client cannot change a property');

select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
update public.customers set name = 'Cross-business edit' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select count(*) from public.customers where name = 'Cross-business edit') = 0, 'another business cannot edit our customers');
select pg_temp.expect((select count(*) from public.properties) = 0, 'another business cannot see our properties');

-- Staff capabilities and limits -----------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.ticket_messages) = 2,'staff sees internal and public ticket messages');
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
select pg_temp.expect((select count(*) from public.audit_logs where table_name = 'properties' and action = 'INSERT') >= 2, 'property changes are in the audit trail');
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
