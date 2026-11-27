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

-- As above, and the error must match: a statement failing for the wrong reason is not a pass.
create function pg_temp.expect_error_like(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~ pattern then
      raise exception 'FAILED: % (expected an error like "%", got "%")', msg, pattern, sqlerrm;
    end if;
    raise notice 'ok: % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded but should have been blocked)', msg;
end $$;

-- The audit log, read as the database owner (people other than administrators cannot read it).
create function pg_temp.audit_rows() returns setof public.audit_logs language sql security definer as $$ select * from public.audit_logs $$;

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
insert into public.support_tickets (business_id, customer_id, reference, subject, description)
  values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'TKT-C1', 'Own ticket', 'Details');
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

-- Electricity and meters (Phase 4) ---------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-10-16', 1535.250);
insert into public.meter_readings (meter_id, reading_date, reading_value, is_estimate, flag, recorded_by) values ('e1000000-0000-0000-0000-000000000001', '2026-11-10', 1785.250, true, 'high', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select flag is null and recorded_by = 'a3000000-0000-0000-0000-000000000001' from public.meter_readings where reading_date = '2026-11-10'), 'caller cannot choose the flag or who recorded a reading');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-11-15', 1785.249)$$, 'reading_below_previous', 'a reading below the previous one is refused');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-10-20', 1785.251)$$, 'reading_above_next', 'a backdated reading above the next one is refused');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', public.business_today() + 1, 9999)$$, 'reading_in_future', 'a future reading is refused');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2025-01-14', 1)$$, 'reading_before_install', 'a reading before installation is refused');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-11-10', 1785.250)$$, 'meter_readings_meter_id_reading_date_key', 'two readings on one day are refused');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2025-02-15', -1)$$, 'meter_readings_reading_value_check', 'a negative reading is refused');
select pg_temp.expect((select consumption = 150 and days = 15 and not consumption_is_estimate from public.meter_reading_history where reading_date = '2026-10-16'), 'consumption = difference between consecutive readings');
select pg_temp.expect((select consumption is null from public.meter_reading_history where meter_id = 'e1000000-0000-0000-0000-000000000001' and reading_date = '2026-09-01'), 'the first reading has no consumption');
select pg_temp.expect((select consumption_is_estimate from public.meter_reading_history where reading_date = '2026-11-10'), 'an interval ending in an estimate is an estimate');
select pg_temp.expect((select kwh = 184.75 and days_covered = 30 from public.meter_monthly_consumption where meter_id = 'e1000000-0000-0000-0000-000000000001' and month = '2026-09-01'), 'September: one interval, the whole month');
select pg_temp.expect((select kwh = 310 and days_covered = 31 and has_estimate from public.meter_monthly_consumption where meter_id = 'e1000000-0000-0000-0000-000000000001' and month = '2026-10-01'), 'October: 150 + 16 of 25 days of 250 = 310');
select pg_temp.expect((select kwh = 90 and days_covered = 9 from public.meter_monthly_consumption where meter_id = 'e1000000-0000-0000-0000-000000000001' and month = '2026-11-01'), 'November: 9 of 25 days of 250 = 90, partial month');
select pg_temp.expect((select sum(kwh) from public.meter_monthly_consumption where meter_id = 'e1000000-0000-0000-0000-000000000001') = 584.75, 'monthly split adds up to the total consumption');
insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-11-20', 2785.250);
select pg_temp.expect((select flag from public.meter_readings where reading_date = '2026-11-20') = 'high', 'over three times normal use is flagged high');
delete from public.meter_readings where reading_date = '2026-11-20';
select pg_temp.expect((select count(*) from public.meter_readings where reading_date = '2026-11-20') = 1, 'staff cannot delete a reading');
update public.meter_readings set reading_value = 1 where reading_date = '2026-11-20';
select pg_temp.expect((select reading_value from public.meter_readings where reading_date = '2026-11-20') = 2785.25, 'readings cannot be edited');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
delete from public.meter_readings where reading_date = '2026-11-20';
select pg_temp.expect((select details ->> 'reading_value' from pg_temp.audit_rows() where table_name = 'meter_readings' and action = 'DELETE') = '2785.250', 'a manager can remove a reading and the audit keeps its value');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-11-20', 1790.250);
select pg_temp.expect((select flag from public.meter_readings where reading_date = '2026-11-20') = 'low', 'under a fifth of normal use is flagged low');
select pg_temp.expect((select estimated_monthly = 243 and latest_value = 1790.25 and latest_flag = 'low' and customer_name = 'Cleo Client' from public.meter_directory where serial_number = 'MTR-0001'), 'directory: latest reading and 405 kWh over 50 days x 30');

-- Registering
select public.register_meter('d1000000-0000-0000-0000-000000000001', ' MTR-0100 ', 'smart_prepaid', 'residential_sub', '2026-08-01', 10, 'Kitchen');
select pg_temp.expect((select r.reading_value = 10 and m.installed_on = r.reading_date from public.electricity_meters m join public.meter_readings r on r.meter_id = m.id where m.serial_number = 'MTR-0100'), 'registering stores the trimmed serial and the initial reading');
select pg_temp.expect_error_like($$select public.register_meter('d1000000-0000-0000-0000-000000000001', 'mtr-0100', 'smart_prepaid', 'residential_sub', '2026-08-01', 0)$$, 'meters_business_serial_ci_uniq', 'a duplicate serial is refused whatever its case');
select pg_temp.expect_error_like($$select public.register_meter('d1000000-0000-0000-0000-000000000001', 'MTR-0101', 'smart_prepaid', 'residential_sub', '2026-08-01', -5)$$, 'meter_readings_reading_value_check', 'a negative initial reading is refused');
select pg_temp.expect(not exists (select 1 from public.electricity_meters where serial_number = 'MTR-0101'), 'and leaves no half-registered meter');
select pg_temp.expect_error_like($$select public.register_meter('d1000000-0000-0000-0000-000000000001', 'MTR-0102', 'smart_prepaid', 'residential_sub', public.business_today() + 1, 0)$$, 'meter_installed_in_future', 'a future installation is refused');
select pg_temp.expect_error_like($$update public.electricity_meters set installed_on = '2026-09-15' where serial_number = 'MTR-0001'$$, 'meter_installed_after_reading', 'installation cannot move past existing readings');

-- Maintenance
insert into public.meter_maintenance (meter_id, issue, priority, scheduled_for, assigned_to) values ('e1000000-0000-0000-0000-000000000001', 'Display blank', 'urgent', '2026-01-05', 'a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select is_open and is_overdue and priority_rank = 1 and assigned_name = 'Sam Staff' and serial_number = 'MTR-0001' from public.maintenance_list), 'open work past its date is overdue');
select pg_temp.expect((select scheduled = 1 and urgent = 1 and overdue = 1 from public.maintenance_summary), 'maintenance summary counts it');
select pg_temp.expect_error_like($$insert into public.meter_maintenance (meter_id, issue, scheduled_for, assigned_to) values ('e1000000-0000-0000-0000-000000000001', 'Display blank', '2026-12-01', 'a4000000-0000-0000-0000-000000000001')$$, 'maintenance_assignee_not_staff', 'work cannot be assigned to a client');
select pg_temp.expect_error_like($$insert into public.meter_maintenance (meter_id, issue, scheduled_for, assigned_to) values ('e1000000-0000-0000-0000-000000000001', 'Display blank', '2026-12-01', 'b1000000-0000-0000-0000-000000000001')$$, 'maintenance_assignee_not_staff', 'work cannot be assigned to another business');
select pg_temp.expect_error_like($$insert into public.meter_maintenance (meter_id, issue) values ('e1000000-0000-0000-0000-000000000001', 'Display blank')$$, 'maintenance_scheduled_has_date', 'scheduled work needs a date');
select pg_temp.expect_error_like($$update public.meter_maintenance set status = 'completed'$$, 'maintenance_completed_has_outcome', 'completing needs an outcome');
update public.meter_maintenance set status = 'completed', outcome = 'Replaced display', completed_on = '2099-01-01';
select pg_temp.expect((select completed_on = public.business_today() from public.meter_maintenance), 'completion date is set by the database and never in the future');
update public.meter_maintenance set status = 'in_progress';
select pg_temp.expect((select completed_on is null from public.meter_maintenance), 'reopening clears the completion date');

-- Replacing and decommissioning
select pg_temp.expect_error_like($$select public.retire_meter('e1000000-0000-0000-0000-000000000001', '2026-11-19', 'Faulty display')$$, 'meter_retired_before_reading', 'cannot retire before the last reading');
select pg_temp.expect_error_like($$select public.retire_meter('e1000000-0000-0000-0000-000000000001', '2026-11-22', 'Faulty display', 1800, 'MTR-0100')$$, 'meters_business_serial_ci_uniq|serial_number_key', 'replacement serial must be new');
select pg_temp.expect((select status = 'active' from public.electricity_meters where serial_number = 'MTR-0001') and not exists (select 1 from public.meter_readings where reading_date = '2026-11-22'), 'a failed replacement changes nothing');
select public.retire_meter('e1000000-0000-0000-0000-000000000001', '2026-11-22', 'Faulty display', 1800, 'MTR-0200', 5);
select pg_temp.expect((select o.status = 'replaced' and o.retired_on = '2026-11-22' and n.serial_number = 'MTR-0200' and n.property_id = o.property_id and n.installed_on = '2026-11-22' from public.electricity_meters o join public.electricity_meters n on n.id = o.replaced_by_id where o.serial_number = 'MTR-0001'), 'replacement links the new meter on the same property');
select pg_temp.expect((select count(*) = 2 and bool_or(reading_value = 1800) and bool_or(reading_value = 5) from public.meter_readings where reading_date = '2026-11-22'), 'final and initial readings are recorded');
select pg_temp.expect((select count(*) filter (where status = 'cancelled') = 1 and count(*) filter (where status = 'completed' and kind = 'replacement') = 1 from public.meter_maintenance), 'open work is cancelled and the replacement is in the history');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000001', '2026-11-23', 1900)$$, 'reading_after_retirement', 'no readings after retirement');
select pg_temp.expect_error_like($$select public.retire_meter('e1000000-0000-0000-0000-000000000001', '2026-11-22', 'Again please')$$, '^meter_retired$', 'a meter cannot be retired twice');
select pg_temp.expect_error_like($$update public.electricity_meters set status = 'active', retired_on = null where serial_number = 'MTR-0001'$$, '^meter_retired$', 'staff cannot put a retired meter back into service');
select pg_temp.expect((select retired = 1 and in_service = 3 from public.meter_summary), 'summary separates retired meters from those in service');
select public.retire_meter((select id from public.electricity_meters where serial_number = 'MTR-0100'), '2026-11-22', 'Property demolished');
select pg_temp.expect((select status = 'decommissioned' and replaced_by_id is null from public.electricity_meters where serial_number = 'MTR-0100'), 'without a new serial the meter is decommissioned');
select pg_temp.expect_error_like($$update public.electricity_meters set status = 'replaced' where serial_number = 'MTR-0002'$$, 'meters_retired_has_date', 'a retired status needs a date');

-- Isolation
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.meter_directory where serial_number = 'MTR-0002') = 0 and (select count(*) from public.meter_directory) = 3, 'client directory shows only their own meters');
select pg_temp.expect((select count(*) from public.monthly_consumption) = 3, 'client sees consumption for their own meters');
select pg_temp.expect((select count(*) from public.meter_maintenance) = 0 and (select count(*) from public.maintenance_list) = 0, 'client cannot see maintenance');
select pg_temp.expect_error_like($$insert into public.meter_readings (business_id, meter_id, reading_date, reading_value) select business_id, id, '2026-11-24', 999 from public.electricity_meters where serial_number = 'MTR-0200'$$, 'permission denied', 'client cannot record a reading');
select pg_temp.expect_error_like($$select public.register_meter('d1000000-0000-0000-0000-000000000001', 'MTR-0300', 'smart_prepaid', 'residential_sub', '2026-08-01', 0)$$, 'row-level security', 'client cannot register a meter');
select pg_temp.expect_error_like($$select public.retire_meter((select id from public.electricity_meters where serial_number = 'MTR-0200'), '2026-11-24', 'Do not want it')$$, 'meter_not_found', 'client cannot retire a meter');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.meter_directory) + (select count(*) from public.meter_reading_history) + (select count(*) from public.maintenance_list) + (select count(*) from public.meter_summary) + (select count(*) from public.monthly_consumption) = 0, 'another business sees no meter data through any view');
select pg_temp.expect_error_like($$select public.register_meter('d1000000-0000-0000-0000-000000000001', 'MTR-0400', 'smart_prepaid', 'residential_sub', '2026-08-01', 0)$$, 'electricity_meters_property_id_fkey', 'a meter cannot be linked to another business''s property');
select pg_temp.expect_error_like($$insert into public.meter_readings (meter_id, reading_date, reading_value) values ('e1000000-0000-0000-0000-000000000002', '2026-11-01', 1)$$, 'reading_meter_not_found', 'a reading cannot be added to another business''s meter');
select pg_temp.expect_error_like($$insert into public.meter_readings (business_id, meter_id, reading_date, reading_value) values ('11111111-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '2026-11-01', 1)$$, 'permission denied', 'claiming the other business does not reveal its readings');
select pg_temp.expect_error_like($$insert into public.meter_maintenance (meter_id, issue, scheduled_for) values ('e1000000-0000-0000-0000-000000000002', 'Not ours', '2026-12-01')$$, 'maintenance_meter_fkey', 'maintenance cannot be added to another business''s meter');
select pg_temp.expect_error_like($$insert into public.properties (customer_id, address) values ('c1000000-0000-0000-0000-000000000001', '1 Stolen Street')$$, 'properties_customer_id_fkey', 'a property cannot be linked to another business''s customer');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.meter_directory$$, 'permission denied', 'anonymous cannot read the meter list');
select pg_temp.expect_error_like($$set local role anon; select * from public.meter_maintenance$$, 'permission denied', 'anonymous cannot read maintenance');
select pg_temp.expect_error_like($$set local role anon; select public.retire_meter('e1000000-0000-0000-0000-000000000002', '2026-11-24', 'Anonymous')$$, 'permission denied for function', 'anonymous cannot call meter functions');

-- Leads, sales and orders (Phase 5) ---------------------------------------------------------------
-- References kept across steps in a temp table every role may use.
select pg_temp.as_owner();
create temp table ref (k text primary key, id uuid) on commit drop;
grant all on ref to authenticated, anon;

select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into public.leads (name, company_name, email, phone, source, estimated_value, assigned_to, follow_up_on)
  values ('Gavin Petersen', 'Melrose Arch Holdings', 'gavin@melrose.test', '+27116842200', 'referral', 540000, 'a3000000-0000-0000-0000-000000000001', '2026-01-05');
insert into ref select 'lead', id from public.leads where name = 'Gavin Petersen';
select pg_temp.expect((select is_open and follow_up_overdue and assigned_name = 'Sam Staff' and reference ~ '^LEAD-\d{5}$' from public.lead_list where name = 'Gavin Petersen'), 'lead list: open, overdue follow-up, assignee, reference');
select pg_temp.expect((select total_value = 540000 and lead_count = 2 from public.lead_summary where status = 'new'), 'lead summary counts and values by stage');
select pg_temp.expect_error_like($$insert into public.leads (name, status, lost_reason) values ('X Y', 'lost', 'no budget')$$, 'lead_transition', 'a lead cannot start closed');
select pg_temp.expect_error_like($$insert into public.leads (name, source) values ('X Y', 'billboard')$$, 'leads_source_check', 'unknown source is refused');
select pg_temp.expect_error_like($$insert into public.leads (name, assigned_to) values ('X Y', 'a4000000-0000-0000-0000-000000000001')$$, 'assignee_not_staff', 'a lead cannot be assigned to a client');
select pg_temp.expect_error_like($$insert into public.leads (name, assigned_to) values ('X Y', 'b1000000-0000-0000-0000-000000000001')$$, 'assignee_not_staff', 'a lead cannot be assigned to another business');
select pg_temp.expect_error_like($$insert into public.leads (name, estimated_value) values ('X Y', -1)$$, 'estimated_value_check', 'a negative value is refused');
select pg_temp.expect_error_like($$update public.leads set status = 'lost' where name = 'Gavin Petersen'$$, 'leads_lost_has_reason', 'losing a lead needs a reason');
update public.leads set status = 'lost', lost_reason = 'No budget' where name = 'Gavin Petersen';
select pg_temp.expect((select closed_on = public.business_today() from public.leads where name = 'Gavin Petersen'), 'closing a lead records the date');
update public.leads set status = 'contacted' where name = 'Gavin Petersen';
select pg_temp.expect((select closed_on is null and lost_reason is null from public.leads where name = 'Gavin Petersen'), 'reopening clears the closing date and reason');

-- Conversion
select pg_temp.expect_error_like($$select public.convert_lead((select id from ref where k = 'lead'))$$, 'lead_not_approved', 'only an approved lead can be converted');
select pg_temp.expect_error_like($$update public.leads set status = 'converted', converted_customer_id = 'c1000000-0000-0000-0000-000000000001' where name = 'Gavin Petersen'$$, 'lead_not_approved', 'nor by editing it directly');
update public.leads set status = 'qualified' where name = 'Gavin Petersen';
insert into ref select 'cust', public.convert_lead((select id from ref where k = 'lead'));
select pg_temp.expect((select name = 'Gavin Petersen' and customer_type = 'business' and company_name = 'Melrose Arch Holdings' and email = 'gavin@melrose.test' and business_id = '11111111-0000-0000-0000-000000000001' from public.customers where id = (select id from ref where k = 'cust')), 'conversion creates the customer from the lead');
select pg_temp.expect((select status = 'converted' and converted_customer_id = (select id from ref where k = 'cust') and closed_on is not null from public.leads where name = 'Gavin Petersen'), 'and links it');
select pg_temp.expect_error_like($$select public.convert_lead((select id from ref where k = 'lead'))$$, 'lead_converted', 'a lead cannot be converted twice');
select pg_temp.expect_error_like($$update public.leads set status = 'qualified', converted_customer_id = null where name = 'Gavin Petersen'$$, 'lead_converted', 'a conversion cannot be undone by editing');
insert into public.leads (name, email, status) values ('G Petersen', ' GAVIN@melrose.test ', 'qualified');
select pg_temp.expect((select matched_on = 'email' from public.lead_matches((select id from public.leads where name = 'G Petersen'))), 'matches an existing customer by email, ignoring case and spaces');
select pg_temp.expect_error_like($$select public.convert_lead((select id from public.leads where name = 'G Petersen'), null, true)$$, 'lead_customer_exists', 'a duplicate email never creates a second customer');
select pg_temp.expect(public.convert_lead((select id from public.leads where name = 'G Petersen'), (select id from ref where k = 'cust')) = (select id from ref where k = 'cust') and (select count(*) from public.customers where name like '%Petersen') = 1, 'it can be linked to the existing customer instead');
insert into public.leads (name, phone, status) values ('Front Desk', '011 684 2200', 'proposal');
select pg_temp.expect((select matched_on = 'phone' from public.lead_matches((select id from public.leads where name = 'Front Desk'))), 'matches a phone typed in another format');
select pg_temp.expect_error_like($$select public.convert_lead((select id from public.leads where name = 'Front Desk'))$$, 'lead_customer_exists', 'a shared phone is refused by default');
select pg_temp.expect(public.convert_lead((select id from public.leads where name = 'Front Desk'), null, true) is not null, 'and allowed when confirmed');
insert into public.leads (name, phone, status) values ('No Contact', '123', 'qualified');
select pg_temp.expect(not exists (select 1 from public.lead_matches((select id from public.leads where name = 'No Contact'))), 'a short phone number or missing email matches nobody');
select pg_temp.expect_error_like($$select public.convert_lead((select id from public.leads where name = 'No Contact'), 'c2000000-0000-0000-0000-000000000001')$$, 'leads_converted_customer_id_fkey', 'a lead cannot be linked to another business''s customer');
select pg_temp.expect((select array_agg(to_status order by created_at, to_status) @> array['new', 'lost', 'contacted', 'qualified', 'converted'] and bool_and(actor_name = 'Sam Staff') from public.sales_timeline where lead_id = (select id from ref where k = 'lead')), 'every stage change is in the lead history with who made it');

-- Order totals
insert into ref select 'order', public.save_order(null, (select id from ref where k = 'cust'),
  '[{"description":" CT meter ","quantity":"2","unit_price":"120000.00"},{"product_id":"f1000000-0000-0000-0000-000000000001","description":"Prepaid meter","quantity":"1","unit_price":"46000"}]'::jsonb,
  p_lead_id => (select id from ref where k = 'lead'), p_assigned_to => 'a3000000-0000-0000-0000-000000000001', p_discount_percent => 5);
select pg_temp.expect((select subtotal = 286000 and discount = 14300 and tax = 40755 and total = 312455 and status = 'pending' and created_by = 'a3000000-0000-0000-0000-000000000001' from public.orders where id = (select id from ref where k = 'order')), 'totals: 286000 less 5% plus 15% VAT = 312455');
select pg_temp.expect((select item_count = 2 and first_item = 'CT meter' and reference ~ '^ORD-\d{5}$' and customer_name = 'Gavin Petersen' from public.order_list where id = (select id from ref where k = 'order')), 'order list shows its lines in order');
update public.orders set total = 1, subtotal = 1, tax = 0 where id = (select id from ref where k = 'order');
select pg_temp.expect((select total = 312455 from public.orders where id = (select id from ref where k = 'order')), 'a total sent by the caller is ignored');
insert into ref select 'o2', public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Odd cents","quantity":3,"unit_price":0.35}]'::jsonb, p_discount_percent => 33.33);
select pg_temp.expect((select subtotal = 1.05 and discount = 0.35 and tax = 0.11 and total = 0.81 from public.orders where id = (select id from ref where k = 'o2')), 'cents round half up: 1.05 - 0.35 + 0.11 = 0.81 (0.105 rounds to 0.11)');
select public.save_order((select id from ref where k = 'o2'), (select id from ref where k = 'cust'), '[{"description":"Replaced line","quantity":4,"unit_price":25}]'::jsonb, p_vat_rate => 0);
select pg_temp.expect((select total = 100 and tax = 0 and discount = 0 from public.orders where id = (select id from ref where k = 'o2')) and (select count(*) from public.order_items where order_id = (select id from ref where k = 'o2')) = 1, 'staff editing an order replaces its lines rather than adding to them');

-- Invalid orders
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[]'::jsonb)$$, 'order_empty', 'an order needs a line');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":0,"unit_price":1}]'::jsonb)$$, 'order_items_quantity_check', 'zero quantity is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1.5,"unit_price":1}]'::jsonb)$$, 'invalid input syntax', 'fractional quantity is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1,"unit_price":-1}]'::jsonb)$$, 'order_items_unit_price_check', 'negative price is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":" ","quantity":1,"unit_price":1}]'::jsonb)$$, 'order_items_description_check', 'a line needs a description');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb, p_discount_percent => 101)$$, 'discount_percent_check', 'discount over 100% is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb, p_vat_rate => 10)$$, 'vat_rate_check', 'an unknown VAT rate is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb, p_order_date => public.business_today() + 1)$$, 'order_date_future', 'a future order date is refused');
select pg_temp.expect_error_like($$select public.save_order(null, (select id from ref where k = 'cust'), '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb, p_property_id => 'd1000000-0000-0000-0000-000000000001')$$, 'order_property_mismatch', 'the property must belong to the customer');
select pg_temp.expect_error_like($$select public.save_order(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb, p_lead_id => (select id from ref where k = 'lead'))$$, 'order_lead_mismatch', 'the lead must have become this customer');
select pg_temp.expect_error_like($$insert into public.orders (customer_id, status) values ('c1000000-0000-0000-0000-000000000001', 'fulfilled')$$, 'order_transition', 'an order cannot start fulfilled');
select pg_temp.expect((select count(*) from public.orders) = 2, 'failed saves leave nothing behind');

-- Workflow
select pg_temp.expect_error_like($$update public.orders set status = 'fulfilled' where id = (select id from ref where k = 'order')$$, 'order_transition', 'cannot skip confirmation');
insert into public.orders (customer_id) values ('c1000000-0000-0000-0000-000000000001');
select pg_temp.expect_error_like($$update public.orders set status = 'confirmed' where customer_id = 'c1000000-0000-0000-0000-000000000001'$$, 'order_empty', 'an empty order cannot be confirmed');
update public.orders set status = 'confirmed' where id = (select id from ref where k = 'order');
select pg_temp.expect_error_like($$select public.save_order((select id from ref where k = 'order'), (select id from ref where k = 'cust'), '[{"description":"Cheaper","quantity":1,"unit_price":1}]'::jsonb)$$, 'order_locked', 'a confirmed order cannot be edited');
select pg_temp.expect_error_like($$update public.orders set discount_percent = 90 where id = (select id from ref where k = 'order')$$, 'order_locked', 'nor its discount changed');
select pg_temp.expect_error_like($$update public.order_items set unit_price = 1 where order_id = (select id from ref where k = 'order')$$, 'order_locked', 'nor its lines');
select pg_temp.expect_error_like($$insert into public.order_items (order_id, description, quantity, unit_price) values ((select id from ref where k = 'order'), 'Extra', 1, 1)$$, 'order_locked', 'nor lines added');
delete from public.order_items where order_id = (select id from ref where k = 'order');
select pg_temp.expect((select count(*) from public.order_items where order_id = (select id from ref where k = 'order')) = 2, 'nor lines removed');
select pg_temp.expect((select count(*) from public.sales) = 0, 'no sale before fulfilment');
select pg_temp.expect_error_like($$insert into public.sales (customer_id, order_id, amount) values ((select id from ref where k = 'cust'), (select id from ref where k = 'order'), 9999999)$$, 'row-level security', 'a sale for an order cannot be invented');
update public.orders set status = 'fulfilled' where id = (select id from ref where k = 'order');
select pg_temp.expect((select amount = 271700 and lead_id = (select id from ref where k = 'lead') and sold_by = 'a3000000-0000-0000-0000-000000000001' from public.sales where order_id = (select id from ref where k = 'order')), 'fulfilment records the sale without VAT, linked to its lead');
update public.sales set amount = 1 where order_id = (select id from ref where k = 'order');
select pg_temp.expect((select amount = 271700 from public.sales where order_id = (select id from ref where k = 'order')), 'and its amount cannot be changed');
select pg_temp.expect_error_like($$update public.orders set status = 'cancelled', cancel_reason = 'Changed mind' where id = (select id from ref where k = 'order')$$, 'order_transition', 'a fulfilled order is final');
select pg_temp.expect_error_like($$update public.orders set status = 'cancelled' where id = (select id from ref where k = 'o2')$$, 'orders_cancelled_has_reason', 'cancelling needs a reason');
update public.orders set status = 'cancelled', cancel_reason = 'Changed mind' where id = (select id from ref where k = 'o2');
select pg_temp.expect((select pending_count = 1 and confirmed_count = 0 and fulfilled_count = 1 and cancelled_count = 1 from public.sales_summary), 'sales summary counts by status');
select pg_temp.expect((select total = 271700 and sale_count = 1 and month = date_trunc('month', public.business_today())::date from public.monthly_sales), 'monthly sales excludes VAT and unfulfilled orders');
select pg_temp.expect((select count(*) = 3 from public.sales_timeline where order_id = (select id from ref where k = 'order')) and (select note = 'Changed mind' from public.sales_timeline where order_id = (select id from ref where k = 'o2') and to_status = 'cancelled'), 'order history records each step and the cancellation reason');
select pg_temp.expect_error_like($$insert into public.sales_events (business_id, lead_id, to_status) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'lead'), 'won')$$, 'permission denied', 'history cannot be forged');
select pg_temp.expect_error_like($$delete from public.sales_events$$, 'permission denied', 'or erased');

-- Activities
insert into public.sales_activities (lead_id, kind, subject, due_on, assigned_to) values ((select id from ref where k = 'lead'), 'call', 'Proposal review', '2026-01-05', 'a3000000-0000-0000-0000-000000000001');
insert into public.sales_activities (order_id, kind, subject, completed_at) values ((select id from ref where k = 'order'), 'meeting', 'Site handover', '2000-01-01');
select pg_temp.expect((select is_open and is_overdue and assigned_name = 'Sam Staff' and subject_name = 'Melrose Arch Holdings' from public.sales_activity_list where kind = 'call'), 'activity list: overdue, assignee and what it is about');
select pg_temp.expect((select completed_at = now() and not is_open from public.sales_activity_list where kind = 'meeting'), 'when an activity was done is set by the database');
select pg_temp.expect_error_like($$insert into public.sales_activities (kind, subject) values ('call', 'About nothing')$$, 'sales_activities_one_subject', 'an activity needs a lead or an order');
select pg_temp.expect_error_like($$insert into public.sales_activities (lead_id, kind, subject, assigned_to) values ((select id from ref where k = 'lead'), 'call', 'For a client', 'a4000000-0000-0000-0000-000000000001')$$, 'assignee_not_staff', 'activities are assigned to staff only');

-- Isolation
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1 owns customer c1 and its empty order
select pg_temp.expect((select count(*) from public.order_list) = 1, 'client sees only their own orders');
select pg_temp.expect((select count(*) from public.lead_list) + (select count(*) from public.sales_timeline) + (select count(*) from public.sales_activity_list) + (select count(*) from public.monthly_sales) + (select count(*) from public.lead_summary) = 0, 'client sees no leads, history, activities or sales');
select pg_temp.expect_error_like($$select public.save_order(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb)$$, 'permission denied', 'client cannot create an order');
update public.orders set status = 'confirmed';
select pg_temp.expect((select status = 'pending' from public.orders), 'client cannot change an order');
select pg_temp.expect_error_like($$select public.convert_lead((select id from ref where k = 'lead'))$$, 'lead_not_found', 'client cannot convert a lead');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.lead_list) + (select count(*) from public.order_list) + (select count(*) from public.sales_summary) + (select count(*) from public.monthly_sales) + (select count(*) from public.sales_timeline) + (select count(*) from public.sales_activity_list) = 0, 'another business sees nothing through any view');
select pg_temp.expect(not exists (select 1 from public.lead_matches((select id from ref where k = 'lead'))), 'nor through lead matching');
select pg_temp.expect_error_like($$select public.save_order(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb)$$, 'orders_customer_id_fkey', 'an order cannot use another business''s customer');
select pg_temp.expect_error_like($$select public.save_order(null, 'c2000000-0000-0000-0000-000000000001', '[{"product_id":"f1000000-0000-0000-0000-000000000001","description":"Thing","quantity":1,"unit_price":1}]'::jsonb)$$, 'order_items_product_id_fkey', 'or its product');
select pg_temp.expect_error_like($$select public.save_order((select id from ref where k = 'order'), 'c2000000-0000-0000-0000-000000000001', '[{"description":"Thing","quantity":1,"unit_price":1}]'::jsonb)$$, 'order_not_found', 'or edit its order');
select pg_temp.expect_error_like($$insert into public.order_items (order_id, description, quantity, unit_price) values ((select id from ref where k = 'order'), 'Extra', 1, 1)$$, 'order_items_order_id_fkey', 'or add lines to it');
select pg_temp.expect_error_like($$insert into public.order_items (business_id, order_id, description, quantity, unit_price) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'order'), 'Extra', 1, 1)$$, 'permission denied', 'claiming the other business reveals nothing');
select pg_temp.expect_error_like($$insert into public.sales_activities (lead_id, kind, subject) values ((select id from ref where k = 'lead'), 'call', 'Not ours')$$, 'sales_activities_lead_fkey', 'or add activities to its leads');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.order_list$$, 'permission denied', 'anonymous cannot read orders');
select pg_temp.expect_error_like($$set local role anon; select * from public.sales_activities$$, 'permission denied', 'anonymous cannot read activities');
select pg_temp.expect_error_like($$set local role anon; select public.convert_lead(gen_random_uuid())$$, 'permission denied for function', 'anonymous cannot call sales functions');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
delete from public.orders where id = (select id from ref where k = 'o2');
select pg_temp.expect(not exists (select 1 from public.order_items where order_id = (select id from ref where k = 'o2')), 'a manager can delete an order and its lines go with it');

-- Invoices and payments (Phase 6) ----------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select status = 'partially_paid' and invoice_number = 'INV-0001' from public.invoices where id = 'a0100000-0000-0000-0000-000000000001'), 'existing invoices keep their status and number');
select pg_temp.expect((select invoice_number is null from public.invoices where id = 'a0100000-0000-0000-0000-000000000002'), 'a draft has no number');

-- Drafts and totals
insert into ref select 'inv', public.save_invoice(null, (select id from ref where k = 'cust'),
  '[{"description":"CT meter","quantity":2,"unit_price":120000},{"description":"Installation","quantity":1,"unit_price":46000}]'::jsonb,
  p_discount_percent => 5, p_payment_terms => 'net14');
select pg_temp.expect((select status = 'draft' and subtotal = 286000 and discount = 14300 and tax = 40755 and total = 312455 and invoice_number is null and created_by = 'a3000000-0000-0000-0000-000000000001' from public.invoices where id = (select id from ref where k = 'inv')), 'draft totals: 286000 less 5% plus 15% VAT = 312455');
update public.invoices set total = 1, subtotal = 1 where id = (select id from ref where k = 'inv');
select pg_temp.expect((select total = 312455 from public.invoices where id = (select id from ref where k = 'inv')), 'a total sent by the caller is ignored');
select public.save_invoice((select id from ref where k = 'inv'), (select id from ref where k = 'cust'), '[{"description":"CT meter","quantity":2,"unit_price":100000}]'::jsonb, p_payment_terms => 'net14');
select pg_temp.expect((select total = 230000 from public.invoices where id = (select id from ref where k = 'inv')) and (select count(*) from public.invoice_items where invoice_id = (select id from ref where k = 'inv')) = 1, 'editing a draft replaces its lines');
select pg_temp.expect_error_like($$select public.save_invoice(null, (select id from ref where k = 'cust'), '[]'::jsonb)$$, 'invoice_empty', 'an invoice needs a line');
select pg_temp.expect_error_like($$select public.save_invoice(null, (select id from ref where k = 'cust'), '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb, p_property_id => 'd1000000-0000-0000-0000-000000000001')$$, 'invoice_property_mismatch', 'the property must belong to the customer');
select pg_temp.expect_error_like($$select public.save_invoice(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb, p_order_id => (select id from ref where k = 'order'))$$, 'invoice_order_mismatch', 'the order must belong to the customer');
select pg_temp.expect_error_like($$insert into public.invoices (customer_id, status, total) values ('c1000000-0000-0000-0000-000000000001', 'paid', 10)$$, 'invoice_transition', 'an invoice cannot be created already paid');
select pg_temp.expect_error_like($$update public.invoices set status = 'paid' where id = (select id from ref where k = 'inv')$$, 'invoice_transition', 'a draft cannot jump to paid');

-- Issuing
select pg_temp.expect_error_like($$update public.invoices set status = 'sent', issue_date = public.business_today() + 1 where id = (select id from ref where k = 'inv')$$, 'invoice_date_future', 'an invoice cannot be issued with a future date');
update public.invoices set status = 'sent' where id = (select id from ref where k = 'inv');
select pg_temp.expect((select invoice_number = 'INV-' || extract(year from public.business_today()) || '-00001' and issue_date = public.business_today() and due_date = public.business_today() + 14 and sent_at is not null and issued_by = 'a3000000-0000-0000-0000-000000000001' from public.invoices where id = (select id from ref where k = 'inv')), 'issuing numbers the invoice and sets its dates from the terms');
insert into ref select 'inv2', public.save_invoice(null, (select id from ref where k = 'cust'), '[{"description":"Callout","quantity":1,"unit_price":100}]'::jsonb, p_vat_rate => 0);
update public.invoices set status = 'sent' where id = (select id from ref where k = 'inv2');
select pg_temp.expect((select invoice_number like '%-00002' from public.invoices where id = (select id from ref where k = 'inv2')), 'numbers follow on without gaps');
select pg_temp.expect_error_like($$select public.save_invoice((select id from ref where k = 'inv'), (select id from ref where k = 'cust'), '[{"description":"Cheaper","quantity":1,"unit_price":1}]'::jsonb)$$, 'invoice_locked', 'an issued invoice cannot be edited');
select pg_temp.expect_error_like($$update public.invoices set due_date = due_date + 30 where id = (select id from ref where k = 'inv')$$, 'invoice_locked', 'nor its due date');
select pg_temp.expect_error_like($$update public.invoices set invoice_number = 'INV-1' where id = (select id from ref where k = 'inv')$$, 'invoice_locked', 'nor its number');
select pg_temp.expect_error_like($$insert into public.invoice_items (invoice_id, description, quantity, unit_price) values ((select id from ref where k = 'inv'), 'Extra', 1, 1)$$, 'invoice_locked', 'nor lines added');
delete from public.invoice_items where invoice_id = (select id from ref where k = 'inv');
select pg_temp.expect((select count(*) from public.invoice_items where invoice_id = (select id from ref where k = 'inv')) = 1, 'nor lines removed');
update public.invoices set status = 'paid' where id = (select id from ref where k = 'inv');
select pg_temp.expect((select status = 'sent' from public.invoices where id = (select id from ref where k = 'inv')), 'it cannot be marked paid without payments');

-- Payments
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ('a0100000-0000-0000-0000-000000000002', 10)$$, 'invoice_not_payable', 'a draft cannot be paid');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ((select id from ref where k = 'inv'), 230000.01)$$, 'payment_exceeds_balance', 'a payment cannot exceed the balance');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ((select id from ref where k = 'inv'), 0)$$, 'payments_amount_check', 'a payment must be positive');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount, paid_at) values ((select id from ref where k = 'inv'), 1, now() + interval '2 days')$$, 'payment_in_future', 'a payment cannot be in the future');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount, paid_at) values ((select id from ref where k = 'inv'), 1, now() - interval '30 days')$$, 'payment_before_issue', 'a payment cannot predate the invoice');
insert into public.payments (invoice_id, amount, reference, method, recorded_by) values ((select id from ref where k = 'inv'), 100000, 'FNB-1', 'eft', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select status = 'partially_paid' and paid = 100000 and balance = 130000 and display_status = 'partially_paid' from public.invoice_list where id = (select id from ref where k = 'inv')), 'a part payment leaves a balance and marks it partially paid');
select pg_temp.expect((select recorded_by = 'a3000000-0000-0000-0000-000000000001' from public.payments where reference = 'FNB-1'), 'who recorded a payment is the database''s to say');
select pg_temp.expect((select amount = 100000 from public.payments where reference = 'FNB-1'), 'a payment amount cannot be changed');
insert into public.payments (invoice_id, amount, reference) values ((select id from ref where k = 'inv'), 130000, 'FNB-2');
select pg_temp.expect((select status = 'paid' and balance = 0 from public.invoice_list where id = (select id from ref where k = 'inv')), 'paying the rest marks it paid');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ((select id from ref where k = 'inv'), 1)$$, 'invoice_not_payable', 'a paid invoice takes no more payments');
select pg_temp.expect((select count(*) = 6 and array_agg(coalesce(from_status, '-') || '>' || to_status) @> array['->draft', 'draft>sent', 'sent>partially_paid', 'payment>partially_paid', 'partially_paid>paid', 'payment>paid'] from public.sales_timeline where invoice_id = (select id from ref where k = 'inv')), 'history: created, issued, each payment and each status change');
delete from public.payments where reference = 'FNB-2';
select pg_temp.expect((select count(*) from public.payments where reference = 'FNB-2') = 1, 'staff cannot remove a payment');

-- Overdue
select pg_temp.expect((select display_status = 'overdue' and is_overdue and balance = 300 from public.invoice_list where invoice_number = 'INV-0003'), 'unpaid past its due date shows as overdue');
insert into ref select 'old', public.save_invoice(null, (select id from ref where k = 'cust'), '[{"description":"Old work","quantity":1,"unit_price":50}]'::jsonb, p_vat_rate => 0);
update public.invoices set status = 'sent', issue_date = public.business_today() - 40 where id = (select id from ref where k = 'old');
select pg_temp.expect((select display_status = 'overdue' and due_date = public.business_today() - 10 from public.invoice_list where id = (select id from ref where k = 'old')), 'a backdated issue takes its due date from the terms, and is overdue');
insert into public.payments (invoice_id, amount, paid_at) values ((select id from ref where k = 'old'), 50, now() - interval '1 day');
select pg_temp.expect((select display_status = 'paid' and not is_overdue from public.invoice_list where id = (select id from ref where k = 'old')), 'once paid, a past-due invoice is no longer overdue');
select pg_temp.expect((select overdue = 1 and overdue_amount = 300 and drafts = 1 and paid = 2 and outstanding = 250 + 300 + 100 from public.invoice_status_summary), 'summary: drafts, paid, overdue and outstanding');

-- Cancelling
select pg_temp.expect_error_like($$update public.invoices set status = 'cancelled', cancel_reason = 'Wrong customer' where id = (select id from ref where k = 'inv2')$$, 'invoice_cancel_manager', 'staff cannot cancel an issued invoice');
update public.invoices set status = 'cancelled', cancel_reason = 'Duplicate' where id = 'a0100000-0000-0000-0000-000000000002';
select pg_temp.expect((select status = 'cancelled' from public.invoices where id = 'a0100000-0000-0000-0000-000000000002'), 'staff can cancel a draft');

-- From an order
select pg_temp.expect_error_like($$select public.invoice_order((select id from public.orders where customer_id = 'c1000000-0000-0000-0000-000000000001'))$$, 'order_not_invoiceable', 'a pending order cannot be invoiced');
insert into ref select 'oinv', public.invoice_order((select id from ref where k = 'order'));
select pg_temp.expect((select total = 312455 and order_id = (select id from ref where k = 'order') and status = 'draft' from public.invoices where id = (select id from ref where k = 'oinv')) and (select count(*) from public.invoice_items where invoice_id = (select id from ref where k = 'oinv')) = 2, 'invoicing an order copies its lines, discount and VAT');
select pg_temp.expect_error_like($$select public.invoice_order((select id from ref where k = 'order'))$$, 'order_already_invoiced', 'an order is invoiced once');

-- Manager
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect_error_like($$update public.invoices set status = 'cancelled', cancel_reason = 'Mistake' where id = (select id from ref where k = 'inv')$$, 'invoice_has_payments', 'an invoice with payments cannot be cancelled');
delete from public.payments where reference = 'FNB-2';
select pg_temp.expect((select status = 'partially_paid' and balance = 130000 from public.invoice_list where id = (select id from ref where k = 'inv')), 'removing a payment reopens the balance');
select pg_temp.expect((select details ->> 'amount' = '130000.00' from pg_temp.audit_rows() where table_name = 'payments' and action = 'DELETE'), 'the audit keeps a removed payment''s amount');
update public.invoices set status = 'cancelled', cancel_reason = 'Customer disputes the work' where id = (select id from ref where k = 'inv2');
select pg_temp.expect((select status = 'cancelled' and invoice_number like '%-00002' from public.invoices where id = (select id from ref where k = 'inv2')), 'a manager can cancel an unpaid issued invoice; its number stays used');
select pg_temp.expect_error_like($$update public.invoices set status = 'sent' where id = (select id from ref where k = 'inv2')$$, 'invoice_transition', 'a cancelled invoice is final');

-- Isolation
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.invoice_list) = 1 and (select count(*) from public.invoice_list where status = 'draft') = 0, 'client sees only their own issued invoices');
select pg_temp.expect((select count(*) from public.payment_list) = 3, 'and only their own payments');
select pg_temp.expect((select name = 'Umbane Energy (Demo)' from public.billing_profile()), 'client can read the supplier details to pay');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ('a0100000-0000-0000-0000-000000000001', 1)$$, 'permission denied', 'client cannot record a payment');
select pg_temp.expect_error_like($$select public.save_invoice(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb)$$, 'permission denied', 'client cannot create an invoice');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.invoice_list) + (select count(*) from public.payment_list) + (select count(*) from public.invoice_status_summary) + (select count(*) from public.invoice_items) = 0, 'another business sees no invoices, lines or payments');
select pg_temp.expect((select name = 'Other Business (Demo)' from public.billing_profile()), 'and only its own supplier details');
select pg_temp.expect_error_like($$insert into public.payments (invoice_id, amount) values ('a0100000-0000-0000-0000-000000000003', 1)$$, 'payment_invoice_not_found', 'nor pay our invoices');
select pg_temp.expect_error_like($$select public.save_invoice(null, 'c1000000-0000-0000-0000-000000000001', '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb)$$, 'invoices_customer_id_fkey', 'nor invoice our customers');
select pg_temp.expect_error_like($$select public.invoice_order((select id from ref where k = 'order'))$$, 'order_not_found', 'nor invoice our orders');
update public.businesses set vat_registered = false;
select pg_temp.expect_error_like($$select public.save_invoice(null, 'c2000000-0000-0000-0000-000000000001', '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb)$$, 'invoice_vat_not_registered', 'a business that is not VAT registered cannot charge VAT');
select pg_temp.expect(public.save_invoice(null, 'c2000000-0000-0000-0000-000000000001', '[{"description":"X1","quantity":1,"unit_price":1}]'::jsonb, p_vat_rate => 0) is not null, 'but can invoice without it');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.invoice_list$$, 'permission denied', 'anonymous cannot read invoices');
select pg_temp.expect_error_like($$set local role anon; select * from public.billing_profile()$$, 'permission denied', 'anonymous cannot read supplier details');
select pg_temp.expect_error_like($$set local role anon; select * from public.invoice_counters$$, 'permission denied', 'nobody reads the counters directly');

-- Inventory (Phase 7) ----------------------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
-- The seeded meter: +20 received, -17 sold, then 1 more sold by fulfilling the Phase 5 order.
select pg_temp.expect((select stock_on_hand = 2 from public.products where sku = 'MTR-PREPAID'), 'stock on hand follows the ledger, including the fulfilled order');
select pg_temp.expect((select quantity = -1 and transaction_type = 'sold' and order_id = (select id from ref where k = 'order') and balance_after = 2 and balance_before = 3 from public.inventory_history where order_id is not null), 'fulfilling an order took its product out, linked to the order');
select pg_temp.expect((select array_agg(balance_after order by number) = array[20, 3, 2] from public.inventory_transactions where product_id = 'f1000000-0000-0000-0000-000000000001'), 'each movement records the balance after it');

insert into ref select 'prod', public.create_product(' CT-400 ', 'Split-core CT set', 4950, 10, p_cost_price => 3420, p_low_stock_threshold => 6, p_category => 'Commercial CT');
select pg_temp.expect((select stock_on_hand = 10 and sku = 'CT-400' and stock_status = 'in' and stock_value = 34200 from public.product_list where id = (select id from ref where k = 'prod')), 'a product starts with its opening stock, recorded as received');
select pg_temp.expect_error_like($$select public.create_product('ct-400', 'Duplicate', 1)$$, 'products_business_sku_ci_uniq', 'a SKU is unique whatever its case');
select pg_temp.expect_error_like($$select public.create_product('BAD SKU!', 'X', 1)$$, 'products_sku_format', 'a SKU has no spaces or symbols');
select pg_temp.expect_error_like($$select public.create_product('NEG-1', 'X', -1)$$, 'products_unit_price_check', 'a price cannot be negative');
select pg_temp.expect_error_like($$select public.create_product('OPEN-1', 'X', 1, -5)$$, 'stock_quantity_sign', 'opening stock cannot be negative');
select pg_temp.expect(not exists (select 1 from public.products where sku in ('NEG-1', 'OPEN-1')), 'and failed creations leave nothing behind');
insert into ref select 'edge', public.create_product('EDGE-1', 'Edge case', 1, 3, p_low_stock_threshold => 3);
select pg_temp.expect((select stock_status = 'low' from public.product_list where id = (select id from ref where k = 'edge')), 'exactly at the minimum counts as low stock');
insert into ref select 'svc', public.create_product('SRV-INSTALL', 'Installation', 1500, p_track_stock => false);

-- Movements
insert into public.inventory_transactions (product_id, transaction_type, quantity, note) values ((select id from ref where k = 'prod'), 'received', 5, 'PO-119');
insert into public.inventory_transactions (product_id, transaction_type, quantity, note) values ((select id from ref where k = 'prod'), 'adjusted', -11, 'Stock count: 11 damaged');
select pg_temp.expect((select stock_on_hand = 4 and stock_status = 'low' from public.product_list where id = (select id from ref where k = 'prod')), 'at or below the threshold is low stock');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity, note) values ((select id from ref where k = 'prod'), 'adjusted', -5, 'Count')$$, 'stock_insufficient', 'stock cannot go below zero');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ((select id from ref where k = 'prod'), 'adjusted', 1)$$, 'stock_reason_required', 'an adjustment needs a reason');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ((select id from ref where k = 'prod'), 'received', -1)$$, 'stock_quantity_sign', 'received stock must be positive');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ((select id from ref where k = 'prod'), 'returned', -1)$$, 'stock_quantity_sign', 'returns add stock');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ((select id from ref where k = 'prod'), 'sold', -1)$$, 'stock_sold_by_order', 'a person cannot record a sale outside an order');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ((select id from ref where k = 'svc'), 'received', 1)$$, 'stock_not_tracked', 'a service has no stock');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity, note) values ((select id from ref where k = 'prod'), 'adjusted', 0, 'Recount')$$, 'inventory_transactions_quantity_check', 'a movement of nothing is refused');
insert into public.inventory_transactions (product_id, transaction_type, quantity, created_at, balance_after, recorded_by) values ((select id from ref where k = 'prod'), 'returned', 1, '2001-01-01', 999, 'a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select balance_after = 5 and created_at > '2020-01-01' and recorded_by = 'a3000000-0000-0000-0000-000000000001' from public.inventory_transactions where transaction_type = 'returned'), 'balance, time and author are the database''s to set');

-- Direct edits
select pg_temp.expect_error_like($$update public.products set stock_on_hand = 1000 where id = (select id from ref where k = 'prod')$$, 'stock_direct_edit', 'the count cannot be edited directly');
select pg_temp.expect_error_like($$update public.products set track_stock = false where id = (select id from ref where k = 'prod')$$, 'stock_not_zero', 'tracking cannot be switched off while stock is held');
update public.products set unit_price = 5100, name = 'Split-core CT set (400A)' where id = (select id from ref where k = 'prod');
select pg_temp.expect((select unit_price = 5100 and stock_on_hand = 5 from public.products where id = (select id from ref where k = 'prod')), 'other details can be edited without touching stock');
update public.inventory_transactions set quantity = 1000 where product_id = (select id from ref where k = 'prod');
delete from public.inventory_transactions where product_id = (select id from ref where k = 'prod');
select pg_temp.expect((select count(*) = 4 and sum(quantity) = 5 from public.inventory_transactions where product_id = (select id from ref where k = 'prod')), 'the ledger cannot be edited or deleted');

-- Orders and stock
insert into ref select 'o3', public.save_order(null, (select id from ref where k = 'cust'), jsonb_build_array(
  jsonb_build_object('product_id', (select id from ref where k = 'prod'), 'description', 'CT set', 'quantity', 4, 'unit_price', 5100),
  jsonb_build_object('product_id', (select id from ref where k = 'prod'), 'description', 'CT set spare', 'quantity', 2, 'unit_price', 5100),
  jsonb_build_object('product_id', (select id from ref where k = 'svc'), 'description', 'Installation', 'quantity', 1, 'unit_price', 1500)));
update public.orders set status = 'confirmed' where id = (select id from ref where k = 'o3');
select pg_temp.expect_error_like($$update public.orders set status = 'fulfilled' where id = (select id from ref where k = 'o3')$$, 'stock_insufficient', 'an order needing more stock than is held cannot be fulfilled');
select pg_temp.expect((select status = 'confirmed' from public.orders where id = (select id from ref where k = 'o3')) and (select stock_on_hand = 5 from public.products where id = (select id from ref where k = 'prod')) and not exists (select 1 from public.sales where order_id = (select id from ref where k = 'o3')), 'and nothing changes: no stock taken, no sale');
insert into public.inventory_transactions (product_id, transaction_type, quantity, note) values ((select id from ref where k = 'prod'), 'received', 1, 'Delivery');
update public.orders set status = 'fulfilled' where id = (select id from ref where k = 'o3');
select pg_temp.expect((select stock_on_hand = 0 and stock_status = 'out' from public.product_list where id = (select id from ref where k = 'prod')), 'fulfilling takes both lines of the same product (4 + 2) and leaves it out of stock');
select pg_temp.expect((select count(*) = 1 and sum(quantity) = -6 from public.inventory_transactions where order_id = (select id from ref where k = 'o3')), 'as one movement per product, none for the service');
select pg_temp.expect((select active_products = 4 and low = 2 and out_of_stock = 1 and units = 5 from public.inventory_summary), 'summary counts products, units, low and out of stock');

-- Isolation
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.product_list) + (select count(*) from public.inventory_history) + (select count(*) from public.inventory_summary) = 0, 'clients see no products or stock');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity) values ('11111111-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'received', 100)$$, 'permission denied', 'clients cannot move stock');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.product_list) + (select count(*) from public.inventory_history) = 0, 'another business sees no products or movements');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (product_id, transaction_type, quantity) values ('f1000000-0000-0000-0000-000000000001', 'received', 100)$$, 'stock_product_not_found', 'nor moves our stock');
select pg_temp.expect_error_like($$insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity) values ('11111111-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'received', 100)$$, 'permission denied', 'claiming our business does not help');
select pg_temp.expect(public.create_product('CT-400', 'Their own CT set', 10) is not null, 'SKUs are unique per business, not across businesses');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.product_list$$, 'permission denied', 'anonymous cannot read products');
select pg_temp.expect_error_like($$set local role anon; select public.create_product('X1', 'X', 1)$$, 'permission denied', 'anonymous cannot create products');

-- Support tickets (Phase 8) ------------------------------------------------------------------------
-- Opening: a client describes the problem; the team sets priority and assignment.
select pg_temp.as_owner();
-- A file on the other customer's ticket, which client 1 must never see.
insert into storage.objects (bucket_id, name, metadata) values ('ticket-attachments', '11111111-0000-0000-0000-000000000001/a0200000-0000-0000-0000-000000000002/1-invoice.pdf', '{"size": 10, "mimetype": "application/pdf"}');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
with t as (
  insert into public.support_tickets (subject, description, category, meter_id, priority, assigned_to, status, resolution)
  values ('No power in unit 4', 'The meter shows E-04 since this morning.', 'meter_fault', 'e1000000-0000-0000-0000-000000000001', 'urgent', 'a3000000-0000-0000-0000-000000000001', 'closed', 'Fixed')
  returning id)
insert into ref select 'tk', id from t;
select pg_temp.expect((select customer_id = 'c1000000-0000-0000-0000-000000000001' and business_id = '11111111-0000-0000-0000-000000000001' and created_by = 'a4000000-0000-0000-0000-000000000001' and status = 'open' and priority = 'normal' and assigned_to is null and resolution is null from public.support_tickets where id = (select id from ref where k = 'tk')), 'a client''s ticket is their own, open, normal priority and unassigned whatever they send');
select pg_temp.expect((select property_id = 'd1000000-0000-0000-0000-000000000001' from public.support_tickets where id = (select id from ref where k = 'tk')), 'choosing a meter fills in its property');
select pg_temp.expect((select reference ~ '^TKT-[0-9]{4}-[0-9]{5}$' and reference like '%-' || lpad(number::text, 5, '0') from public.support_tickets where id = (select id from ref where k = 'tk')), 'tickets get a TKT-YYYY-NNNNN reference');
select pg_temp.expect((select number from public.support_tickets where id = (select id from ref where k = 'tk')) = (select number from public.support_tickets where subject = 'Own ticket') + 1, 'references count up per business, ignoring the one sent');
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description) values ('No details', '   ')$$, 'ticket_description_required', 'a ticket needs a description');
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description, property_id) values ('Not mine', 'x', 'd1000000-0000-0000-0000-000000000002')$$, 'ticket_property_mismatch', 'a client cannot link another customer''s property');
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description, meter_id) values ('Not mine', 'x', 'e1000000-0000-0000-0000-000000000002')$$, 'ticket_meter_mismatch', 'or another customer''s meter');
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description, category) values ('Odd', 'x', 'gossip')$$, 'ticket_category_unknown', 'unknown categories are refused');
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description) values (repeat('x', 151), 'x')$$, 'tickets_subject_length', 'a subject is at most 150 characters');
select pg_temp.expect_error_like($$insert into public.support_tickets (business_id, customer_id, subject, description) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Theirs', 'x')$$, 'permission denied', 'a client cannot open a ticket for another customer');
update public.support_tickets set status = 'closed', resolution = 'Sorted it myself' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select status = 'open' from public.support_tickets where id = (select id from ref where k = 'tk')), 'a client cannot change a ticket');

-- The client's message and a photo
insert into public.ticket_messages (ticket_id, body, author_id) values ((select id from ref where k = 'tk'), 'Photo of the meter attached.', 'a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select author_id = 'a4000000-0000-0000-0000-000000000001' and author_name = 'Cleo Client' and not from_staff from public.ticket_messages where body = 'Photo of the meter attached.'), 'a message is always from the person signed in, with their name kept');
insert into storage.objects (bucket_id, name, metadata) select 'ticket-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/1-meter.jpg', '{"size": 2048, "mimetype": "image/jpeg"}' from ref where k = 'tk';
insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, content_type, size_bytes) select id, 'a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001/' || id || '/1-meter.jpg', 'meter.jpg', 'image/png', 99 from ref where k = 'tk';
select pg_temp.expect((select uploaded_by = 'a4000000-0000-0000-0000-000000000001' and uploader_name = 'Cleo Client' and size_bytes = 2048 and content_type = 'image/jpeg' from public.ticket_attachments where file_name = 'meter.jpg'), 'an attachment records its uploader and the stored size and type, not what was sent');
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'ghost.pdf', 'application/pdf', 10)$$, (select id from ref where k = 'tk'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'tk') || '/2-ghost.pdf'), 'attachment_not_uploaded', 'an attachment must be a real upload');
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'x.jpg', 'image/jpeg', 10)$$, (select id from ref where k = 'tk'), '11111111-0000-0000-0000-000000000001/a0200000-0000-0000-0000-000000000001/1-meter.jpg'), 'attachment_path_mismatch', 'an attachment must be stored under its own ticket');
insert into storage.objects (bucket_id, name, metadata) select 'ticket-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/3-tool.exe', '{"size": 100, "mimetype": "application/x-msdownload"}' from ref where k = 'tk';
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'tool.pdf', 'application/pdf', 100)$$, (select id from ref where k = 'tk'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'tk') || '/3-tool.exe'), 'ticket_attachments_type_check', 'only photos, PDFs, CSV and text files are accepted, judged by the stored type');
insert into storage.objects (bucket_id, name, metadata) select 'ticket-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/4-big.pdf', '{"size": 10485761, "mimetype": "application/pdf"}' from ref where k = 'tk';
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'big.pdf', 'application/pdf', 100)$$, (select id from ref where k = 'tk'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'tk') || '/4-big.pdf'), 'ticket_attachments_size_check', 'files are at most 10 MB');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) values ('ticket-attachments', '11111111-0000-0000-0000-000000000001/a0200000-0000-0000-0000-000000000002/x.jpg')$$, 'row-level security', 'a client cannot upload to another customer''s ticket');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) values ('ticket-attachments', '11111111-0000-0000-0000-000000000001/x.jpg')$$, 'row-level security', 'files must sit under a ticket');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) values ('ticket-attachments', '11111111-0000-0000-0000-000000000002/a0200000-0000-0000-0000-000000000001/x.jpg')$$, 'row-level security', 'or under the right business');

-- Staff work the ticket
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.support_tickets set assigned_to = 'a3000000-0000-0000-0000-000000000001', priority = 'urgent' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select status = 'assigned' and assigned_at is not null and priority = 'urgent' from public.support_tickets where id = (select id from ref where k = 'tk')), 'assigning moves an open ticket to Assigned');
select pg_temp.expect((select count(*) = 1 from public.notifications where title = 'New support ticket' and link = '/support-tickets/' || (select id from ref where k = 'tk')), 'managers hear about a new ticket from a client');
select pg_temp.expect((select count(*) = 1 from public.notifications where title like 'Customer replied on %' and link = '/support-tickets/' || (select id from ref where k = 'tk')), 'and about a reply while nobody is assigned');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 1 from public.notifications where title = 'Ticket assigned to you' and link = '/support-tickets/' || (select id from ref where k = 'tk')), 'the assignee hears about the assignment');
select pg_temp.expect_error_like($$update public.support_tickets set status = 'open' where id = (select id from ref where k = 'tk')$$, 'ticket_open_assigned', 'an assigned ticket cannot be set back to Open without unassigning it');
select pg_temp.expect_error_like($$update public.support_tickets set assigned_to = 'a4000000-0000-0000-0000-000000000001' where id = (select id from ref where k = 'tk')$$, 'assignee_not_staff', 'only team members can be assigned');
select pg_temp.expect_error_like($$update public.support_tickets set assigned_to = 'b1000000-0000-0000-0000-000000000001' where id = (select id from ref where k = 'tk')$$, 'assignee_not_staff', 'not even another business''s administrator');
select pg_temp.expect_error_like($$update public.support_tickets set status = 'resolved' where id = (select id from ref where k = 'tk')$$, 'ticket_resolution_required', 'resolving needs a resolution note');
select pg_temp.expect_error_like($$update public.support_tickets set customer_id = 'c1000000-0000-0000-0000-000000000002' where id = (select id from ref where k = 'tk')$$, 'ticket_fixed_fields', 'a ticket cannot move to another customer');
select pg_temp.expect_error_like($$update public.support_tickets set reference = 'TKT-1' where id = (select id from ref where k = 'tk')$$, 'ticket_fixed_fields', 'or change its reference');
select pg_temp.expect_error_like($$update public.support_tickets set property_id = 'd1000000-0000-0000-0000-000000000002', meter_id = null where id = (select id from ref where k = 'tk')$$, 'ticket_property_mismatch', 'staff cannot link another customer''s property either');
update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select active_tickets = 1 and urgent_tickets = 1 from public.ticket_workload where id = 'a3000000-0000-0000-0000-000000000001'), 'workload counts the assignee''s active tickets');
insert into public.ticket_messages (ticket_id, body) values ((select id from ref where k = 'tk'), 'A technician is on the way.');
select pg_temp.expect((select first_response_at is not null from public.support_tickets where id = (select id from ref where k = 'tk')), 'the first staff reply is timed');
insert into public.ticket_messages (ticket_id, body, is_internal) values ((select id from ref where k = 'tk'), 'Check the CT lugs on phase B.', true);
update public.support_tickets set first_response_at = null, resolved_at = '2001-01-01', assigned_at = null, last_activity_at = '2001-01-01' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select first_response_at is not null and resolved_at is null and assigned_at is not null and last_activity_at > '2020-01-01' from public.support_tickets where id = (select id from ref where k = 'tk')), 'timestamps are the database''s to set');
update public.support_tickets set status = 'resolved', resolution = 'Re-terminated the loose CT lug on phase B.' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select status = 'resolved' and resolved_at is not null from public.support_tickets where id = (select id from ref where k = 'tk')), 'a ticket is resolved with a note');

-- The customer follows progress and replies
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) = 2 and bool_and(not is_internal) from public.ticket_messages where ticket_id = (select id from ref where k = 'tk')), 'the customer sees the conversation without internal notes');
select pg_temp.expect((select assignee_name is null and message_count = 2 and attachment_count = 1 and resolution like 'Re-terminated%' and meter_serial = 'MTR-0001' from public.ticket_list where id = (select id from ref where k = 'tk')), 'the list shows a client their ticket without staff profiles or internal counts');
select pg_temp.expect((select count(*) filter (where kind = 'status') = 3 and count(*) filter (where kind in ('assigned', 'priority')) = 0 from public.ticket_events where ticket_id = (select id from ref where k = 'tk')), 'the customer sees status history but not assignment or priority changes');
select pg_temp.expect((select count(*) filter (where title like '% is now %') = 3 and count(*) filter (where title like 'New reply on %') = 1 from public.notifications where link = '/support-tickets/' || (select id from ref where k = 'tk')), 'the customer is told about status changes and replies, never internal notes');
select pg_temp.expect((select count(*) = 1 from storage.objects where name like '%/1-meter.jpg') and (select count(*) = 0 from storage.objects where name like '%/a0200000-0000-0000-0000-000000000002/%'), 'a client can read files only on their own tickets');
insert into public.ticket_messages (ticket_id, body) values ((select id from ref where k = 'tk'), 'It tripped again tonight.');
select pg_temp.expect((select status = 'in_progress' and resolved_at is null from public.support_tickets where id = (select id from ref where k = 'tk')), 'a customer reply reopens a resolved ticket');

select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 1 from public.notifications where title like 'Customer replied on %' and link = '/support-tickets/' || (select id from ref where k = 'tk')), 'the assignee hears about a customer reply');
select pg_temp.expect((select count(*) = 0 from public.notifications where title like 'Internal note%'), 'nobody is notified about their own note');
update public.support_tickets set assigned_to = null where id = (select id from ref where k = 'tk');
select pg_temp.expect((select status = 'open' and assigned_at is null from public.support_tickets where id = (select id from ref where k = 'tk')), 'unassigning an active ticket returns it to Open');
select pg_temp.expect_error_like($$update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'tk')$$, 'ticket_needs_assignee', 'work cannot start without an assignee');
update public.support_tickets set assigned_to = 'a3000000-0000-0000-0000-000000000001' where id = (select id from ref where k = 'tk');
update public.support_tickets set status = 'closed' where id = (select id from ref where k = 'tk');
select pg_temp.expect((select status = 'closed' and closed_at is not null from public.support_tickets where id = (select id from ref where k = 'tk')), 'a ticket with a resolution note can be closed');
select pg_temp.expect_error_like($$update public.support_tickets set subject = 'Changed' where id = (select id from ref where k = 'tk')$$, 'ticket_closed', 'a closed ticket is locked');
select pg_temp.expect_error_like($$insert into public.ticket_messages (ticket_id, body) values ((select id from ref where k = 'tk'), 'Late reply')$$, 'ticket_closed', 'nobody can reply to a closed ticket');
select pg_temp.expect((select count(*) filter (where kind = 'status') = 7 and count(*) filter (where kind = 'assigned') = 3 and count(*) filter (where kind = 'priority') = 1 and count(*) filter (where kind = 'created') = 1 and count(*) filter (where kind = 'attachment') = 1 from public.ticket_events where ticket_id = (select id from ref where k = 'tk')), 'every status, assignment and priority change is in the history');
select pg_temp.expect((select active_tickets = 0 from public.ticket_workload where id = 'a3000000-0000-0000-0000-000000000001'), 'closed tickets leave the workload');
select pg_temp.expect_error_like($$insert into public.ticket_events (business_id, ticket_id, kind) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'tk'), 'status')$$, 'permission denied', 'nobody writes history directly');
select pg_temp.expect_error_like($$insert into public.notifications (business_id, user_id, title) values ('11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Fake')$$, 'permission denied', 'nobody writes notifications directly');
delete from public.ticket_messages where ticket_id = (select id from ref where k = 'tk');
select pg_temp.expect((select count(*) = 4 from public.ticket_messages where ticket_id = (select id from ref where k = 'tk')), 'staff cannot delete messages');
select pg_temp.expect((select message_count = 4 from public.ticket_list where id = (select id from ref where k = 'tk')), 'staff see every message counted, internal notes included');

-- Staff open tickets for customers
with t as (
  insert into public.support_tickets (customer_id, subject, description, category, priority, assigned_to)
  values ('c1000000-0000-0000-0000-000000000002', 'Question about October invoice', 'Asked by phone.', 'billing', 'high', 'a3000000-0000-0000-0000-000000000001')
  returning id)
insert into ref select 'tk2', id from t;
select pg_temp.expect((select status = 'assigned' and priority = 'high' and created_by = 'a3000000-0000-0000-0000-000000000001' from public.support_tickets where id = (select id from ref where k = 'tk2')), 'staff open tickets with a priority and an assignee');
select pg_temp.expect((select total = (select count(*) from public.support_tickets) and closed = 1 and assigned = 1 from public.ticket_summary), 'the summary counts tickets by status');
select pg_temp.as_owner();
-- As trusted server code, with nobody signed in.
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
update public.profiles set is_active = false where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$update public.support_tickets set assigned_to = 'a1000000-0000-0000-0000-000000000001' where id = (select id from ref where k = 'tk2')$$, 'assignee_not_staff', 'a deactivated person cannot be assigned');
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'late.jpg', 'image/jpeg', 10)$$, (select id from ref where k = 'tk'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'tk') || '/9-late.jpg'), 'ticket_closed', 'nobody attaches files to a closed ticket');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
insert into public.ticket_messages (ticket_id, body) values ('a0200000-0000-0000-0000-000000000001', 'Any news?');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) filter (where user_id = 'a2000000-0000-0000-0000-000000000001') = 1 and count(*) filter (where user_id = 'a1000000-0000-0000-0000-000000000001') = 0 from public.notifications where link = '/support-tickets/a0200000-0000-0000-0000-000000000001' and body = 'Any news?'), 'deactivated people are not notified');
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
update public.profiles set is_active = false where id = 'a4000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into public.ticket_messages (ticket_id, body) values ('a0200000-0000-0000-0000-000000000001', 'We are on it.');
select pg_temp.as_owner();
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true where id = 'a4000000-0000-0000-0000-000000000001';
select pg_temp.expect(not exists (select 1 from public.notifications where user_id = 'a4000000-0000-0000-0000-000000000001' and body = 'We are on it.'), 'a deactivated customer is not notified of replies');
select pg_temp.as_owner();
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true where id = 'a1000000-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name, metadata) select 'ticket-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/' || g || '.pdf', '{"size": 10, "mimetype": "application/pdf"}' from ref, generate_series(1, 21) g where k = 'tk2';
insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, content_type, size_bytes) select id, 'a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001/' || id || '/' || g || '.pdf', g || '.pdf', 'application/pdf', 10 from ref, generate_series(1, 20) g where k = 'tk2';
select pg_temp.expect_error_like(format($$insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, content_type, size_bytes) values (%L, 'a3000000-0000-0000-0000-000000000001', %L, '21.pdf', 'application/pdf', 10)$$, (select id from ref where k = 'tk2'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'tk2') || '/21.pdf'), 'ticket_attachment_limit', 'a ticket holds at most 20 files');

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select total = 3 and closed = 1 from public.ticket_summary), 'a client''s summary covers only their tickets');
select pg_temp.expect((select count(*) = 0 from public.ticket_workload), 'clients see no workload');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) select 'ticket-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/5-late.jpg' from ref where k = 'tk'$$, 'row-level security', 'nobody uploads to a closed ticket');

select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
delete from public.ticket_messages where ticket_id = (select id from ref where k = 'tk') and is_internal;
select pg_temp.expect((select count(*) = 3 from public.ticket_messages where ticket_id = (select id from ref where k = 'tk')) and exists (select 1 from pg_temp.audit_rows() where table_name = 'ticket_messages' and action = 'DELETE'), 'a manager can remove a message, and it is in the audit log');

-- Isolation
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.ticket_list) + (select count(*) from public.ticket_events) + (select count(*) from storage.objects) + (select total from public.ticket_summary) = 0, 'another business sees no tickets, history or files');
select pg_temp.expect_error_like($$insert into public.ticket_messages (ticket_id, body) values ((select id from ref where k = 'tk2'), 'Hello')$$, 'permission denied', 'nor replies to our tickets');
select pg_temp.expect_error_like($$insert into public.ticket_attachments (ticket_id, storage_path, file_name, content_type, size_bytes) select id, 'x', 'x.jpg', 'image/jpeg', 1 from ref where k = 'tk2'$$, 'permission denied', 'nor attaches files to them');
select pg_temp.expect_error_like($$insert into public.support_tickets (business_id, customer_id, subject, description) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Hi', 'x')$$, 'permission denied', 'nor opens tickets for our customers');
update public.support_tickets set subject = 'Hijacked' where id = (select id from ref where k = 'tk2');
select pg_temp.as_owner();
select pg_temp.expect((select subject from public.support_tickets where id = (select id from ref where k = 'tk2')) = 'Question about October invoice', 'nor changes them');
select pg_temp.expect_error_like($$set local role anon; select * from public.ticket_list$$, 'permission denied', 'anonymous cannot read tickets');
select pg_temp.expect_error_like($$set local role authenticated; select * from public.ticket_counters$$, 'permission denied', 'nobody reads the ticket counters directly');

-- Team and tasks (Phase 9) -------------------------------------------------------------------------
-- Employee details
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select employee_number from public.profiles where id = 'a1000000-0000-0000-0000-000000000001') = 1 and (select employee_number from public.profiles where id = 'a3000000-0000-0000-0000-000000000001') = 3 and (select employee_number from public.profiles where id = 'a4000000-0000-0000-0000-000000000001') is null, 'the existing team is numbered in the order they joined; clients are not');
update public.profiles set department = 'field_operations', job_title = 'Field Technician', employment_status = 'training', start_date = '2025-03-01', reports_to = 'a2000000-0000-0000-0000-000000000001' where id = 'a3000000-0000-0000-0000-000000000001';
select pg_temp.expect((select department = 'field_operations' and job_title = 'Field Technician' and employment_status = 'training' and reports_to = 'a2000000-0000-0000-0000-000000000001' from public.team_list where id = 'a3000000-0000-0000-0000-000000000001'), 'an administrator sets employment details');
select pg_temp.expect((select employee_code = 'EMP-003' and reports_to_name = 'Mia Manager' from public.team_list where id = 'a3000000-0000-0000-0000-000000000001'), 'the team list shows the employee code and manager');
select pg_temp.expect_error_like($$update public.profiles set reports_to = id where id = 'a3000000-0000-0000-0000-000000000001'$$, 'profiles_not_own_manager', 'nobody reports to themselves');
select pg_temp.expect_error_like($$update public.profiles set reports_to = 'b1000000-0000-0000-0000-000000000001' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'profiles_reports_to_fkey', 'or to someone in another business');
select pg_temp.expect_error_like($$update public.profiles set employee_number = 99 where id = 'a3000000-0000-0000-0000-000000000001'$$, 'staff_fixed_fields', 'an employee number never changes');
select pg_temp.expect_error_like($$update public.profiles set is_active = false where id = 'a1000000-0000-0000-0000-000000000001'$$, 'staff_self_lockout', 'an administrator cannot deactivate themselves');
select pg_temp.expect_error_like($$update public.profiles set role = 'staff' where id = 'a1000000-0000-0000-0000-000000000001'$$, 'staff_self_lockout', 'or demote themselves');
select pg_temp.expect_error_like($$update public.profiles set department = 'sales' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'profiles_department_check', 'departments come from a fixed list');

select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.profiles set phone = '+27820000003' where id = 'a3000000-0000-0000-0000-000000000001';
select pg_temp.expect((select phone = '+27820000003' from public.profiles where id = 'a3000000-0000-0000-0000-000000000001'), 'people can update their own phone number');
select pg_temp.expect_error_like($$update public.profiles set job_title = 'Head of Everything' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'staff_admin_only', 'but not their own job title');
select pg_temp.expect_error_like($$update public.profiles set employment_status = 'active' where id = 'a3000000-0000-0000-0000-000000000001'$$, 'staff_admin_only', 'or employment status');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect_error_like($$update public.profiles set department = 'marketing' where id = 'a2000000-0000-0000-0000-000000000001'$$, 'staff_admin_only', 'managers cannot change employment details either');

-- Invitations
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select public.invite_staff(' Lerato@Umbane.Test ', 'Lerato Khumalo', 'staff', '+27831234567', 'customer_support', 'Support Agent', '2026-12-01', 'a2000000-0000-0000-0000-000000000001') ->> 'status') = 'invited', 'an administrator invites someone without an account');
select pg_temp.expect((select email = 'lerato@umbane.test' and status = 'pending' and invited_by = 'a1000000-0000-0000-0000-000000000001' from public.staff_invitations where full_name = 'Lerato Khumalo'), 'the invitation is kept in lower case, with who sent it');
select pg_temp.expect_error_like($$select public.invite_staff('lerato@umbane.test', 'Lerato Again', 'staff')$$, 'staff_already_invited', 'an email is invited once');
select pg_temp.expect_error_like($$select public.invite_staff('STAFF1@umbane.test', 'Copy', 'staff')$$, 'staff_email_taken', 'someone already on the team cannot be invited, whatever the case');
select pg_temp.expect_error_like($$select public.invite_staff('new@umbane.test', 'New Client', 'client')$$, 'staff_role_client', 'clients are not invited as staff');
select pg_temp.expect_error_like($$select public.invite_staff('not-an-email', 'Bad Email', 'staff')$$, 'staff_invitations_email_check', 'the email must be valid');
select pg_temp.expect_error_like($$select public.invite_staff('phone@umbane.test', 'Bad Phone', 'staff', '0821234567')$$, 'staff_invitations_phone_check', 'the phone must be in +27 form');
select public.invite_staff('pending@umbane.test', 'Still Pending', 'staff');
select public.invite_staff('gone@umbane.test', 'Gone Person', 'staff');
update public.staff_invitations set status = 'cancelled' where email = 'gone@umbane.test';
select pg_temp.expect((select status = 'cancelled' from public.staff_invitations where email = 'gone@umbane.test'), 'an administrator can cancel a pending invitation');
select pg_temp.expect_error_like($$update public.staff_invitations set status = 'pending' where email = 'gone@umbane.test'$$, 'invitation_closed', 'a cancelled invitation stays cancelled');
select pg_temp.expect_error_like($$update public.staff_invitations set role = 'administrator' where email = 'lerato@umbane.test'$$, 'invitation_closed', 'and a pending one cannot be changed, only cancelled');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect_error_like($$select public.invite_staff('m@umbane.test', 'By Manager', 'staff')$$, 'permission denied', 'only administrators invite');
select pg_temp.expect((select count(*) from public.staff_invitations) = 0, 'managers do not see invitations');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.staff_invitations) = 0, 'another business does not see our invitations');
select pg_temp.expect_error_like($$select public.invite_staff('pending@umbane.test', 'Poached', 'administrator')$$, 'staff_already_invited', 'nor invites someone we have already invited');

-- The invited person confirms their account (what Supabase Auth does)
select pg_temp.as_owner();
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
insert into auth.users (id, aud, role, email, created_at) values ('a5000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'Lerato@umbane.test', now());
select pg_temp.expect(not exists (select 1 from public.profiles where id = 'a5000000-0000-0000-0000-000000000001'), 'an unconfirmed account gets no profile');
update auth.users set email_confirmed_at = now() where id = 'a5000000-0000-0000-0000-000000000001';
select pg_temp.expect((select business_id = '11111111-0000-0000-0000-000000000001' and role = 'staff' and full_name = 'Lerato Khumalo' and department = 'customer_support' and reports_to = 'a2000000-0000-0000-0000-000000000001' and employee_number = 4 and email = 'lerato@umbane.test' from public.profiles where id = 'a5000000-0000-0000-0000-000000000001'), 'confirming an invited email creates the profile in the inviting business');
select pg_temp.expect((select status = 'accepted' and profile_id = 'a5000000-0000-0000-0000-000000000001' and accepted_at is not null from public.staff_invitations where email = 'lerato@umbane.test'), 'and accepts the invitation');
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) values ('a7000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'gone@umbane.test', now(), now());
select pg_temp.expect(not exists (select 1 from public.profiles where id = 'a7000000-0000-0000-0000-000000000001'), 'a cancelled invitation gives no access');
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) values ('a6000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'thabo@umbane.test', now(), now());
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select public.invite_staff('thabo@umbane.test', 'Thabo Mokoena', 'manager') ->> 'status') = 'linked', 'someone with a confirmed account is added at once');
select pg_temp.expect((select role = 'manager' and employee_number = 5 from public.profiles where id = 'a6000000-0000-0000-0000-000000000001'), 'with the next employee number');
select pg_temp.as_owner();
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
insert into auth.users (id, aud, role, email, created_at) values ('a8000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'unconfirmed@umbane.test', now());
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select public.invite_staff('unconfirmed@umbane.test', 'Not Yet', 'staff') ->> 'status') = 'invited' and not exists (select 1 from public.profiles where id = 'a8000000-0000-0000-0000-000000000001'), 'an account that has not confirmed its email is invited, not added');

-- Tasks: a manager creates and assigns
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
with t as (
  insert into public.staff_tasks (title, description, category, priority, assigned_to, ticket_id, start_date, due_date, proof_required, status, created_by)
  values ('Replace cracked faceplate', 'Faceplate cracked on MTR-0002.', 'field_maintenance', 'high', 'a3000000-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000002', public.business_today(), public.business_today() + 2, true, 'todo', 'a1000000-0000-0000-0000-000000000001')
  returning id)
insert into ref select 'task', id from t;
with t as (
  insert into public.staff_tasks (title, assigned_to) values ('Tariff batch audit', 'a1000000-0000-0000-0000-000000000001') returning id)
insert into ref select 'task2', id from t;
select pg_temp.expect((select customer_id = 'c1000000-0000-0000-0000-000000000002' and created_by = 'a2000000-0000-0000-0000-000000000001' and status = 'todo' and started_at is null from public.staff_tasks where id = (select id from ref where k = 'task')), 'a manager creates a task; its ticket fills in the customer, and the creator is the person signed in');
select pg_temp.expect((select reference ~ '^TSK-[0-9]{5}$' and ticket_reference = 'TKT-0002' and assignee_name = 'Sam Staff' and display_status = 'todo' from public.task_list where id = (select id from ref where k = 'task')), 'tasks get a TSK reference and show their links');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, status) values ('Done already', 'done')$$, 'task_transition', 'a task cannot start completed');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, status) values ('Nobody', 'in_progress')$$, 'task_needs_assignee', 'work in progress needs someone doing it');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, assigned_to) values ('For a client', 'a4000000-0000-0000-0000-000000000001')$$, 'assignee_not_staff', 'only team members get tasks');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, ticket_id, property_id) values ('Mixed', 'a0200000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001')$$, 'task_property_mismatch', 'the property must be the ticket''s customer''s');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, customer_id, ticket_id) values ('Mixed', 'c1000000-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000002')$$, 'task_ticket_mismatch', 'and so must the ticket');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, start_date, due_date) values ('Backwards', '2026-12-10', '2026-12-01')$$, 'tasks_dates', 'the due date is not before the start');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title, category) values ('Odd', 'gardening')$$, 'staff_tasks_category_check', 'categories come from a fixed list');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title) values (repeat('x', 151))$$, 'tasks_title_length', 'a title is at most 150 characters');

-- The assignee works it
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) from public.task_list) = 1, 'staff see only the tasks assigned to them');
select pg_temp.expect((select count(*) = 1 from public.notifications where title = 'Task assigned to you' and link = '/tasks/' || (select id from ref where k = 'task')), 'the assignee is told');
select pg_temp.expect_error_like($$insert into public.staff_tasks (title) values ('Self-made')$$, 'permission denied', 'staff do not create tasks');
update public.staff_tasks set status = 'in_progress' where id = (select id from ref where k = 'task');
select pg_temp.expect((select status = 'in_progress' and started_at is not null from public.staff_tasks where id = (select id from ref where k = 'task')), 'the assignee starts their task, and the start is timed');
select pg_temp.expect_error_like($$update public.staff_tasks set title = 'Easier job' where id = (select id from ref where k = 'task')$$, 'task_manager_only', 'but cannot change what the task is');
select pg_temp.expect_error_like($$update public.staff_tasks set due_date = due_date + 30 where id = (select id from ref where k = 'task')$$, 'task_manager_only', 'or its due date');
select pg_temp.expect_error_like($$update public.staff_tasks set status = 'cancelled' where id = (select id from ref where k = 'task')$$, 'task_manager_only', 'or cancel it');
update public.staff_tasks set status = 'done' where id = (select id from ref where k = 'task2');
insert into public.task_updates (task_id, body, author_id) values ((select id from ref where k = 'task'), 'On site, faceplate removed.', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select author_id = 'a3000000-0000-0000-0000-000000000001' and author_name = 'Sam Staff' from public.task_updates where body = 'On site, faceplate removed.'), 'a progress update is always from the person signed in');
select pg_temp.expect_error_like($$insert into public.task_updates (task_id, body) values ((select id from ref where k = 'task2'), 'Not mine')$$, 'permission denied', 'nobody posts on someone else''s task');
select pg_temp.expect_error_like($$insert into public.task_attachments (task_id, storage_path, file_name, content_type, size_bytes) select id, 'x', 'x.jpg', 'image/jpeg', 1 from ref where k = 'task2'$$, 'permission denied', 'nor attaches files to it');
select pg_temp.expect((select count(*) from public.task_events where task_id = (select id from ref where k = 'task2')) = 0, 'nor sees its history');
select pg_temp.expect_error_like($$insert into public.task_events (business_id, task_id, kind) select '11111111-0000-0000-0000-000000000001', id, 'status' from ref where k = 'task'$$, 'permission denied', 'nobody writes task history directly');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) select 'task-attachments', '11111111-0000-0000-0000-000000000002/' || id || '/x.jpg' from ref where k = 'task'$$, 'row-level security', 'task files must sit under the task''s own business');
insert into storage.objects (bucket_id, name, metadata) select 'task-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/1-jobcard.pdf', '{"size": 900, "mimetype": "application/pdf"}' from ref where k = 'task';
insert into public.task_attachments (task_id, uploaded_by, storage_path, file_name, content_type, size_bytes) select id, 'a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001/' || id || '/1-jobcard.pdf', 'jobcard.pdf', 'image/png', 1 from ref where k = 'task';
select pg_temp.expect((select uploaded_by = 'a3000000-0000-0000-0000-000000000001' and content_type = 'application/pdf' and size_bytes = 900 from public.task_attachments where file_name = 'jobcard.pdf'), 'a file records its uploader and its stored type and size');
select pg_temp.expect_error_like($$update public.staff_tasks set status = 'done' where id = (select id from ref where k = 'task')$$, 'task_proof_required', 'a task needing proof cannot be completed without a photo; a document is not enough');
insert into storage.objects (bucket_id, name, metadata) select 'task-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/2-after.jpg', '{"size": 2048, "mimetype": "image/jpeg"}' from ref where k = 'task';
insert into public.task_attachments (task_id, storage_path, file_name, content_type, size_bytes) select id, '11111111-0000-0000-0000-000000000001/' || id || '/2-after.jpg', 'after.jpg', 'image/jpeg', 2048 from ref where k = 'task';
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) select 'task-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/x.jpg' from ref where k = 'task2'$$, 'row-level security', 'nobody uploads to someone else''s task');
select pg_temp.expect_error_like(format($$insert into public.task_attachments (task_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'x.jpg', 'image/jpeg', 1)$$, (select id from ref where k = 'task'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'task') || '/9-ghost.jpg'), 'attachment_not_uploaded', 'a file must really be uploaded');
select pg_temp.expect_error_like(format($$insert into public.task_attachments (task_id, storage_path, file_name, content_type, size_bytes) values (%L, %L, 'x.jpg', 'image/jpeg', 1)$$, (select id from ref where k = 'task'), '11111111-0000-0000-0000-000000000001/' || (select id from ref where k = 'task2') || '/2-after.jpg'), 'attachment_path_mismatch', 'and stored under its own task');
update public.staff_tasks set status = 'done' where id = (select id from ref where k = 'task');
select pg_temp.expect((select status = 'done' and completed_by = 'a3000000-0000-0000-0000-000000000001' and completed_at is not null from public.staff_tasks where id = (select id from ref where k = 'task')), 'with a photo the assignee completes it, and who and when are recorded');
select pg_temp.expect_error_like($$update public.staff_tasks set status = 'in_progress' where id = (select id from ref where k = 'task')$$, 'task_manager_only', 'only a manager reopens a completed task');
select pg_temp.expect_error_like($$insert into public.task_updates (task_id, body) values ((select id from ref where k = 'task'), 'Late note')$$, 'task_closed', 'a completed task takes no more updates');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) select 'task-attachments', '11111111-0000-0000-0000-000000000001/' || id || '/3-late.jpg' from ref where k = 'task'$$, 'row-level security', 'or files');
delete from public.staff_tasks where id = (select id from ref where k = 'task');
select pg_temp.expect((select count(*) = 1 from public.staff_tasks where id = (select id from ref where k = 'task')), 'staff cannot delete tasks');

-- The manager follows up
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect((select status = 'todo' from public.staff_tasks where id = (select id from ref where k = 'task2')), 'staff cannot move a task that is not theirs');
select pg_temp.expect((select count(*) filter (where title = 'Task completed') = 1 and count(*) filter (where title like 'Update on TSK-%') = 1 from public.notifications where link = '/tasks/' || (select id from ref where k = 'task')), 'the manager hears about progress and completion');
select pg_temp.expect((select count(*) filter (where kind = 'created') = 1 and count(*) filter (where kind = 'status') = 2 and count(*) filter (where kind = 'attachment') = 2 from public.task_events where task_id = (select id from ref where k = 'task')), 'the history records creation, each status change and each file');
select pg_temp.expect((select completed_tasks = 1 and completed_on_time = 1 and completed_with_due = 1 and completed_this_month = 1 and active_tasks = 0 from public.team_list where id = 'a3000000-0000-0000-0000-000000000001'), 'the team list counts completed and on-time work');
select pg_temp.expect_error_like($$update public.staff_tasks set title = 'Renamed' where id = (select id from ref where k = 'task')$$, 'task_closed', 'a completed task is locked until reopened');
update public.staff_tasks set status = 'in_progress' where id = (select id from ref where k = 'task');
select pg_temp.expect((select status = 'in_progress' and completed_at is null and completed_by is null from public.staff_tasks where id = (select id from ref where k = 'task')), 'a manager reopens it, clearing the completion');
select pg_temp.expect_error_like($$update public.staff_tasks set created_at = '2001-01-01' where id = (select id from ref where k = 'task')$$, 'task_fixed_fields', 'a task''s creation time cannot be changed');
select pg_temp.expect_error_like($$update public.staff_tasks set assigned_to = 'a4000000-0000-0000-0000-000000000001' where id = (select id from ref where k = 'task')$$, 'assignee_not_staff', 'nor can it be reassigned to a client');
update public.staff_tasks set completed_at = now(), started_at = null, last_activity_at = '2001-01-01' where id = (select id from ref where k = 'task');
select pg_temp.expect((select completed_at is null and started_at is not null and last_activity_at > '2020-01-01' from public.staff_tasks where id = (select id from ref where k = 'task')), 'timestamps are the database''s to set');
select pg_temp.expect_error_like($$update public.staff_tasks set status = 'cancelled' where id = (select id from ref where k = 'task')$$, 'task_cancel_reason', 'cancelling needs a reason');
update public.staff_tasks set assigned_to = null where id = (select id from ref where k = 'task');
select pg_temp.expect((select status = 'todo' from public.staff_tasks where id = (select id from ref where k = 'task')), 'unassigning a task in progress returns it to Pending');
select pg_temp.expect_error_like($$update public.staff_tasks set status = 'done' where id = (select id from ref where k = 'task')$$, 'task_needs_assignee', 'and nobody can complete it until it is assigned');
update public.staff_tasks set assigned_to = 'a3000000-0000-0000-0000-000000000001', priority = 'urgent', due_date = due_date + 1 where id = (select id from ref where k = 'task');
select pg_temp.expect((select count(*) filter (where kind = 'assigned') = 2 and count(*) filter (where kind = 'priority') = 1 and count(*) filter (where kind = 'due') = 1 from public.task_events where task_id = (select id from ref where k = 'task')), 'assignment, priority and due date changes are in the history');
with t as (
  insert into public.staff_tasks (title, assigned_to, due_date) values ('Overdue follow-up', 'a3000000-0000-0000-0000-000000000001', public.business_today() - 1) returning id)
insert into ref select 'late', id from t;
select pg_temp.expect((select is_overdue and display_status = 'overdue' from public.task_list where id = (select id from ref where k = 'late')), 'an open task past its due date is overdue');
select pg_temp.expect((select overdue_tasks = 1 and active_tasks = 2 from public.team_list where id = 'a3000000-0000-0000-0000-000000000001') and (select overdue = 1 and completed = 0 from public.task_summary), 'the team list and summary count overdue work');
update public.staff_tasks set status = 'cancelled', cancel_reason = 'Customer moved out' where id = (select id from ref where k = 'late');
select pg_temp.expect((select not is_overdue and display_status = 'cancelled' from public.task_list where id = (select id from ref where k = 'late')), 'a cancelled task is not overdue');
delete from public.staff_tasks where id = (select id from ref where k = 'task2');
select pg_temp.expect(exists (select 1 from pg_temp.audit_rows() where table_name = 'staff_tasks' and action = 'DELETE'), 'a manager can delete a task, and it is in the audit log');
with t as (
  insert into public.staff_tasks (title, assigned_to, due_date, status) values ('Late job', 'a3000000-0000-0000-0000-000000000001', public.business_today() - 1, 'in_progress') returning id)
insert into ref select 'late2', id from t;
update public.staff_tasks set status = 'done' where id = (select id from ref where k = 'late2');
select pg_temp.expect((select completed_tasks = 1 and completed_with_due = 1 and completed_on_time = 0 from public.team_list where id = 'a3000000-0000-0000-0000-000000000001'), 'a task finished after its due date is not on time');
select pg_temp.expect((select overdue = 0 and completed = 1 from public.task_summary), 'completed and cancelled tasks are never overdue');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 1 from public.notifications where title = 'Task cancelled' and link = '/tasks/' || (select id from ref where k = 'late')), 'the assignee is told when their task is cancelled');

-- Isolation
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.task_list) + (select count(*) from public.task_events) + (select count(*) from public.task_updates) + (select count(*) from public.team_list) = 0, 'clients see no tasks or team');
select pg_temp.expect_error_like($$select public.invite_staff('x@umbane.test', 'Client Invite', 'staff')$$, 'permission denied', 'clients cannot invite');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.task_list) + (select count(*) from public.task_events) + (select count(*) from public.task_attachments) + (select count(*) from storage.objects where bucket_id = 'task-attachments') = 0, 'another business sees no tasks or task files');
select pg_temp.expect((select count(*) from public.team_list) = 1, 'and only its own team');
select pg_temp.expect_error_like($$insert into public.task_updates (task_id, body) values ((select id from ref where k = 'task'), 'Hello')$$, 'permission denied', 'nor posts on our tasks');
select pg_temp.expect_error_like($$insert into public.staff_tasks (business_id, title) values ('11111111-0000-0000-0000-000000000001', 'Planted')$$, 'permission denied', 'nor creates tasks in our business');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.task_list$$, 'permission denied', 'anonymous cannot read tasks');
select pg_temp.expect_error_like($$set local role anon; select * from public.team_list$$, 'permission denied', 'anonymous cannot read the team');
select pg_temp.expect_error_like($$set local role anon; select public.invite_staff('x@umbane.test', 'Anon', 'staff')$$, 'permission denied', 'anonymous cannot invite');

-- Communications (Phase 10) ------------------------------------------------------------------------
select pg_temp.as_owner();
-- Acts as the Vercel function: the service role, with nobody signed in.
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;
grant execute on function pg_temp.as_service() to authenticated, service_role;
grant all on ref to service_role;

-- Templates
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select array_agg(key order by key) = array['general', 'invoice_issued', 'invoice_overdue', 'payment_reminder', 'ticket_update'] from public.message_templates), 'every business starts with five templates (the overdue notice added in Phase 12)');
update public.message_templates set subject = 'Changed by staff' where key = 'general';
select pg_temp.expect((select subject = 'A message from {{business_name}}' from public.message_templates where key = 'general'), 'staff cannot change templates');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.message_templates set subject = 'News from {{business_name}}', updated_by = 'a1000000-0000-0000-0000-000000000001' where key = 'general';
select pg_temp.expect((select subject = 'News from {{business_name}}' and updated_by = 'a2000000-0000-0000-0000-000000000001' from public.message_templates where key = 'general'), 'a manager edits a template, and is recorded as the editor');
select pg_temp.expect_error_like($$update public.message_templates set key = 'renamed' where key = 'general'$$, 'template_key_fixed', 'a template key never changes');
select pg_temp.expect_error_like($$insert into public.message_templates (key, name, subject, body) values ('Bad Key', 'Bad', 'x', 'x')$$, 'message_templates_key_check', 'template keys are lower case words');
insert into public.message_templates (key, name, purpose, subject, body) values ('winter_tips', 'Winter tips', 'marketing', 'Save electricity this winter', 'Hello {{customer_name}}');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) = 5 and bool_and(business_id = '11111111-0000-0000-0000-000000000002') from public.message_templates), 'another business has its own templates only');
select pg_temp.as_owner();
insert into public.businesses (id, name) values ('11111111-0000-0000-0000-000000000009', 'New Business');
select pg_temp.expect((select count(*) = 5 from public.message_templates where business_id = '11111111-0000-0000-0000-000000000009'), 'a new business gets the templates');

-- Preferences
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.customers set email_opt_out = true where id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.expect((select email_opt_out and consent_updated_by = 'a3000000-0000-0000-0000-000000000001' and consent_updated_at is not null from public.customers where id = 'c1000000-0000-0000-0000-000000000002'), 'changing a preference records who and when');
update public.customers set email_suppressed_at = now(), email_suppressed_reason = 'bounced', consent_updated_at = '2001-01-01' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email_suppressed_at is null and consent_updated_at is null from public.customers where id = 'c1000000-0000-0000-0000-000000000001'), 'people cannot suppress an address or backdate consent');

-- Logged contacts
insert into public.communication_logs (customer_id, channel, direction, body, status, created_by, sent_at, recipient) values ('c1000000-0000-0000-0000-000000000001', 'call', 'inbound', 'Called about the meter display.', 'delivered', 'a1000000-0000-0000-0000-000000000001', now(), 'x@y.z');
select pg_temp.expect((select status = 'logged' and created_by = 'a3000000-0000-0000-0000-000000000001' and sent_at is null and recipient is null from public.communication_logs where body = 'Called about the meter display.'), 'a logged call is a record by the person signed in, never something sent');
select pg_temp.expect_error_like($$insert into public.communication_logs (customer_id, channel, direction, subject, body, recipient) values ('c1000000-0000-0000-0000-000000000001', 'email', 'outbound', 'Hi', 'Sneaky', 'a@b.co')$$, 'row-level security', 'outgoing email can only be queued, not written directly');
select pg_temp.expect_error_like($$insert into public.communication_logs (customer_id, channel, direction, body) values ('c1000000-0000-0000-0000-000000000001', 'note', 'outbound', '  ')$$, 'contact_note_required', 'a logged contact needs a note');
select pg_temp.expect_error_like($$insert into public.communication_logs (customer_id, channel, direction, body) values ('c2000000-0000-0000-0000-000000000001', 'call', 'outbound', 'Other business')$$, 'permission denied', 'nor for another business''s customer');

-- Queueing
insert into ref select 'msg', public.queue_email('c1000000-0000-0000-0000-000000000001', ' Invoice INV-0001 ', 'Please find attached invoice INV-0001.', 'invoice_issued', 'transactional', 'a0100000-0000-0000-0000-000000000001');
select pg_temp.expect((select status = 'queued' and recipient = 'client1@umbane.test' and created_by = 'a3000000-0000-0000-0000-000000000001' and attempts = 0 and subject = 'Invoice INV-0001' and invoice_number = 'INV-0001' from public.message_list where id = (select id from ref where k = 'msg')), 'staff queue an email to the customer''s own address, linked to the invoice');
select pg_temp.expect((select count(*) = 1 from public.message_events where event = 'queued' and message_id = (select id from ref where k = 'msg')), 'and the queueing is in its history');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x', p_invoice_id => 'a0100000-0000-0000-0000-000000000003')$$, 'message_link_mismatch', 'an email cannot link another customer''s invoice');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x', p_ticket_id => 'a0200000-0000-0000-0000-000000000002')$$, 'message_link_mismatch', 'or ticket');
select pg_temp.expect_error_like($$select public.queue_email('c2000000-0000-0000-0000-000000000001', 'x', 'x')$$, 'message_customer_not_found', 'nor go to another business''s customer');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'Winter tips', 'x', p_purpose => 'marketing')$$, 'message_no_consent', 'marketing needs recorded consent');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000002', 'x', 'x')$$, 'message_opted_out', 'a customer who opted out gets no email');
insert into public.customers (name) values ('No Email Customer');
select pg_temp.expect_error_like($$select public.queue_email((select id from public.customers where name = 'No Email Customer'), 'x', 'x')$$, 'message_no_email', 'a customer needs an email address');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x', p_attachment_path => '11111111-0000-0000-0000-000000000001/m1/ghost.pdf')$$, 'attachment_not_uploaded', 'an attachment must really be uploaded');
select pg_temp.expect_error_like($$insert into storage.objects (bucket_id, name) values ('message-attachments', '11111111-0000-0000-0000-000000000002/m1/x.pdf')$$, 'row-level security', 'attachments are uploaded under the person''s own business');
insert into storage.objects (bucket_id, name, metadata) values ('message-attachments', '11111111-0000-0000-0000-000000000001/m1/INV-0001.pdf', '{"size": 1200, "mimetype": "application/pdf"}');
select pg_temp.expect(public.queue_email('c1000000-0000-0000-0000-000000000001', 'With PDF', 'Attached.', p_attachment_path => '11111111-0000-0000-0000-000000000001/m1/INV-0001.pdf', p_attachment_name => 'INV-0001.pdf') is not null, 'an uploaded PDF can be attached');
update public.communication_logs set status = 'sent', sent_at = now() where id = (select id from ref where k = 'msg');
select pg_temp.expect((select status = 'queued' from public.communication_logs where id = (select id from ref where k = 'msg')), 'staff cannot mark an email as sent');
select pg_temp.expect_error_like($$select * from public.claim_message((select id from ref where k = 'msg'))$$, 'permission denied', 'only the server claims emails for sending');
select pg_temp.expect_error_like($$select public.record_message_result((select id from ref where k = 'msg'), true, 'fake', null, false)$$, 'permission denied', 'or records results');
select pg_temp.expect_error_like($$insert into public.message_events (business_id, message_id, event) select '11111111-0000-0000-0000-000000000001', id, 'delivered' from ref where k = 'msg'$$, 'permission denied', 'nobody writes delivery history directly');

-- The server sends: a temporary failure, then success, then delivery reports
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 1 and bool_and(status = 'sending' and attempts = 1) from public.claim_message((select id from ref where k = 'msg'))), 'the server claims a queued email');
select pg_temp.expect((select count(*) = 0 from public.claim_message((select id from ref where k = 'msg'))), 'an email being sent cannot be claimed twice');
select public.record_message_result((select id from ref where k = 'msg'), false, null, 'Resend 503: service unavailable', true);
select pg_temp.expect((select status = 'failed' and error like 'Resend 503%' and next_attempt_at > now() and next_attempt_at <= now() + interval '1 minute' from public.communication_logs where id = (select id from ref where k = 'msg')), 'a temporary failure is tried again a minute later');
select pg_temp.expect((select count(*) = 0 from public.claim_message((select id from ref where k = 'msg'))), 'but not before then');
select pg_temp.as_owner();
update public.communication_logs set next_attempt_at = now() - interval '1 second' where id = (select id from ref where k = 'msg');
select pg_temp.as_service();
select pg_temp.expect((select (select id from ref where k = 'msg') in (select public.due_messages(10))), 'once due it is listed for sending');
select pg_temp.expect((select attempts = 2 from public.claim_message((select id from ref where k = 'msg'))), 'and claimed again, counting the attempt');
select public.record_message_result((select id from ref where k = 'msg'), true, 'resend-1', null, false);
select pg_temp.expect((select status = 'sent' and sent_at is not null and provider_message_id = 'resend-1' and error is null and next_attempt_at is null from public.communication_logs where id = (select id from ref where k = 'msg')), 'success records the provider''s id');
select pg_temp.expect(public.record_provider_event('resend-1', 'email.delivery_delayed', 'evt-1', '{"type": "email.delivery_delayed"}', now()), 'a delivery report is accepted');
select pg_temp.expect((select status = 'delayed' from public.communication_logs where id = (select id from ref where k = 'msg')), 'and shows a delay');
select public.record_provider_event('resend-1', 'email.delivered', 'evt-2', '{}', now());
select public.record_provider_event('resend-1', 'email.delivered', 'evt-2', '{}', now());
select public.record_provider_event('resend-1', 'email.delivery_delayed', 'evt-3', '{}', now());
select pg_temp.expect((select status = 'delivered' and delivered_at is not null from public.communication_logs where id = (select id from ref where k = 'msg')), 'delivered stays delivered whatever arrives later');
select pg_temp.expect((select count(*) = 1 from public.message_events where provider_event_id = 'evt-2'), 'a repeated report is recorded once');
select pg_temp.expect(not public.record_provider_event('nobody-knows', 'email.delivered', 'evt-x', '{}', now()), 'a report for an unknown email is ignored');

-- A bounce stops further email to that address until it changes
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into ref select 'msg2', public.queue_email('c1000000-0000-0000-0000-000000000001', 'Second', 'Body');
select pg_temp.as_service();
select count(*) from public.claim_message((select id from ref where k = 'msg2'));
select public.record_message_result((select id from ref where k = 'msg2'), true, 'resend-2', null, false);
select public.record_provider_event('resend-2', 'email.bounced', 'evt-4', '{"bounce": {"type": "Permanent"}}', now());
select pg_temp.expect((select status = 'bounced' from public.communication_logs where id = (select id from ref where k = 'msg2')) and (select email_suppressed_reason = 'bounced' and email_suppressed_at is not null and not email_opt_out from public.customers where id = 'c1000000-0000-0000-0000-000000000001'), 'a bounce marks the email and suppresses the address');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x')$$, 'message_recipient_suppressed', 'nothing more goes to a bounced address');
update public.customers set email = ' ' || upper(email) || ' ' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email_suppressed_reason = 'bounced' from public.customers where id = 'c1000000-0000-0000-0000-000000000001'), 'saving the same address again, in capitals or with spaces, keeps the bounce');
update public.customers set email = 'cleo.new@umbane.test' where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email_suppressed_at is null from public.customers where id = 'c1000000-0000-0000-0000-000000000001'), 'a new address clears the bounce');

-- A permanent failure waits for a person, who retries to the current address
insert into ref select 'msg3', public.queue_email('c1000000-0000-0000-0000-000000000001', 'Third', 'Body');
select pg_temp.as_service();
select count(*) from public.claim_message((select id from ref where k = 'msg3'));
select public.record_message_result((select id from ref where k = 'msg3'), false, null, 'Resend 422: invalid from address', false);
select pg_temp.expect((select status = 'failed' and next_attempt_at is null and not (select will_retry from public.message_list where id = (select id from ref where k = 'msg3')) from public.communication_logs where id = (select id from ref where k = 'msg3')), 'a permanent failure is not retried by itself');
select pg_temp.expect((select count(*) = 0 from public.claim_message((select id from ref where k = 'msg3'))), 'nor claimed');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$select public.cancel_message((select id from ref where k = 'msg'))$$, 'message_not_cancellable', 'a sent email cannot be cancelled');
select pg_temp.expect_error_like($$select public.retry_message((select id from ref where k = 'msg'))$$, 'message_not_retryable', 'only a failed email is retried');
update public.customers set email = ' Cleo.Latest@Umbane.test ' where id = 'c1000000-0000-0000-0000-000000000001';
select public.retry_message((select id from ref where k = 'msg3'));
select pg_temp.expect((select status = 'queued' and attempts = 0 and recipient = 'cleo.latest@umbane.test' and error is null from public.communication_logs where id = (select id from ref where k = 'msg3')), 'retrying queues it again to the current address');
select pg_temp.as_owner();
update public.communication_logs set attempts = 5 where id = (select id from ref where k = 'msg3');
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 0 from public.claim_message((select id from ref where k = 'msg3'))) and not ((select id from ref where k = 'msg3') in (select public.due_messages(50))), 'after five attempts the server stops trying');

-- Preferences are checked again at send time; a stuck send is picked up again
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into ref select 'msg4', public.queue_email('c1000000-0000-0000-0000-000000000001', 'Fourth', 'Body');
insert into ref select 'msg5', public.queue_email('c1000000-0000-0000-0000-000000000001', 'Fifth', 'Body');
update public.customers set email_opt_out = true where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 0 from public.claim_message((select id from ref where k = 'msg4'))), 'an email to someone who opted out since it was queued is not sent');
select pg_temp.expect((select status = 'cancelled' and error like '%message_opted_out%' from public.communication_logs where id = (select id from ref where k = 'msg4')), 'it is cancelled, with the reason');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.customers set email_opt_out = false where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.as_service();
select count(*) from public.claim_message((select id from ref where k = 'msg5'));
select pg_temp.as_owner();
update public.communication_logs set last_event_at = now() - interval '11 minutes' where id = (select id from ref where k = 'msg5');
select pg_temp.as_service();
select pg_temp.expect((select attempts = 2 from public.claim_message((select id from ref where k = 'msg5'))), 'a send that never finished is picked up again after ten minutes');
select public.record_message_result((select id from ref where k = 'msg5'), true, 'resend-5', null, false);
select public.record_provider_event('resend-5', 'email.complained', 'evt-5', '{}', now());
select pg_temp.expect((select email_opt_out and not marketing_consent and email_suppressed_reason = 'complained' from public.customers where id = 'c1000000-0000-0000-0000-000000000001'), 'a spam complaint opts the customer out and suppresses the address');

-- Summary and isolation
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select sent_this_month = 3 and delivered_this_month = 1 and bounced_this_month = 2 and failed = 0 from public.message_summary), 'the summary counts sent, delivered, bounced and failed email');
select pg_temp.expect_error_like($$select public.cancel_message((select id from ref where k = 'msg4'))$$, 'message_not_cancellable', 'a cancelled email stays cancelled');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client 1
select pg_temp.expect((select count(*) from public.message_list) + (select count(*) from public.message_events) + (select count(*) from public.message_templates) = 0, 'clients see no messages or templates');
select pg_temp.expect_error_like($$select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x')$$, 'permission denied', 'and cannot send email');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.message_list) + (select count(*) from public.message_events) + (select waiting + failed from public.message_summary) = 0, 'another business sees none of our messages');
select pg_temp.expect_error_like($$select public.retry_message((select id from ref where k = 'msg3'))$$, 'permission denied', 'nor retries them');
select pg_temp.expect_error_like($$select public.cancel_message((select id from ref where k = 'msg5'))$$, 'permission denied', 'nor cancels them');
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select * from public.message_list$$, 'permission denied', 'anonymous cannot read messages');
select pg_temp.expect_error_like($$set local role anon; select public.queue_email('c1000000-0000-0000-0000-000000000001', 'x', 'x')$$, 'permission denied', 'anonymous cannot send email');

-- Reports (Phase 11) ------------------------------------------------------------------------------
-- Fixtures in Feb-Apr 2024, a window no other test touches. Inserted as the owner with triggers off
-- so the dates can be set exactly.
select pg_temp.as_owner();
create temp table rep (k text primary key, v jsonb) on commit drop;
grant all on rep to authenticated, anon;
set local session_replication_role = replica;
insert into public.customers (id, business_id, name, segment, province, status, created_at) values
  ('cc240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Report Residential', 'residential', 'Gauteng', 'active', '2024-03-10 10:00+02'),
  ('cc240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Report Commercial', 'commercial', 'Western Cape', 'inactive', '2024-03-31 23:30+02'),
  ('cc240000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'Report Late', 'commercial', null, 'active', '2024-04-01 00:30+02'),
  ('cc240000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000002', 'Other Business Customer', 'residential', 'Gauteng', 'active', '2024-03-15 10:00+02');
insert into public.properties (id, business_id, customer_id, name, address, property_type, province, status, units, created_at) values
  ('dd240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'Report House', '1 Report Road', 'residential', 'Gauteng', 'active', 1, '2024-03-12 09:00+02'),
  ('dd240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000002', 'Report Mall', '2 Report Road', 'commercial', 'Western Cape', 'active', 40, '2024-03-14 09:00+02');
insert into public.electricity_meters (id, business_id, property_id, serial_number, meter_type, installed_on) values
  ('ee240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'dd240000-0000-0000-0000-000000000001', 'RPT-M1', 'smart_prepaid', '2024-01-01'),
  ('ee240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'dd240000-0000-0000-0000-000000000002', 'RPT-M2', 'three_phase_ct', '2024-01-01');
-- M1 uses 10 kWh a day throughout; M2 uses 20 a day for ten March days, estimated.
insert into public.meter_readings (business_id, meter_id, reading_date, reading_value, is_estimate) values
  ('11111111-0000-0000-0000-000000000001', 'ee240000-0000-0000-0000-000000000001', '2024-02-20', 1000, false),
  ('11111111-0000-0000-0000-000000000001', 'ee240000-0000-0000-0000-000000000001', '2024-03-01', 1100, false),
  ('11111111-0000-0000-0000-000000000001', 'ee240000-0000-0000-0000-000000000001', '2024-04-01', 1410, false),
  ('11111111-0000-0000-0000-000000000001', 'ee240000-0000-0000-0000-000000000002', '2024-03-16', 5000, false),
  ('11111111-0000-0000-0000-000000000001', 'ee240000-0000-0000-0000-000000000002', '2024-03-26', 5200, true);
insert into public.orders (id, business_id, customer_id, order_date, status, total, created_at, cancel_reason) values
  ('aa240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', '2024-03-05', 'confirmed', 1150, '2024-03-05 09:00+02', null),
  ('aa240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000002', '2024-03-20', 'cancelled', 500, '2024-03-20 09:00+02', 'Changed their mind'),
  ('aa240000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', '2024-04-02', 'fulfilled', 230, '2024-04-02 09:00+02', null);
insert into public.order_items (business_id, order_id, product_id, description, quantity, unit_price) values
  ('11111111-0000-0000-0000-000000000001', 'aa240000-0000-0000-0000-000000000001', null, 'Report smart meter', 2, 500),
  ('11111111-0000-0000-0000-000000000001', 'aa240000-0000-0000-0000-000000000002', null, 'Cancelled item', 1, 500),
  ('11111111-0000-0000-0000-000000000001', 'aa240000-0000-0000-0000-000000000003', null, 'Report install', 1, 200);
insert into public.invoices (id, business_id, customer_id, invoice_number, status, issue_date, due_date, total, created_at, cancel_reason) values
  ('bb240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'RPT-1', 'paid', '2024-03-05', '2024-04-04', 1150, '2024-03-05 09:00+02', null),
  ('bb240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000002', 'RPT-2', 'partially_paid', '2024-03-20', '2024-03-25', 400, '2024-03-20 09:00+02', null),
  ('bb240000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'RPT-3', 'draft', null, null, 999, '2024-03-10 09:00+02', null),
  ('bb240000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'RPT-4', 'cancelled', '2024-03-12', '2024-04-11', 50, '2024-03-12 09:00+02', 'Issued in error'),
  ('bb240000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000003', 'RPT-5', 'partially_paid', '2024-04-02', '2030-01-01', 230, '2024-04-02 09:00+02', null),
  ('bb240000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000002', 'cc240000-0000-0000-0000-000000000009', 'RPT-B', 'paid', '2024-03-15', '2024-04-14', 7777, '2024-03-15 09:00+02', null);
-- 23:30 on 31 March in South Africa is still March; 00:15 on 1 April is April, though it is 31 March in UTC.
insert into public.payments (business_id, invoice_id, amount, method, paid_at) values
  ('11111111-0000-0000-0000-000000000001', 'bb240000-0000-0000-0000-000000000001', 1150, 'eft', '2024-03-31 23:30+02'),
  ('11111111-0000-0000-0000-000000000001', 'bb240000-0000-0000-0000-000000000002', 100, 'card', '2024-03-22 10:00+02'),
  ('11111111-0000-0000-0000-000000000001', 'bb240000-0000-0000-0000-000000000005', 50, 'eft', '2024-04-01 00:15+02'),
  ('11111111-0000-0000-0000-000000000002', 'bb240000-0000-0000-0000-000000000009', 7777, 'eft', '2024-03-16 10:00+02');
insert into public.products (id, business_id, sku, name, category, unit_price, cost_price, track_stock, stock_on_hand, low_stock_threshold) values
  ('ff240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'RPT-SKU-1', 'Report Meter Kit', 'Report Kits', 250, 100, true, 6, 2),
  ('ff240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'RPT-SKU-2', 'Report Spare', 'Report Kits', 50, 20, true, 0, 1);
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, balance_after, created_at) values
  ('11111111-0000-0000-0000-000000000001', 'ff240000-0000-0000-0000-000000000001', 'received', 10, 10, '2024-03-02 09:00+02'),
  ('11111111-0000-0000-0000-000000000001', 'ff240000-0000-0000-0000-000000000001', 'sold', -3, 7, '2024-03-20 09:00+02'),
  ('11111111-0000-0000-0000-000000000001', 'ff240000-0000-0000-0000-000000000001', 'sold', -1, 6, '2024-04-03 09:00+02');
insert into public.support_tickets (id, business_id, customer_id, reference, subject, category, priority, status, assigned_to, created_at, first_response_at, resolved_at) values
  ('ab240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'RPT-T1', 'Billing question', 'billing', 'high', 'resolved', 'a3000000-0000-0000-0000-000000000001', '2024-03-03 08:00+02', '2024-03-03 10:00+02', '2024-03-04 08:00+02'),
  ('ab240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000002', 'RPT-T2', 'Meter dead', 'meter_fault', 'urgent', 'open', null, '2024-03-20 09:00+02', null, null),
  ('ab240000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'cc240000-0000-0000-0000-000000000001', 'RPT-T3', 'Another bill', 'billing', 'normal', 'open', null, '2024-04-02 09:00+02', null, null);
insert into public.staff_tasks (id, business_id, title, category, status, due_date, assigned_to, created_at, completed_at) values
  ('ac240000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Report on time', 'field_maintenance', 'done', '2024-03-10', 'a3000000-0000-0000-0000-000000000001', '2024-03-02 09:00+02', '2024-03-09 12:00+02'),
  ('ac240000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Report late', 'billing_audit', 'done', '2024-03-08', 'a3000000-0000-0000-0000-000000000001', '2024-03-05 09:00+02', '2024-03-12 12:00+02'),
  ('ac240000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'Report cancelled', 'other', 'cancelled', null, 'a3000000-0000-0000-0000-000000000001', '2024-03-06 09:00+02', null),
  ('ac240000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'Report pending', 'other', 'todo', '2024-03-15', 'a3000000-0000-0000-0000-000000000001', '2024-03-07 09:00+02', null);
set local session_replication_role = origin;

-- Who may run reports
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$select public.report_revenue('2024-03-01', '2024-03-31')$$, 'permission denied', 'staff cannot run reports');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect_error_like($$select public.report_customers('2024-03-01', '2024-03-31')$$, 'permission denied', 'clients cannot run reports');
select pg_temp.as_owner();
select pg_temp.expect_error($$set local role anon; select public.report_overview('2024-03-01', '2024-03-31')$$, 'anonymous visitors cannot run reports');
reset role;
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect_error_like($$select public.report_sales('2024-03-31', '2024-03-01')$$, 'report_range_invalid', 'a period must start before it ends');
select pg_temp.expect_error_like($$select public.report_sales('2018-01-01', '2024-03-01')$$, 'report_range_too_long', 'a period is at most five years');

-- Dates and months
select pg_temp.expect(public.sa_date('2024-03-31 22:30:00+00') = '2024-04-01', 'dates are South African dates');
select pg_temp.expect((select count(*) = 4 and min(first_day) = '2024-11-15' and max(last_day) = '2025-02-10' and min(month) = '2024-11-01' from public.report_months('2024-11-15', '2025-02-10')), 'a period is split into the months it touches, clipped to the period');
select pg_temp.expect(public.report_match(null, 'none') and public.report_match('x', null) and not public.report_match('x', 'none') and not public.report_match(null, 'x'), 'a filter of "none" finds records with the category left empty');

-- Run every report as the manager
insert into rep values
  ('overview', public.report_overview('2024-03-01', '2024-03-31')),
  ('overview_april', public.report_overview('2024-04-01', '2024-04-30')),
  ('electricity_2025', public.report_electricity('2025-03-01', '2025-03-31')),
  ('customers_none', public.report_customers('2024-03-01', '2024-04-30', null, 'none')),
  ('customers', public.report_customers('2024-03-01', '2024-03-31')),
  ('customers_span', public.report_customers('2024-02-15', '2024-04-10')),
  ('customers_commercial', public.report_customers('2024-03-01', '2024-03-31', 'commercial')),
  ('customers_wc', public.report_customers('2024-03-01', '2024-03-31', null, 'Western Cape')),
  ('properties', public.report_properties('2024-03-01', '2024-03-31')),
  ('properties_res', public.report_properties('2024-03-01', '2024-03-31', 'residential')),
  ('electricity', public.report_electricity('2024-03-01', '2024-03-31')),
  ('electricity_span', public.report_electricity('2024-02-25', '2024-03-05')),
  ('electricity_type', public.report_electricity('2024-03-01', '2024-03-31', null, 'smart_prepaid')),
  ('electricity_property', public.report_electricity('2024-03-01', '2024-03-31', 'dd240000-0000-0000-0000-000000000002')),
  ('sales', public.report_sales('2024-03-01', '2024-03-31')),
  ('sales_april', public.report_sales('2024-04-01', '2024-04-30')),
  ('revenue', public.report_revenue('2024-03-01', '2024-04-30')),
  ('revenue_march', public.report_revenue('2024-03-01', '2024-03-31')),
  ('revenue_card', public.report_revenue('2024-03-01', '2024-03-31', 'card')),
  ('revenue_april', public.report_revenue('2024-04-01', '2024-04-30')),
  ('inventory', public.report_inventory('2024-03-01', '2024-03-31', 'Report Kits')),
  ('support', public.report_support('2024-03-01', '2024-03-31')),
  ('support_billing', public.report_support('2024-03-01', '2024-03-31', 'billing')),
  ('support_urgent', public.report_support('2024-03-01', '2024-03-31', null, 'urgent')),
  ('team', public.report_team('2024-03-01', '2024-03-31')),
  ('team_field', public.report_team('2024-03-01', '2024-03-31', 'field_operations')),
  ('team_marketing', public.report_team('2024-03-01', '2024-03-31', 'marketing'));
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((public.report_revenue('2024-03-01', '2024-03-31')->>'collected')::numeric = 1250, 'administrators can run reports');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- business 2 administrator
insert into rep values
  ('b2_revenue', public.report_revenue('2024-03-01', '2024-03-31')),
  ('b2_customers', public.report_customers('2024-03-01', '2024-03-31'));

-- Overview
select pg_temp.expect((select (v->>'collected')::numeric = 1250 and (v->>'invoiced')::numeric = 1550 and (v->>'invoiced_paid')::numeric = 1250 and (v->>'kwh')::numeric = 510 and (v->>'new_customers')::int = 2 and (v->>'customers')::int = 2 and (v->>'orders')::int = 1 and (v->>'order_value')::numeric = 1150 and (v->>'tickets_opened')::int = 2 and (v->>'tickets_resolved')::int = 1 and (v->>'tasks_completed')::int = 2 from rep where k = 'overview'), 'the overview adds up the month');
select pg_temp.expect((select (v->>'collected')::numeric = 50 and (v->>'collected_prior')::numeric = 1250 and (v->>'kwh_prior')::numeric = 500 from rep where k = 'overview_april'), 'the previous period is the same number of days just before');
select pg_temp.expect((select (v->>'kwh_last_year')::numeric = 510 from rep where k = 'electricity_2025'), 'and use is compared with the same period last year');
select pg_temp.expect((select (v->>'total')::int = 1 and v->'rows'->0->>'name' = 'Report Late' from rep where k = 'customers_none'), 'customers filtered to those with no province recorded');
select pg_temp.expect((select jsonb_array_length(v->'months') = 1 and (v->'months'->0->>'collected')::numeric = 1250 and (v->'months'->0->>'kwh')::numeric = 510 from rep where k = 'overview'), 'and splits it by month');

-- Customers
select pg_temp.expect((select (v->>'total')::int = 2 and (v->>'new')::int = 2 and (v->'by_status'->>'active')::int = 1 and (v->'by_status'->>'inactive')::int = 1 from rep where k = 'customers'), 'customers registered by the end of the period, by status (23:30 on the last day counts)');
select pg_temp.expect((select (v->>'billed')::numeric = 1550 and (v->>'paid')::numeric = 1250 and (v->>'row_count')::int = 2 and v->'rows'->0->>'name' = 'Report Residential' and (v->'rows'->0->>'billed')::numeric = 1150 and (v->'rows'->0->>'properties')::int = 1 and (v->'rows'->0->>'meters')::int = 1 from rep where k = 'customers'), 'each customer shows what they were billed and paid, biggest first');
select pg_temp.expect((select jsonb_agg(e->'count' order by e->>'key') = '[1, 1]' from rep, jsonb_array_elements(v->'by_province') e where k = 'customers'), 'customers by province');
select pg_temp.expect((select (v->>'total')::int = 3 from rep where k = 'customers_span') and (select string_agg((e->>'new') || '/' || (e->>'total'), ',' order by e->>'month') = '0/0,2/2,1/3' from rep, jsonb_array_elements(v->'months') e where k = 'customers_span'), 'monthly new and running total; 00:30 on 1 April is April');
select pg_temp.expect((select (v->>'total')::int = 1 and v->'rows'->0->>'name' = 'Report Commercial' from rep where k = 'customers_commercial'), 'customers filtered by segment');
select pg_temp.expect((select (v->>'total')::int = 1 from rep where k = 'customers_wc'), 'customers filtered by province');

-- Properties
select pg_temp.expect((select (v->>'total')::int = 2 and (v->>'new')::int = 2 and (v->>'units')::int = 41 and (v->>'meters_in_service')::int = 2 and (v->>'without_meter')::int = 0 and (v->>'kwh')::numeric = 510 from rep where k = 'properties'), 'properties with their units, meters and use');
select pg_temp.expect((select (v->>'total')::int = 1 and (v->>'kwh')::numeric = 310 from rep where k = 'properties_res'), 'properties filtered by type');

-- Electricity
select pg_temp.expect((select (v->>'kwh')::numeric = 510 and (v->>'estimated_kwh')::numeric = 200 and (v->>'meters_reporting')::int = 2 and (v->>'days')::int = 31 and (v->>'row_count')::int = 3 from rep where k = 'electricity'), 'use in the period, the estimated part, and the readings taken');
select pg_temp.expect((select v->'by_meter'->0->>'serial_number' = 'RPT-M1' and (v->'by_meter'->0->>'kwh')::numeric = 310 and v->'by_property'->1->>'name' = 'Report Mall' from rep where k = 'electricity'), 'use by meter and by property, biggest first');
select pg_temp.expect((select (v->>'kwh')::numeric = 100 and string_agg(e->>'kwh', ',' order by e->>'month') = '50.000,50.000' from rep, jsonb_array_elements(v->'months') e where k = 'electricity_span' group by v), 'only the days inside the period count, split across months');
select pg_temp.expect((select (v->>'kwh')::numeric = 310 from rep where k = 'electricity_type') and (select (v->>'kwh')::numeric = 200 from rep where k = 'electricity_property'), 'use filtered by meter type and by property');

-- Sales and invoices
select pg_temp.expect((select (v->>'orders')::int = 1 and (v->>'order_value')::numeric = 1150 and jsonb_array_length(v->'orders_by_status') = 2 and v->'top_items'->0->>'name' = 'Report smart meter' and (v->'top_items'->0->>'quantity')::int = 2 and jsonb_array_length(v->'top_items') = 1 from rep where k = 'sales'), 'orders in the period, excluding cancelled ones');
select pg_temp.expect((select (v->>'invoices')::int = 2 and (v->>'invoiced')::numeric = 1550 and (v->>'paid_count')::int = 1 and (v->>'paid_amount')::numeric = 1150 and (v->>'overdue_count')::int = 1 and (v->>'overdue_balance')::numeric = 300 and (v->>'unpaid_count')::int = 0 and (v->>'outstanding')::numeric = 300 and (v->>'avg_settlement_days')::numeric = 26 from rep where k = 'sales'), 'issued invoices only (no drafts or cancelled), with what is paid, overdue and the days to settle');
select pg_temp.expect((select (v->>'unpaid_count')::int = 1 and (v->>'unpaid_balance')::numeric = 180 and (v->>'orders')::int = 1 and (v->'months'->0->>'collected')::numeric = 50 from rep where k = 'sales_april'), 'an invoice within its terms is unpaid, not overdue');

-- Revenue
select pg_temp.expect((select (v->>'collected')::numeric = 1250 and (v->>'payments')::int = 2 and (v->>'invoiced')::numeric = 1550 from rep where k = 'revenue_march'), 'payments received in the period');
select pg_temp.expect((select (v->>'collected')::numeric = 50 and (v->>'payments')::int = 1 and (v->>'row_count')::int = 1 from rep where k = 'revenue_april'), 'payments before the period are left out');
select pg_temp.expect((select string_agg((e->>'collected') || '/' || (e->>'invoiced'), ',' order by e->>'month') = '1250.00/1550.00,50.00/230.00' from rep, jsonb_array_elements(v->'months') e where k = 'revenue'), 'collected and invoiced by month');
select pg_temp.expect((select (v->'by_method'->0->>'key') = 'eft' and (v->'by_method'->0->>'amount')::numeric = 1150 from rep where k = 'revenue_march'), 'revenue by payment method');
select pg_temp.expect((select (v->>'collected')::numeric = 100 and (v->>'row_count')::int = 1 from rep where k = 'revenue_card'), 'revenue filtered by payment method');

-- Inventory
select pg_temp.expect((select (v->>'products')::int = 2 and (v->>'units')::int = 6 and (v->>'stock_value')::numeric = 600 and (v->>'out')::int = 1 and (v->>'inbound')::int = 10 and (v->>'outbound')::int = 3 from rep where k = 'inventory'), 'stock now, and units in and out during the period');
select pg_temp.expect((select v->'fast'->0->>'sku' = 'RPT-SKU-1' and (v->'fast'->0->>'outbound')::int = 3 and (v->'months'->0->>'inbound')::int = 10 and (v->>'row_count')::int = 2 from rep where k = 'inventory'), 'the fastest-moving products and monthly movement');

-- Support
select pg_temp.expect((select (v->>'opened')::int = 2 and (v->>'resolved')::int = 1 and (v->>'avg_first_response_hours')::numeric = 2 and (v->>'avg_resolution_hours')::numeric = 24 and (v->>'row_count')::int = 2 from rep where k = 'support'), 'tickets opened and resolved, with response and resolution times');
select pg_temp.expect((select (v->>'opened')::int = 1 from rep where k = 'support_billing') and (select (v->>'opened')::int = 1 and v->'rows'->0->>'reference' = 'RPT-T2' from rep where k = 'support_urgent'), 'tickets filtered by category and priority');

-- Team
select pg_temp.expect((select (r->>'assigned')::int = 3 and (r->>'assigned_done')::int = 2 and (r->>'completed')::int = 2 and (r->>'with_due')::int = 2 and (r->>'on_time')::int = 1 and (r->>'tickets_resolved')::int = 1 from rep, jsonb_array_elements(v->'rows') r where k = 'team' and r->>'id' = 'a3000000-0000-0000-0000-000000000001'), 'each person''s tasks: given, finished, on time, and tickets resolved');
select pg_temp.expect((select (v->>'completed')::int = 2 and (v->>'on_time')::int = 1 from rep where k = 'team_field') and (select (v->>'completed')::int = 0 from rep where k = 'team_marketing'), 'team filtered by department');
select pg_temp.expect((select string_agg((e->>'created') || '/' || (e->>'completed'), ',') = '3/2' from rep, jsonb_array_elements(v->'months') e where k = 'team'), 'tasks given and finished by month');

-- Each business sees only its own figures
select pg_temp.expect((select (v->>'collected')::numeric = 1250 from rep where k = 'revenue_march') and (select (v->>'collected')::numeric = 7777 from rep where k = 'b2_revenue'), 'revenue never includes another business');
select pg_temp.expect((select (v->>'total')::int = 1 and v->'rows'->0->>'name' = 'Other Business Customer' from rep where k = 'b2_customers'), 'customers never include another business');

-- Totals match the source records (the last five years of all test data)
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
insert into rep select 'all_' || k, v from (values
  ('revenue', public.report_revenue(public.business_today() - 1830, public.business_today())),
  ('sales', public.report_sales(public.business_today() - 1830, public.business_today())),
  ('customers', public.report_customers(public.business_today() - 1830, public.business_today())),
  ('properties', public.report_properties(public.business_today() - 1830, public.business_today())),
  ('electricity', public.report_electricity(public.business_today() - 1830, public.business_today())),
  ('inventory', public.report_inventory(public.business_today() - 1830, public.business_today())),
  ('support', public.report_support(public.business_today() - 1830, public.business_today())),
  ('team', public.report_team(public.business_today() - 1830, public.business_today())),
  ('overview', public.report_overview(public.business_today() - 1830, public.business_today()))
) x(k, v);
select pg_temp.as_owner();
create temp table win as select public.business_today() - 1830 as f, public.business_today() as t;
select pg_temp.expect((select (v->>'collected')::numeric = (select sum(amount) from public.payments, win where business_id = '11111111-0000-0000-0000-000000000001' and public.sa_date(paid_at) between f and t) from rep where k = 'all_revenue'), 'revenue equals the payments recorded');
select pg_temp.expect((select (v->>'collected')::numeric = (select sum((e->>'collected')::numeric) from jsonb_array_elements(v->'months') e) and (v->>'collected')::numeric = (select sum((e->>'amount')::numeric) from jsonb_array_elements(v->'by_method') e) and (v->>'collected')::numeric = (select sum((e->>'amount')::numeric) from jsonb_array_elements(v->'rows') e) from rep where k = 'all_revenue'), 'revenue by month, by method and the payment list all add up to the total');
select pg_temp.expect((select (v->>'invoiced')::numeric = (select sum(total) from public.invoices, win where business_id = '11111111-0000-0000-0000-000000000001' and status not in ('draft', 'cancelled') and issue_date between f and t) and (v->>'invoices')::int = (select count(*) from public.invoices, win where business_id = '11111111-0000-0000-0000-000000000001' and status not in ('draft', 'cancelled') and issue_date between f and t) from rep where k = 'all_sales'), 'invoiced equals the invoices issued');
select pg_temp.expect((select (v->>'invoiced')::numeric = (select sum((e->>'invoiced')::numeric) from jsonb_array_elements(v->'months') e) and (v->>'outstanding')::numeric = (select sum((e->>'balance')::numeric) from jsonb_array_elements(v->'rows') e) and (v->>'invoices')::int = (v->>'paid_count')::int + (v->>'unpaid_count')::int + (v->>'overdue_count')::int from rep where k = 'all_sales'), 'invoices split into paid, unpaid and overdue without gaps');
select pg_temp.expect((select (v->>'order_value')::numeric = (select sum(total) from public.orders, win where business_id = '11111111-0000-0000-0000-000000000001' and status <> 'cancelled' and order_date between f and t) from rep where k = 'all_sales'), 'order value equals the orders placed');
select pg_temp.expect((select (v->>'total')::int = (select count(*) from public.customers, win where business_id = '11111111-0000-0000-0000-000000000001' and public.sa_date(created_at) <= t) and (v->>'total')::int = (select sum((e->>'count')::int) from jsonb_array_elements(v->'by_segment') e) and (v->>'total')::int = (v->>'row_count')::int from rep where k = 'all_customers'), 'customer totals equal the customer records');
select pg_temp.expect((select (v->>'total')::int = (select count(*) from public.properties, win where business_id = '11111111-0000-0000-0000-000000000001' and public.sa_date(created_at) <= t) and (v->>'total')::int = (select sum((e->>'count')::int) from jsonb_array_elements(v->'by_type') e) from rep where k = 'all_properties'), 'property totals equal the property records');
select pg_temp.expect((select abs((v->>'kwh')::numeric - (select sum((e->>'kwh')::numeric) from jsonb_array_elements(v->'months') e)) < 0.01 and abs((v->>'kwh')::numeric - (select (p.v->>'kwh')::numeric from rep p where p.k = 'all_properties')) < 0.01 and (v->>'row_count')::int = (select count(*) from public.meter_readings, win where business_id = '11111111-0000-0000-0000-000000000001' and reading_date between f and t) from rep where k = 'all_electricity'), 'electricity by month adds up, matches the property report, and lists every reading');
select pg_temp.expect((select (v->>'stock_value')::numeric = (select sum(stock_value) from public.product_list where business_id = '11111111-0000-0000-0000-000000000001') and (v->>'stock_value')::numeric = (select (o.v->>'stock_value')::numeric from rep o where o.k = 'all_overview') from rep where k = 'all_inventory'), 'stock value equals the products on hand');
select pg_temp.expect((select (v->>'outbound')::int = (select -sum(quantity) from public.inventory_transactions, win where business_id = '11111111-0000-0000-0000-000000000001' and quantity < 0 and public.sa_date(created_at) between f and t) from rep where k = 'all_inventory'), 'units out equal the stock movements');
select pg_temp.expect((select (v->>'opened')::int = (select count(*) from public.support_tickets, win where business_id = '11111111-0000-0000-0000-000000000001' and public.sa_date(created_at) between f and t) and (v->>'opened')::int = (select sum((e->>'count')::int) from jsonb_array_elements(v->'by_category') e) and (v->>'open_now')::int = (select count(*) from public.support_tickets where business_id = '11111111-0000-0000-0000-000000000001' and status in ('open', 'assigned', 'in_progress')) from rep where k = 'all_support'), 'ticket totals equal the tickets');
select pg_temp.expect((select (v->>'completed')::int = (select count(*) from public.staff_tasks t join public.profiles p on p.id = t.assigned_to, win where t.business_id = '11111111-0000-0000-0000-000000000001' and p.role <> 'client' and t.status = 'done' and public.sa_date(t.completed_at) between f and t) and (v->>'pending')::int = (select count(*) from public.staff_tasks t join public.profiles p on p.id = t.assigned_to where t.business_id = '11111111-0000-0000-0000-000000000001' and p.role <> 'client' and t.status in ('todo', 'in_progress')) and (v->>'completed')::int = (select sum((e->>'completed')::int) from jsonb_array_elements(v->'months') e) from rep where k = 'all_team'), 'task totals equal the tasks');

-- Notifications and automations (Phase 12) -------------------------------------------------------------
select pg_temp.as_owner();
create function pg_temp.mgrs() returns integer language sql as $$ select count(*)::integer from public.profiles where business_id = '11111111-0000-0000-0000-000000000001' and is_active and role in ('administrator', 'manager') $$;
select pg_temp.expect(exists (select 1 from public.notifications where category = 'tickets') and not exists (select 1 from public.notifications where link like '/support-tickets%' and category <> 'tickets') and not exists (select 1 from public.notifications where link like '/tasks%' and category <> 'tasks'), 'notifications are sorted into categories by what they are about');

-- A notification can only be marked read
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$update public.notifications set title = 'Changed'$$, 'permission denied', 'nobody can rewrite a notification');
select pg_temp.expect_error_like($$update public.notifications set email_status = 'queued'$$, 'permission denied', 'or queue an email from one');

-- Preferences: each person's own
insert into public.notification_preferences (user_id, category, in_app, email) values ('a3000000-0000-0000-0000-000000000001', 'tasks', false, true);
select pg_temp.expect_error_like($$insert into public.notification_preferences (user_id, category) values ('a2000000-0000-0000-0000-000000000001', 'tasks')$$, 'row-level security', 'nobody sets another person''s preferences');
select pg_temp.expect_error_like($$insert into public.notification_preferences (user_id, category) values ('a3000000-0000-0000-0000-000000000001', 'billing')$$, 'notification_preferences_category_check', 'categories come from a fixed list');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect((select count(*) = 0 from public.notification_preferences), 'nobody sees another person''s preferences');

-- notify() follows the preferences and never repeats a key
select pg_temp.as_owner();
select pg_temp.expect(public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Email only', 'Body', '/tasks', 'p12-k1', false), 'a notification goes by the route the person chose');
select pg_temp.expect((select not in_app and email_status = 'queued' and email_next_at is not null from public.notifications where dedupe_key = 'p12-k1'), 'with tasks set to email only, it is queued for email and kept out of the app');
select pg_temp.expect(not public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Email only', 'Body', '/tasks', 'p12-k1', false) and (select count(*) = 1 from public.notifications where dedupe_key = 'p12-k1'), 'the same notification is never delivered twice');
select pg_temp.expect(not public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'tasks', 'Wrong business', 'Body', '/tasks', null, false), 'nor to someone in another business');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 0 from public.notifications where dedupe_key = 'p12-k1'), 'an email-only notification is not shown in the app');
update public.notification_preferences set email = false where category = 'tasks';
select pg_temp.as_owner();
select pg_temp.expect(not public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Nothing', 'x', '/tasks', 'p12-k2', false), 'a category switched off entirely sends nothing');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.notification_preferences set email = true where category = 'tasks';

-- Notification email: sent by the server, once, with retries
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 1 and bool_and(recipient = 'staff1@umbane.test' and title = 'Email only') from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'the server picks up the email, addressed to the person');
select pg_temp.expect((select email_status = 'sending' and email_attempts = 1 from public.notifications where dedupe_key = 'p12-k1'), 'and marks it as being sent');
select pg_temp.expect((select count(*) = 0 from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'nobody else can pick it up meanwhile');
select pg_temp.expect(public.record_notification_email((select id from public.notifications where dedupe_key = 'p12-k1'), false, 'Resend 503', true), 'a temporary failure is recorded');
select pg_temp.expect((select email_status = 'failed' and email_next_at > now() and email_error = 'Resend 503' from public.notifications where dedupe_key = 'p12-k1') and (select count(*) = 0 from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'and tried again later, not straight away');
select pg_temp.as_owner();
update public.notifications set email_next_at = now() - interval '1 minute' where dedupe_key = 'p12-k1';
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 1 from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'when it is due it is picked up again');
select public.record_notification_email(id, true, null, false) from public.notifications where dedupe_key = 'p12-k1';
select pg_temp.expect((select email_status = 'sent' and emailed_at is not null and email_attempts = 2 and email_next_at is null and email_error is null from public.notifications where dedupe_key = 'p12-k1'), 'and marked sent');
select pg_temp.expect(not public.record_notification_email((select id from public.notifications where dedupe_key = 'p12-k1'), false, 'late', true), 'a result is recorded once only');
select pg_temp.as_owner();
select public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Permanent', 'x', '/tasks', 'p12-k3', false);
select public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Stuck', 'x', '/tasks', 'p12-k6', false);
select pg_temp.as_service();
select count(*) from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001');
select public.record_notification_email(id, false, 'Resend 422: invalid address', false) from public.notifications where dedupe_key = 'p12-k3';
select pg_temp.expect((select email_status = 'failed' and email_next_at is null from public.notifications where dedupe_key = 'p12-k3'), 'a permanent failure is not retried');
select pg_temp.as_owner();
update public.notifications set email_next_at = now() - interval '11 minutes' where dedupe_key = 'p12-k6';
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 1 and bool_and(title = 'Stuck') from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'an email stuck mid-send is picked up again after ten minutes');
select pg_temp.as_owner();
update public.notifications set email_status = 'failed', email_attempts = 5, email_next_at = now() - interval '1 minute' where dedupe_key = 'p12-k6';
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 0 from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'after five attempts the server stops trying');
select pg_temp.as_owner();
select public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Old news', 'x', '/tasks', 'p12-k5', false);
update public.notifications set created_at = now() - interval '3 days' where dedupe_key = 'p12-k5';
select public.notify('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tasks', 'Unwanted', 'x', '/tasks', 'p12-k4', false);
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.notification_preferences set email = false, in_app = true where category = 'tasks';
select pg_temp.as_service();
select pg_temp.expect((select count(*) = 0 from public.claim_notification_emails(10, '11111111-0000-0000-0000-000000000001')), 'emails no longer wanted, or too old to matter, are not sent');
select pg_temp.expect((select email_status = 'skipped' and email_error = 'Too old to send' from public.notifications where dedupe_key = 'p12-k5') and (select email_status = 'skipped' and email_error = 'No longer wanted' from public.notifications where dedupe_key = 'p12-k4'), 'and say why');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
delete from public.notification_preferences where category = 'tasks';
select pg_temp.expect_error_like($$select * from public.claim_notification_emails(10)$$, 'permission denied', 'only the server sends notification email');
select pg_temp.expect_error_like($$select public.run_automations()$$, 'permission denied', 'or runs every business''s automations');

-- Template filling for automated customer email
select pg_temp.expect(public.render_template('Hi {{customer_name}}, {{unknown}}you owe {{balance_due}}', '{"customer_name": "Thabo", "balance_due": "R 1,234.50"}') = 'Hi Thabo, you owe R 1,234.50', 'templates are filled in, and unknown placeholders dropped');
select pg_temp.expect(public.format_rand(1234.5) = 'R 1,234.50' and public.format_sa_date('2026-03-05') = '5 Mar 2026', 'amounts and dates are written the South African way');

-- Automation settings
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect((select count(*) = 9 and count(*) filter (where enabled) = 6 and bool_and(not enabled) filter (where key in ('payment_reminder', 'overdue_notice', 'ticket_status_email')) from public.automations), 'every business starts with nine automations, with customer emails off');
update public.automations set settings = '{"days_overdue": 3}' where key = 'overdue_invoices';
select pg_temp.expect((select settings ->> 'days_overdue' = '3' and updated_by = 'a2000000-0000-0000-0000-000000000001' from public.automations where key = 'overdue_invoices'), 'a manager changes a setting and is recorded as doing so');
select pg_temp.expect_error_like($$update public.automations set settings = '{"days_overdue": 999}' where key = 'overdue_invoices'$$, 'automation_settings_invalid', 'settings stay within their limits');
select pg_temp.expect_error_like($$update public.automations set settings = '{"days_overdue": 1, "send_to": "everyone"}' where key = 'overdue_invoices'$$, 'automation_settings_invalid', 'unknown settings are refused');
select pg_temp.expect_error_like($$update public.automations set settings = '{}' where key = 'overdue_invoices'$$, 'automation_settings_invalid', 'a setting cannot be left out');
select pg_temp.expect_error_like($$update public.automations set settings = '{"days_overdue": 1.5}' where key = 'overdue_invoices'$$, 'automation_settings_invalid', 'days are whole numbers');
select pg_temp.expect_error_like($$update public.automations set settings = '{"x": 1}' where key = 'low_stock'$$, 'automation_settings_invalid', 'automations without settings take none');
select pg_temp.expect_error_like($$update public.automations set key = 'low_stock' where key = 'new_customer'$$, 'permission denied', 'an automation''s kind never changes');
select pg_temp.expect_error_like($$update public.automations set last_status = 'success'$$, 'permission denied', 'and its results cannot be faked');
select pg_temp.expect_error_like($$insert into public.automation_actions (business_id, automation_key, target_type, outcome) values ('11111111-0000-0000-0000-000000000001', 'low_stock', 'product', 'notified')$$, 'permission denied', 'nor its log');
update public.automations set settings = '{"days_overdue": 1}' where key = 'overdue_invoices';
update public.automations set enabled = true where key in ('payment_reminder', 'overdue_notice', 'ticket_status_email');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 0 from public.automations) and (select count(*) = 0 from public.automation_runs) and (select count(*) = 0 from public.automation_actions), 'staff do not see automations');
select pg_temp.expect_error_like($$select public.run_my_automations()$$, 'permission denied', 'nor run them');
update public.automations set enabled = false;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 0 from public.automations where business_id = '11111111-0000-0000-0000-000000000001' and not enabled), 'nor switch them off');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- business 2 administrator
select pg_temp.expect((select count(*) = 9 and bool_and(business_id = '11111111-0000-0000-0000-000000000002') and count(*) filter (where enabled) = 6 from public.automations), 'another business has its own automations');

-- New customers
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
with c as (insert into public.customers (name, email, segment, province) values ('Phase Twelve Traders', 'p12@example.test', 'commercial', 'Gauteng') returning id)
insert into ref select 'p12cust', id from c;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() and bool_and(category = 'customers' and title = 'New customer: Phase Twelve Traders' and body = 'Commercial · Gauteng · p12@example.test' and link = '/customers/' || (select id from ref where k = 'p12cust')) and bool_and(user_id in (select id from public.profiles where role in ('administrator', 'manager'))) from public.notifications where dedupe_key = 'new-customer:' || (select id from ref where k = 'p12cust')), 'the managers hear about a new customer');
select pg_temp.expect((select outcome = 'notified' and detail = 'Notified ' || pg_temp.mgrs() || ' people' and run_id is null and target_label = 'Phase Twelve Traders' from public.automation_actions where dedupe_key = 'new-customer:' || (select id from ref where k = 'p12cust')), 'and the action is logged');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
with c as (insert into public.customers (name) values ('Manager Added') returning id) insert into ref select 'p12mgr', id from c;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() - 1 and bool_and(user_id <> 'a2000000-0000-0000-0000-000000000001') from public.notifications where title = 'New customer: Manager Added'), 'the manager who added the customer is not told about it');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.automations set enabled = false where key = 'new_customer';
insert into public.customers (name) values ('Quiet Customer');
update public.automations set enabled = true where key = 'new_customer';
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from public.notifications where title = 'New customer: Quiet Customer'), 'a switched-off automation does nothing');

-- Low stock: once, when stock crosses the reorder level
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
insert into ref select 'p12prod', public.create_product('P12-SKU', 'Phase 12 meter', 100, 10, p_low_stock_threshold => 5);
select pg_temp.as_service();  -- no one signed in, so every manager is told
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'adjusted', -4, 'Count');
select pg_temp.expect(not exists (select 1 from public.notifications where title like '%: Phase 12 meter'), 'no alert while stock is above the reorder level');
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'adjusted', -2, 'Count');
select pg_temp.expect((select count(*) = pg_temp.mgrs() and bool_and(category = 'inventory' and body = 'P12-SKU has 4 left (reorder level 5).') from public.notifications where title = 'Low stock: Phase 12 meter'), 'the managers are told when it drops to the reorder level');
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'adjusted', -1, 'Count');
select pg_temp.expect((select count(*) = pg_temp.mgrs() from public.notifications where title like '%: Phase 12 meter'), 'not again on every sale below it');
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'adjusted', -3, 'Count');
select pg_temp.expect((select count(*) = pg_temp.mgrs() from public.notifications where title = 'Out of stock: Phase 12 meter'), 'and once more when it runs out');
-- As if it were another day: today's keys no longer block a repeat, so only the crossing rule does.
select pg_temp.as_owner();
delete from public.automation_actions where automation_key = 'low_stock' and target_id = (select id from ref where k = 'p12prod');
delete from public.notifications where title like '%: Phase 12 meter';
select pg_temp.as_service();
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'received', 2, 'Part delivery');
select pg_temp.expect(not exists (select 1 from public.notifications where title like '%: Phase 12 meter'), 'restocking that leaves it below the reorder level does not alert again');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.automations set enabled = false where key = 'low_stock';
select pg_temp.as_service();
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'received', 10, 'Restock');
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note) values ('11111111-0000-0000-0000-000000000001', (select id from ref where k = 'p12prod'), 'adjusted', -12, 'Count');
select pg_temp.expect(not exists (select 1 from public.notifications where title like '%: Phase 12 meter'), 'with low stock alerts switched off, nobody is told');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.automations set enabled = true where key = 'low_stock';

-- Urgent tickets
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
with t as (insert into public.support_tickets (customer_id, subject, description, category, priority, assigned_to) values ('c1000000-0000-0000-0000-000000000001', 'P12 sparks', 'Sparks at the meter', 'meter_fault', 'urgent', 'a3000000-0000-0000-0000-000000000001') returning id)
insert into ref select 'p12urgent', id from t;
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() and bool_and(category = 'tickets' and title like 'Urgent ticket TKT-%' and body = 'P12 sparks') from public.notifications where dedupe_key = 'urgent-ticket:' || (select id from ref where k = 'p12urgent')), 'the managers hear at once about an urgent ticket');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
with t as (insert into public.support_tickets (customer_id, subject, description, category, assigned_to) values ('c1000000-0000-0000-0000-000000000002', 'P12 flicker', 'Lights flicker', 'meter_fault', 'a3000000-0000-0000-0000-000000000001') returning id)
insert into ref select 'p12later', id from t;
update public.support_tickets set priority = 'urgent' where id = (select id from ref where k = 'p12later');
update public.support_tickets set priority = 'high' where id = (select id from ref where k = 'p12later');
update public.support_tickets set priority = 'urgent' where id = (select id from ref where k = 'p12later');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() - 1 and bool_and(user_id <> 'a2000000-0000-0000-0000-000000000001') from public.notifications where dedupe_key = 'urgent-ticket:' || (select id from ref where k = 'p12later')), 'a ticket raised to urgent alerts once, however often it changes');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
with t as (insert into public.support_tickets (customer_id, subject, description, category, priority) values ('c1000000-0000-0000-0000-000000000002', 'P12 unassigned urgent', 'No power', 'meter_fault', 'urgent') returning id)
insert into ref select 'p12unassigned', id from t;
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.support_tickets set assigned_to = 'a3000000-0000-0000-0000-000000000001', status = 'assigned' where id = (select id from ref where k = 'p12unassigned');
update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'p12unassigned');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) > 0 from public.notifications where title = 'New support ticket' and link = '/support-tickets/' || (select id from ref where k = 'p12unassigned')) and not exists (select 1 from public.notifications where dedupe_key = 'urgent-ticket:' || (select id from ref where k = 'p12unassigned')), 'an urgent ticket opened unassigned is announced once, as a new ticket, not again when it is worked on');

-- Ticket status emails to customers without a login
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
with t as (insert into public.support_tickets (customer_id, subject, description, category, assigned_to) values ((select id from ref where k = 'p12cust'), 'Status mail', 'Please help', 'billing', 'a3000000-0000-0000-0000-000000000001') returning id)
insert into ref select 'p12mail', id from t;
update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'p12mail');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 1 and bool_and(channel = 'email' and status = 'queued' and template_key = 'ticket_update' and recipient = 'p12@example.test' and subject like 'Update on your support ticket TKT-%' and body like 'Good day Phase Twelve Traders,%We are working on your support ticket.%' and created_by is null) from public.communication_logs where ticket_id = (select id from ref where k = 'p12mail')), 'the customer is emailed when the team starts work');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
with t as (insert into public.support_tickets (customer_id, subject, description, category, assigned_to) values ((select id from ref where k = 'p12cust'), 'Server change', 'Please help', 'billing', 'a3000000-0000-0000-0000-000000000001') returning id)
insert into ref select 'p12srv', id from t;
select pg_temp.as_service();
update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'p12srv');
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from public.communication_logs where ticket_id = (select id from ref where k = 'p12srv')) and not exists (select 1 from public.automation_actions where target_id = (select id from ref where k = 'p12srv')), 'a change not made by the team emails nobody');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.support_tickets set status = 'resolved', resolution = 'Billing corrected.' where id = (select id from ref where k = 'p12mail');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 2 and bool_or(body like '%has been resolved.%Billing corrected.%') from public.communication_logs where ticket_id = (select id from ref where k = 'p12mail')), 'and when it is resolved, with the resolution');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.support_tickets set status = 'in_progress' where id = (select id from ref where k = 'p12urgent');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 0 from public.communication_logs where ticket_id = (select id from ref where k = 'p12urgent')) and (select count(*) = 1 from public.notifications where title like '% is now In Progress' and link = '/support-tickets/' || (select id from ref where k = 'p12urgent')), 'a customer who signs in gets the update in the app instead');
select pg_temp.expect(not exists (select 1 from public.automation_actions where automation_key = 'ticket_status_email' and target_id = (select id from ref where k = 'p12urgent')), 'and the email automation leaves them alone');
update public.customers set email_opt_out = true where id = (select id from ref where k = 'p12cust');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.support_tickets set status = 'closed' where id = (select id from ref where k = 'p12mail');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 2 from public.communication_logs where ticket_id = (select id from ref where k = 'p12mail')) and (select outcome = 'skipped' and detail = 'message_opted_out' from public.automation_actions where dedupe_key like 'ticket-status:' || (select id from ref where k = 'p12mail') || ':closed:%'), 'a customer who opted out is not emailed, and the log says why');

-- Scheduled automations
select pg_temp.as_owner();
set local session_replication_role = replica;
insert into public.customers (id, business_id, name, email, email_opt_out) values
  ('c1200000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Reminder Customer', 'remind@example.test', false),
  ('c1200000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Opted Out Customer', 'optout@example.test', true);
insert into public.invoices (id, business_id, customer_id, invoice_number, status, issue_date, due_date, total, issued_by) values
  ('1a120000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-OVERDUE', 'sent', public.business_today() - 30, public.business_today() - 3, 1234.50, 'a3000000-0000-0000-0000-000000000001'),
  ('1a120000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-ANCIENT', 'sent', public.business_today() - 90, public.business_today() - 60, 500, null),
  ('1a120000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-SOON', 'sent', public.business_today() - 10, public.business_today() + 2, 1234.50, null),
  ('1a120000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000002', 'P12-SOON-OPTOUT', 'sent', public.business_today() - 10, public.business_today() + 2, 800, null),
  ('1a120000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-WEEK', 'partially_paid', public.business_today() - 40, public.business_today() - 7, 2000, null),
  ('1a120000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-PAID', 'paid', public.business_today() - 30, public.business_today() - 3, 300, null);
insert into public.payments (business_id, invoice_id, amount, method, paid_at) values
  ('11111111-0000-0000-0000-000000000001', '1a120000-0000-0000-0000-000000000005', 500, 'eft', now() - interval '10 days'),
  ('11111111-0000-0000-0000-000000000001', '1a120000-0000-0000-0000-000000000006', 300, 'eft', now() - interval '10 days');
insert into public.staff_tasks (id, business_id, title, status, due_date, assigned_to, created_by) values
  ('7a120000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'P12 due tomorrow', 'todo', public.business_today() + 1, 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('7a120000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'P12 overdue', 'in_progress', public.business_today() - 1, 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('7a120000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'P12 finished', 'done', public.business_today() + 1, 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
insert into public.meter_maintenance (id, business_id, meter_id, kind, issue, status, scheduled_for) values
  ('3a120000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', (select id from public.electricity_meters where business_id = '11111111-0000-0000-0000-000000000001' order by created_at, id limit 1), 'inspection', 'Six-monthly inspection', 'scheduled', public.business_today() + 1);
set local session_replication_role = origin;

select pg_temp.as_service();
select public.run_automations('11111111-0000-0000-0000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() + 1 and bool_and(category = 'invoices' and title = 'Invoice P12-OVERDUE is overdue' and body = 'Reminder Customer owes R 1,234.50, due ' || public.format_sa_date(public.business_today() - 3) || '.') from public.notifications where dedupe_key = 'overdue-invoice:1a120000-0000-0000-0000-000000000001'), 'an overdue invoice alerts the managers and the person who issued it');
select pg_temp.expect(not exists (select 1 from public.notifications where title like 'Invoice P12-ANCIENT%' or title like 'Invoice P12-PAID%'), 'invoices overdue long before, or already paid, are left alone');
select pg_temp.expect((select count(*) = 1 and bool_and(template_key = 'payment_reminder' and recipient = 'remind@example.test' and subject = 'Reminder: invoice P12-SOON is due' and body like '%invoice P12-SOON has a balance of R 1,234.50, due ' || public.format_sa_date(public.business_today() + 2) || '.%' and created_by is null and status = 'queued') from public.communication_logs where invoice_id = '1a120000-0000-0000-0000-000000000003'), 'the customer gets a payment reminder before the due date');
select pg_temp.expect((select count(*) = 0 from public.communication_logs where invoice_id = '1a120000-0000-0000-0000-000000000004') and (select outcome = 'skipped' and detail = 'message_opted_out' from public.automation_actions where target_id = '1a120000-0000-0000-0000-000000000004'), 'but not a customer who opted out');
select pg_temp.expect((select count(*) = 1 and bool_and(template_key = 'invoice_overdue' and subject = 'Invoice P12-WEEK is overdue' and body like '%still has a balance of R 1,500.00%') from public.communication_logs where invoice_id = '1a120000-0000-0000-0000-000000000005'), 'and an overdue notice a week after it');
select pg_temp.expect((select count(*) = 1 and bool_and(user_id = 'a3000000-0000-0000-0000-000000000001' and title like 'TSK-% is due tomorrow' and body = 'P12 due tomorrow') from public.notifications where dedupe_key = 'task-due:7a120000-0000-0000-0000-000000000001:' || (public.business_today() + 1)), 'a task due tomorrow reminds the person doing it');
select pg_temp.expect((select count(*) = 2 and bool_and(title like 'TSK-% is overdue') from public.notifications where dedupe_key = 'task-overdue:7a120000-0000-0000-0000-000000000002:' || (public.business_today() - 1)), 'an overdue task tells the person doing it and the person who set it');
select pg_temp.expect(not exists (select 1 from public.notifications where dedupe_key like 'task-%:7a120000-0000-0000-0000-000000000003:%'), 'a finished task is left alone');
select pg_temp.expect((select count(*) = pg_temp.mgrs() and bool_and(category = 'maintenance' and title like 'Inspection due tomorrow on meter %' and body = 'Nobody is assigned yet.') from public.notifications where dedupe_key = 'maintenance-due:3a120000-0000-0000-0000-000000000001:' || (public.business_today() + 1)), 'unassigned maintenance due tomorrow goes to the managers');
select pg_temp.expect((select count(*) = 5 and bool_and(trigger = 'schedule' and finished_at is not null and status in ('success', 'nothing_to_do')) from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000001'), 'each switched-on scheduled automation logs its run');
select pg_temp.expect((select last_status = 'success' and last_run_at is not null and last_message like '% done, % skipped, 0 failed' from public.automations where business_id = '11111111-0000-0000-0000-000000000001' and key = 'payment_reminder'), 'and its latest result');
select pg_temp.expect((select count(*) = 0 from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000002'), 'one business''s run leaves the others alone');
create temp table p12_before as select (select count(*) from public.notifications) as n, (select count(*) from public.communication_logs) as m, (select count(*) from public.automation_actions) as a;
select pg_temp.as_service();
select public.run_automations('11111111-0000-0000-0000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select (select count(*) from public.notifications) = n and (select count(*) from public.communication_logs) = m and (select count(*) from public.automation_actions) = a from p12_before), 'running again sends nothing twice');
select pg_temp.expect((select count(*) = 5 and bool_and(status = 'nothing_to_do' and checked = 0) from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000001' and number > (select max(number) - 5 from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000001')), 'and says there was nothing to do');

-- A failure is logged and retried on the next run
set local session_replication_role = replica;
insert into public.invoices (id, business_id, customer_id, invoice_number, status, issue_date, due_date, total) values
  ('1a120000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'c1200000-0000-0000-0000-000000000001', 'P12-FAIL', 'sent', public.business_today() - 30, public.business_today() - 2, 99);
set local session_replication_role = origin;
alter table public.notifications add constraint p12_fail check (title not like 'Invoice P12-FAIL%');
select pg_temp.as_service();
select public.run_automations('11111111-0000-0000-0000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 1 and bool_and(outcome = 'failed' and dedupe_key is null and target_label = 'P12-FAIL · Reminder Customer' and detail like '%p12_fail%' and run_id is not null) from public.automation_actions where target_id = '1a120000-0000-0000-0000-000000000009'), 'a failure is logged with the reason');
select pg_temp.expect((select last_status = 'failed' and last_message = '0 done, 0 skipped, 1 failed' from public.automations where business_id = '11111111-0000-0000-0000-000000000001' and key = 'overdue_invoices'), 'and the automation shows it failed');
alter table public.notifications drop constraint p12_fail;
select pg_temp.as_service();
select public.run_automations('11111111-0000-0000-0000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() from public.notifications where title = 'Invoice P12-FAIL is overdue') and (select count(*) = 1 from public.automation_actions where target_id = '1a120000-0000-0000-0000-000000000009' and outcome = 'notified'), 'the next run tries again and succeeds');
set local session_replication_role = replica;
update public.automations set settings = '{"days_overdue": "soon"}' where business_id = '11111111-0000-0000-0000-000000000001' and key = 'overdue_invoices';
set local session_replication_role = origin;
select pg_temp.as_service();
select public.run_automations('11111111-0000-0000-0000-000000000001');
select pg_temp.as_owner();
select pg_temp.expect((select status = 'failed' and error like '%invalid input syntax%' from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000001' and automation_key = 'overdue_invoices' order by number desc limit 1) and (select status <> 'failed' from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000001' and automation_key = 'task_reminders' order by number desc limit 1), 'one automation failing does not stop the others');
update public.automations set settings = '{"days_overdue": 1}' where business_id = '11111111-0000-0000-0000-000000000001' and key = 'overdue_invoices';

-- Run now, and every business on schedule
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select public.run_my_automations();
select pg_temp.expect((select count(*) = 5 and bool_and(started_by = 'a2000000-0000-0000-0000-000000000001') from public.automation_runs where trigger = 'manual'), 'a manager can run their business''s automations now');
select pg_temp.expect((select count(*) > 0 from public.automation_actions) and (select bool_and(business_id = '11111111-0000-0000-0000-000000000001') from public.automation_runs), 'and sees only their own business''s runs');
select pg_temp.as_service();
select public.run_automations();
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = 3 from public.automation_runs where business_id = '11111111-0000-0000-0000-000000000002'), 'the daily run covers every business (with its own switched-on automations)');

-- Settings, administration and audit (Phase 13) -------------------------------------------------------
-- Business profile: administrators edit, everyone on the team reads
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
update public.businesses set description = 'Electricity sub-metering and billing.', website = 'https://umbane.test', city = 'Johannesburg', province = 'Gauteng', postal_code = '2196' where id = '11111111-0000-0000-0000-000000000001';
select pg_temp.expect((select city = 'Johannesburg' and province = 'Gauteng' and postal_code = '2196' from public.businesses), 'an administrator updates the business profile');
select pg_temp.expect_error_like($$update public.businesses set website = 'umbane.test'$$, 'businesses_website_check', 'a website starts with http:// or https://');
select pg_temp.expect_error_like($$update public.businesses set postal_code = '219'$$, 'businesses_postal_code_check', 'a postal code has four digits');
select pg_temp.expect_error_like($$update public.businesses set province = 'Gauteng North'$$, 'businesses_province_check', 'provinces come from the list');
select pg_temp.expect_error_like($$update public.businesses set email = 'not an email'$$, 'businesses_email_check', 'the business email must look like an email address');
select pg_temp.expect(exists (select 1 from public.audit_logs where table_name = 'businesses' and action = 'UPDATE' and actor_name = 'Ada Admin' and details -> 'changes' -> 'city' = '[null, "Johannesburg"]'), 'the change is in the audit log: who, and what changed from what to what');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.businesses set city = 'Pretoria';
select pg_temp.expect((select city = 'Johannesburg' from public.businesses), 'a manager cannot change the business profile');

-- The audit log: what changed, who, when; only administrators read it
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.customers set phone = '+27 82 000 0222' where id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select count(*) = 1 and bool_and(actor_id = 'a3000000-0000-0000-0000-000000000001' and actor_name = 'Sam Staff' and created_at is not null and details -> 'changes' ? 'phone' and not (details -> 'changes' ? 'updated_at')) from public.audit_logs where table_name = 'customers' and record_id = 'c1000000-0000-0000-0000-000000000002' and action = 'UPDATE' and details -> 'changes' ? 'phone'), 'a change records who made it, when, and only the fields that changed');
update public.customers set id_number = '8001015009087' where id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.expect((select details -> 'changes' -> 'id_number' ->> 1 = '•••087' from public.audit_logs where table_name = 'customers' and details -> 'changes' ? 'id_number' order by created_at desc limit 1), 'ID numbers are masked in the log');
create temp table p13_audit as select count(*) as n from pg_temp.audit_rows();
grant all on p13_audit to authenticated;
update public.customers set updated_at = now() where id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.expect((select count(*) from pg_temp.audit_rows()) = (select n from p13_audit), 'an update that changes nothing anyone made is not logged');
select pg_temp.expect(exists (select 1 from pg_temp.audit_rows() where table_name = 'automations' and details -> 'changes' ? 'enabled') and not exists (select 1 from pg_temp.audit_rows() where table_name = 'automations' and details -> 'changes' ? 'last_run_at'), 'switching an automation is logged; its runs are not');
select pg_temp.expect_error_like($$update public.audit_logs set action = 'forged'$$, 'permission denied', 'nobody can change the audit log');
select pg_temp.expect_error_like($$delete from public.audit_logs$$, 'permission denied', 'or delete from it');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- business 2 administrator
select pg_temp.expect(not exists (select 1 from public.audit_logs where business_id = '11111111-0000-0000-0000-000000000001'), 'administrators see only their own business''s log');

-- Recent activity for managers: everyday records, nothing about people, settings or security
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect((select count(*) > 0 and bool_and(table_name not in ('profiles', 'businesses', 'automations', 'staff_invitations', 'message_templates')) from public.recent_activity(50)), 'managers see recent everyday activity without the sensitive parts');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) = 0 from public.recent_activity(50)), 'staff see none of it');

-- Security events
select public.log_security_event('password_changed');
select pg_temp.expect_error_like($$select public.log_security_event('deleted_everything')$$, 'security_event_unknown', 'only known security events can be logged');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select count(*) = 1 and bool_and(actor_id = 'a3000000-0000-0000-0000-000000000001' and record_id = 'a3000000-0000-0000-0000-000000000001' and details ->> 'event' = 'password_changed') from public.audit_logs where action = 'SECURITY'), 'a password change is logged for the person who made it');
select pg_temp.as_owner();
select pg_temp.expect_error($$set local role anon; select public.log_security_event('password_changed')$$, 'visitors cannot log security events');
reset role;

-- Ticket categories
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect((select array_agg(key order by position) = array['meter_fault', 'prepaid_token', 'billing', 'telemetry', 'installation', 'general'] from public.ticket_categories), 'every business starts with the six ticket categories');
insert into public.ticket_categories (key, label, position) values ('solar', 'Solar installations', 70);
select pg_temp.expect_error_like($$insert into public.ticket_categories (key, label) values ('solar_2', ' solar INSTALLATIONS ')$$, 'ticket_categories_label_uniq', 'two categories cannot share a name');
select pg_temp.expect_error_like($$insert into public.ticket_categories (key, label) values ('Bad Key', 'Bad')$$, 'ticket_categories_key_check', 'keys are lower-case words');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
with t as (insert into public.support_tickets (customer_id, subject, description, category) values ('c1000000-0000-0000-0000-000000000002', 'Panel output low', 'Inverter shows low output', 'solar') returning id)
insert into ref select 'p13solar', id from t;
select pg_temp.expect((select category = 'solar' from public.support_tickets where id = (select id from ref where k = 'p13solar')), 'a new category can be used straight away');
select pg_temp.expect_error_like($$insert into public.ticket_categories (key, label) values ('x_staff', 'Staff made')$$, 'row-level security', 'staff cannot manage categories');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
update public.ticket_categories set is_active = false where key = 'solar';
select pg_temp.expect_error_like($$insert into public.support_tickets (customer_id, subject, description, category) values ('c1000000-0000-0000-0000-000000000002', 'More solar', 'x', 'solar')$$, 'ticket_category_unknown', 'a switched-off category cannot be chosen');
update public.support_tickets set priority = 'high' where id = (select id from ref where k = 'p13solar');
select pg_temp.expect((select category = 'solar' and priority = 'high' from public.support_tickets where id = (select id from ref where k = 'p13solar')), 'tickets already in it keep it');
update public.support_tickets set category = 'solar', subject = 'Panel output low (checked)' where id = (select id from ref where k = 'p13solar');
select pg_temp.expect((select category = 'solar' and subject = 'Panel output low (checked)' from public.support_tickets where id = (select id from ref where k = 'p13solar')), 'and can still be edited, the form sending the same category again');
select pg_temp.expect_error_like($$update public.ticket_categories set key = 'pv' where key = 'solar'$$, 'category_key_fixed', 'a category''s key never changes');
select pg_temp.expect_error_like($$delete from public.ticket_categories where key = 'solar'$$, 'category_in_use', 'a category in use cannot be deleted');
insert into public.ticket_categories (key, label) values ('unused', 'Never used');
delete from public.ticket_categories where key = 'unused';
select pg_temp.expect(not exists (select 1 from public.ticket_categories where key = 'unused'), 'an unused one can');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect((select count(*) = 6 and bool_and(is_active) from public.ticket_categories), 'clients see the switched-on categories to choose from');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- business 2 administrator
select pg_temp.expect((select count(*) = 6 from public.ticket_categories), 'another business has its own categories');

-- Product categories
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect(exists (select 1 from public.product_categories where name = 'Commercial CT'), 'categories in use are on the list');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into ref select 'p13prod', public.create_product('P13-CT', 'Another CT', 100, 0, p_category => '  commercial ct ');
select pg_temp.expect((select category = 'Commercial CT' from public.products where id = (select id from ref where k = 'p13prod')), 'a category typed differently is matched to the list');
insert into ref select 'p13new', public.create_product('P13-NEW', 'Cable gland', 12, 0, p_category => 'Glands & fittings');
select pg_temp.expect(exists (select 1 from public.product_categories where name = 'Glands & fittings'), 'a new category typed on a product joins the list');
update public.product_categories set name = 'Renamed by staff' where name = 'Commercial CT';
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect(exists (select 1 from public.product_categories where name = 'Commercial CT'), 'staff cannot rename categories');
update public.product_categories set name = 'Commercial CTs' where name = 'Commercial CT';
select pg_temp.expect((select count(*) >= 2 and bool_and(category = 'Commercial CTs') from public.products where id in ((select id from ref where k = 'p13prod'), (select id from ref where k = 'prod'))), 'renaming a category renames it on its products');
update public.product_categories set is_active = false where name = 'Glands & fittings';
select pg_temp.expect_error_like($$update public.products set category = 'glands & fittings' where id = (select id from ref where k = 'p13prod')$$, 'product_category_inactive', 'a switched-off category cannot be given to a product');
select pg_temp.expect_error_like($$delete from public.product_categories where name = 'Glands & fittings'$$, 'category_in_use', 'a product category in use cannot be deleted');

-- Deactivation tells the managers what is still assigned
select pg_temp.as_owner();
set local session_replication_role = replica;
insert into auth.users (id, email) values ('a9100000-0000-0000-0000-000000000001', 'temp.tech@umbane.test');
insert into public.profiles (id, business_id, role, full_name, email) values ('a9100000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'staff', 'Temp Tech', 'temp.tech@umbane.test');
insert into public.staff_tasks (business_id, title, status, assigned_to) values ('11111111-0000-0000-0000-000000000001', 'Temp task', 'todo', 'a9100000-0000-0000-0000-000000000001');
insert into public.support_tickets (business_id, customer_id, reference, subject, category, status, assigned_to) values ('11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'P13-TEMP', 'Temp ticket', 'general', 'assigned', 'a9100000-0000-0000-0000-000000000001');
set local session_replication_role = origin;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
update public.profiles set is_active = false where id = 'a9100000-0000-0000-0000-000000000001';
select pg_temp.as_owner();
select pg_temp.expect((select count(*) = pg_temp.mgrs() - 1 and bool_and(body = 'Still assigned to them: 1 open ticket, 1 open task. Hand it on to someone else.' and link = '/team/a9100000-0000-0000-0000-000000000001') from public.notifications where title = 'Temp Tech was deactivated'), 'deactivating someone tells the other managers what work they still had');
select pg_temp.expect((select count(*) = 1 from pg_temp.audit_rows() where table_name = 'profiles' and record_id = 'a9100000-0000-0000-0000-000000000001' and details -> 'changes' -> 'is_active' = '[true, false]'), 'and the deactivation is in the audit log');

-- Erasing a customer's personal details
set local session_replication_role = replica;
insert into auth.users (id, email) values ('a9200000-0000-0000-0000-000000000001', 'erase.me@example.test');
insert into public.profiles (id, business_id, role, full_name, email) values ('a9200000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'client', 'Erase Me', 'erase.me@example.test');
insert into public.customers (id, business_id, profile_id, name, email, phone, id_number, street_address, city, notes) values
  ('e5000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000001', 'Erase Me', 'erase.me@example.test', '+27 82 000 0099', '9002025009088', '5 Erase Street', 'Durban', 'Prefers mornings'),
  ('e5000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', null, 'Still Owes', 'owes@example.test', null, null, null, null, null);
insert into public.invoices (id, business_id, customer_id, invoice_number, status, issue_date, due_date, total) values
  ('e5100000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'P13-PAID', 'paid', '2026-01-10', '2026-02-09', 500),
  ('e5100000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000002', 'P13-OWED', 'sent', '2026-01-10', '2026-02-09', 500);
insert into public.payments (business_id, invoice_id, amount, method) values ('11111111-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000001', 500, 'eft');
insert into public.support_tickets (id, business_id, customer_id, reference, subject, description, category, status, resolution) values
  ('e5200000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'P13-ERASE', 'Meter at home', 'My ID is 8001015009087, call me on 082 000 0099', 'general', 'closed', 'Called Erase Me back');
insert into public.ticket_messages (business_id, ticket_id, author_id, body) values ('11111111-0000-0000-0000-000000000001', 'e5200000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000001', 'I live at 5 Erase Street');
insert into public.communication_logs (business_id, customer_id, channel, direction, subject, body, status, recipient, message_type) values ('11111111-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'email', 'outbound', 'Invoice P13-PAID', 'Good day Erase Me', 'delivered', 'erase.me@example.test', 'email');
insert into public.audit_logs (business_id, action, table_name, record_id, details) values ('11111111-0000-0000-0000-000000000001', 'UPDATE', 'customers', 'e5000000-0000-0000-0000-000000000001', '{"changes": {"phone": [null, "+27 82 000 0099"]}}');
set local session_replication_role = origin;
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
select pg_temp.expect_error_like($$select public.erase_customer('e5000000-0000-0000-0000-000000000001', 'Asked by email')$$, 'permission denied', 'only an administrator can erase a customer');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect_error_like($$select public.erase_customer('e5000000-0000-0000-0000-000000000001', ' ')$$, 'erase_reason_required', 'the reason is recorded');
select pg_temp.expect_error_like($$select public.erase_customer('e5000000-0000-0000-0000-000000000002', 'Asked by email')$$, 'customer_has_balance', 'not while they owe money');
select pg_temp.expect_error_like($$select public.erase_customer('c1000000-0000-0000-0000-000000000002', 'Asked by email')$$, 'customer_has_open_tickets|customer_has_balance', 'nor while they have open tickets');
select public.erase_customer('e5000000-0000-0000-0000-000000000001', 'Asked by email on 26 Nov');
select pg_temp.as_owner();
select pg_temp.expect((select name = 'Erased customer E5000000' and email is null and phone is null and id_number is null and street_address is null and city is null and notes is null and profile_id is null and status = 'inactive' and email_opt_out and erased_at is not null and erased_by = 'a1000000-0000-0000-0000-000000000001' and erase_reason = 'Asked by email on 26 Nov' from public.customers where id = 'e5000000-0000-0000-0000-000000000001'), 'the customer''s name, contact and identity details are removed');
select pg_temp.expect((select count(*) = 1 from public.invoices where customer_id = 'e5000000-0000-0000-0000-000000000001') and (select count(*) = 1 from public.payments where invoice_id = 'e5100000-0000-0000-0000-000000000001'), 'their invoices and payments are kept for tax');
select pg_temp.expect((select description = '[erased]' and resolution = '[erased]' and status = 'closed' from public.support_tickets where id = 'e5200000-0000-0000-0000-000000000001') and (select bool_and(body = '[erased]') from public.ticket_messages where ticket_id = 'e5200000-0000-0000-0000-000000000001'), 'their ticket text is removed, closed tickets included');
select pg_temp.expect((select bool_and(subject = '[erased]' and body = '[erased]' and recipient = 'erased@erased.invalid') from public.communication_logs where customer_id = 'e5000000-0000-0000-0000-000000000001'), 'and their emails');
select pg_temp.expect((select not is_active and full_name = 'Erased customer E5000000' from public.profiles where id = 'a9200000-0000-0000-0000-000000000001'), 'their sign-in stops working');
select pg_temp.expect(not exists (select 1 from public.audit_logs where record_id in ('e5000000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000001') and action <> 'ERASE' and details::text ~ '(Erase Me|erase\.me@|0099|Erase Street|Prefers)'), 'no audit entry still holds their details, including those the erasure itself made');
select pg_temp.expect((select bool_and(details = '{"erased": true}') from public.audit_logs where table_name = 'customers' and record_id = 'e5000000-0000-0000-0000-000000000001' and action <> 'ERASE') and (select count(*) = 1 and bool_and(actor_id = 'a1000000-0000-0000-0000-000000000001' and details ->> 'reason' = 'Asked by email on 26 Nov') from public.audit_logs where action = 'ERASE'), 'old log entries are cleared, and the erasure itself is logged with its reason');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect_error_like($$update public.customers set name = 'Erase Me', email = 'erase.me@example.test' where id = 'e5000000-0000-0000-0000-000000000001'$$, 'customer_erased', 'an erased customer''s details cannot be typed back in');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect_error_like($$select public.erase_customer('e5000000-0000-0000-0000-000000000001', 'Again')$$, 'customer_already_erased', 'a customer is erased once');

-- Retention
select pg_temp.as_owner();
insert into public.notifications (business_id, user_id, title, is_read, created_at) values
  ('11111111-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P13 old read', true, now() - interval '400 days'),
  ('11111111-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P13 old unread', false, now() - interval '400 days'),
  ('11111111-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P13 ancient', false, now() - interval '800 days'),
  ('11111111-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P13 recent read', true, now() - interval '10 days');
insert into public.automation_runs (business_id, automation_key, trigger, started_at) values ('11111111-0000-0000-0000-000000000001', 'overdue_invoices', 'schedule', now() - interval '800 days');
insert into public.access_requests (business_id, full_name, email, status, created_at) values
  ('11111111-0000-0000-0000-000000000001', 'Old Applicant', 'old.applicant@example.test', 'declined', now() - interval '400 days'),
  ('11111111-0000-0000-0000-000000000001', 'Waiting Applicant', 'waiting@example.test', 'pending', now() - interval '400 days');
insert into public.audit_logs (business_id, action, table_name, created_at) values ('11111111-0000-0000-0000-000000000001', 'UPDATE', 'customers', now() - interval '8 years');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect_error_like($$select public.apply_retention()$$, 'permission denied', 'only the server runs the clean-up');
select pg_temp.as_service();
select public.apply_retention();
select pg_temp.as_owner();
select pg_temp.expect((select array_agg(title order by title) = array['P13 old unread', 'P13 recent read'] from public.notifications where title like 'P13 %'), 'read notifications go after a year, all of them after two');
select pg_temp.expect(not exists (select 1 from public.automation_runs where started_at < now() - interval '730 days'), 'automation history goes after two years');
select pg_temp.expect(not exists (select 1 from public.access_requests where email = 'old.applicant@example.test') and exists (select 1 from public.access_requests where email = 'waiting@example.test'), 'answered account requests go after a year; waiting ones stay');
select pg_temp.expect(not exists (select 1 from public.audit_logs where table_name = 'access_requests' and details::text like '%old.applicant@%'), 'and the audit log keeps no copy of them');
delete from public.access_requests where email = 'waiting@example.test';  -- later sections count requests
select pg_temp.expect(not exists (select 1 from public.audit_logs where created_at < now() - interval '7 years'), 'audit entries go after seven years');
select pg_temp.expect((select count(*) = 1 and bool_and((details ->> 'notifications')::int = 2 and (details ->> 'access_requests')::int = 1 and (details ->> 'audit_logs')::int = 1) from public.audit_logs where action = 'RETENTION' and business_id = '11111111-0000-0000-0000-000000000001'), 'the clean-up is itself logged, with what it removed');

-- Rate limits (Phase 14) ------------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.expect(public.rate_limit_hit('p14:test', 2, 60) and public.rate_limit_hit('p14:test', 2, 60), 'calls within the limit are allowed');
select pg_temp.expect(not public.rate_limit_hit('p14:test', 2, 60), 'one more is refused');
select pg_temp.expect(public.rate_limit_hit('p14:other', 2, 60), 'each key has its own count');
select pg_temp.expect_error_like($$select public.rate_limit_hit('p14:bad', 0, 60)$$, 'rate_limit_invalid', 'a limit must be at least one');
select pg_temp.as_owner();
select pg_temp.expect((select hits = 3 from public.api_rate_limits where key = 'p14:test'), 'refused calls still count');
insert into public.api_rate_limits (key, window_start, hits) values ('p14:test', now() - interval '3 days', 9);
select pg_temp.as_service();
select public.rate_limit_hit('p14:test', 2, 60);
select pg_temp.as_owner();
select pg_temp.expect(not exists (select 1 from public.api_rate_limits where key = 'p14:test' and window_start < now() - interval '1 day'), 'old windows are cleared as it goes');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect_error_like($$select public.rate_limit_hit('p14:test', 100, 60)$$, 'permission denied', 'only the server uses the limiter');
select pg_temp.expect_error_like($$select * from public.api_rate_limits$$, 'permission denied', 'nor reads its counts');
-- The public account form: at most 30 requests an hour
select pg_temp.as_service();
select count(*) from (select public.rate_limit_hit('request_access:' || (select id from public.businesses order by created_at, id limit 1), 30, 3600) from generate_series(1, 30)) x;
select pg_temp.as_owner();
select pg_temp.expect_error_like($$set local role anon; select public.request_access('Flood Test', 'flood@example.test')$$, 'rate_limited', 'after 30 account requests in an hour, visitors are asked to try later');
reset role;
select pg_temp.expect(not exists (select 1 from public.access_requests where email = 'flood@example.test'), 'and nothing is stored');
delete from public.api_rate_limits where key like 'request_access:%' or key like 'p14:%';  -- later sections use the form

-- Integrations, sharing and invitations -----------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.as_owner();  -- the owner, with no one signed in
insert into public.integrations (id, business_id, provider, account_label, account_id, capabilities, connected_at, is_default) values
  ('f1700000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'twilio', '+27870000001', 'AC00000000000000000000000000000001', '{direct_message,document_links,delivery_tracking}', now(), true),
  ('f1700000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'facebook', 'Umbane Energy', '1234567', '{publish_social}', now(), true),
  ('f1700000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'whatsapp', 'Other Business', '999', '{direct_message}', now(), true),
  ('f1700000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'whatsapp', 'Umbane WhatsApp', '888', '{direct_message,attachments,receive_messages}', now(), true);
insert into public.integration_secrets (integration_id, business_id, ciphertext) values ('f1700000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'v1.not-a-real-ciphertext');
insert into public.customers (id, business_id, name, email, phone, whatsapp_opt_in) values
  ('f1710000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Sindi Sms', 'sindi@example.test', '082 555 0101', false),
  ('f1710000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Wanda Whatsapp', null, '+27 83 555 0102', true),
  ('f1710000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'No Phone', 'nophone@example.test', null, false);
insert into public.leads (id, business_id, name, email, phone) values ('f1720000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lindo Lead', 'lindo@example.test', '0725550103');
insert into storage.objects (bucket_id, name, metadata) values ('message-attachments', '11111111-0000-0000-0000-000000000001/p17/INV-1.pdf', '{"size": 10, "mimetype": "application/pdf"}');
select pg_temp.expect(public.e164_phone('082 555 0101') = '+27825550101' and public.e164_phone('27825550101') = '+27825550101' and public.e164_phone('+44 20 7946 0958') = '+442079460958' and public.e164_phone('12345') is null, 'phone numbers are read the way South Africans type them');

-- Who sees connections and credentials
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) from public.integrations) = 3, 'staff see their business''s connections, to choose where to share');
select pg_temp.expect((select channel from public.integrations where provider = 'twilio') = 'sms', 'each connection knows its channel');
select pg_temp.expect_error_like($$select * from public.integration_secrets$$, 'permission denied', 'nobody signed in can read credentials');
select pg_temp.expect_error_like($$select * from public.integration_oauth_states$$, 'permission denied', 'nor sign-in states');
select pg_temp.expect_error_like($$select * from public.document_links$$, 'permission denied', 'nor document links');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, capabilities) values ('11111111-0000-0000-0000-000000000001', 'resend', '{send_email}')$$, 'permission denied', 'not even an administrator can mark a provider connected: only the server, after the provider confirms it');
select pg_temp.expect_error_like($$update public.integrations set capabilities = '{direct_message,attachments}' where provider = 'twilio'$$, 'permission denied', 'nor add capabilities the provider did not confirm');
select pg_temp.expect_error_like($$select * from public.integration_secrets$$, 'permission denied', 'administrators cannot read credentials either');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect((select count(*) from public.integrations) = 0, 'clients see no connections');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- other business
select pg_temp.expect((select count(*) from public.integrations) = 1, 'another business sees only its own');
select pg_temp.as_service();
select pg_temp.as_owner();
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, capabilities) values ('11111111-0000-0000-0000-000000000001', 'twilio', '{publish_social}')$$, 'integrations_capabilities_check|duplicate key', 'one live connection per provider');
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, capabilities) values ('11111111-0000-0000-0000-000000000001', 'resend', '{teleport}')$$, 'integrations_capabilities_check', 'only known capabilities');

-- Sending: recipients on file, consent per channel
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
create temp table p17 (k text primary key, id uuid);
grant all on p17 to authenticated, service_role;
insert into p17 select 'sms', public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Your meter is booked for Tuesday.', p_idempotency_key => 'p17-sms-0001');
select pg_temp.expect((select recipient = '+27825550101' and integration_id = 'f1700000-0000-0000-0000-000000000001' and provider = 'twilio' and sender = '+27870000001' and message_type = 'direct_message' and recipient_name = 'Sindi Sms' and status = 'queued' from public.communication_logs where id = (select id from p17 where k = 'sms')), 'an SMS goes to the customer''s number on file, through the business''s SMS connection');
select pg_temp.expect(public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Your meter is booked for Tuesday.', p_idempotency_key => 'p17-sms-0001') = (select id from p17 where k = 'sms'), 'sending the same thing twice (a double click, a retry) queues it once');
select pg_temp.expect((select count(*) from public.communication_logs where idempotency_key = 'p17-sms-0001') = 1, 'and there is still one message');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000003', p_body => 'Hi')$$, 'message_no_phone', 'no phone number on file, no SMS');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Winter special!', p_purpose => 'marketing')$$, 'message_no_consent', 'marketing by SMS needs marketing consent');
select pg_temp.expect_error_like($$select public.queue_message('whatsapp', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Hi')$$, 'message_no_whatsapp_consent', 'WhatsApp needs the customer to have agreed to WhatsApp');
insert into p17 select 'q1', public.queue_message('whatsapp', p_customer_id => 'f1710000-0000-0000-0000-000000000002', p_body => 'Your invoice is ready.');
select pg_temp.expect((select recipient = '+27835550102' from public.communication_logs where id = (select id from p17 where k = 'q1')), 'and goes through once they have');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_lead_id => 'f1720000-0000-0000-0000-000000000001', p_body => 'Hi')$$, 'message_one_recipient', 'one recipient per message');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_address => '083 123 4567', p_body => 'Hi')$$, 'message_address_manager', 'staff cannot send to a typed number');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => repeat('x', 1501))$$, 'message_too_long', 'an SMS has a length limit');
select pg_temp.expect_error_like($$select public.queue_message('whatsapp', p_integration_id => 'f1700000-0000-0000-0000-000000000003', p_customer_id => 'f1710000-0000-0000-0000-000000000002', p_body => 'Hi')$$, 'integration_not_connected', 'another business''s connection cannot be used');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_invoice_id => 'a0100000-0000-0000-0000-000000000001', p_body => 'Hi')$$, 'message_link_mismatch', 'an invoice goes only to its own customer');
insert into p17 select 'q2', public.queue_message('email', p_lead_id => 'f1720000-0000-0000-0000-000000000001', p_subject => 'Your quote', p_body => 'Here is the quote you asked for.');
select pg_temp.expect((select recipient = 'lindo@example.test' and lead_id = 'f1720000-0000-0000-0000-000000000001' and integration_id is null from public.communication_logs where id = (select id from p17 where k = 'q2')), 'a lead can be answered at their own address (email without a connection uses the built-in sender)');
select pg_temp.expect_error_like($$select public.queue_message('email', p_lead_id => 'f1720000-0000-0000-0000-000000000001', p_subject => 'Deals', p_body => 'Winter deals', p_purpose => 'marketing')$$, 'message_no_consent', 'but not sent marketing');
insert into p17 select 'q3', public.queue_message('email', p_profile_id => 'a2000000-0000-0000-0000-000000000001', p_subject => 'Sales report', p_body => 'This month''s sales.', p_report_key => 'sales');
select pg_temp.expect((select recipient = 'manager1@umbane.test' and recipient_profile_id = 'a2000000-0000-0000-0000-000000000001' and report_key = 'sales' from public.communication_logs where id = (select id from p17 where k = 'q3')), 'a report can go to a team member');
insert into p17 select 'doc', public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Your invoice:', p_attachment_path => '11111111-0000-0000-0000-000000000001/p17/INV-1.pdf', p_attachment_name => 'INV-1.pdf');
select pg_temp.expect((select message_type = 'document_share' and document_link_id is not null from public.communication_logs where id = (select id from p17 where k = 'doc')), 'an SMS cannot carry a file, so the document goes as a private link');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'x', p_attachment_path => '11111111-0000-0000-0000-000000000002/p17/other.pdf')$$, 'attachment_not_uploaded', 'only this business''s uploaded files');
select pg_temp.expect_error_like($$select public.queue_message('facebook', p_body => 'Winter special')$$, 'message_social_manager', 'staff cannot publish public posts');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
insert into p17 select 'q4', public.queue_message('sms', p_address => '083 123 4567', p_body => 'Your report is ready.');
select pg_temp.expect((select recipient = '+27831234567' from public.communication_logs where id = (select id from p17 where k = 'q4')), 'a manager can send a service message to a typed number');
select pg_temp.expect_error_like($$select public.queue_message('sms', p_address => '083 123 4567', p_body => 'Deals', p_purpose => 'marketing')$$, 'message_no_consent', 'but never marketing');
insert into p17 select 'post', public.queue_message('facebook', p_body => 'We now install smart meters in Pretoria.', p_link_url => 'https://umbane.example.com/smart-meters');
select pg_temp.expect((select message_type = 'social_post' and recipient is null and purpose = 'marketing' and sender = 'Umbane Energy' from public.communication_logs where id = (select id from p17 where k = 'post')), 'a manager can publish a post to the business''s Facebook Page');
select pg_temp.expect_error_like($$select public.queue_message('facebook', p_body => 'Look', p_invoice_id => 'a0100000-0000-0000-0000-000000000001')$$, 'message_social_private', 'a public post never carries an invoice');
select pg_temp.expect_error_like($$select public.queue_message('facebook', p_body => 'Look', p_customer_id => 'f1710000-0000-0000-0000-000000000001')$$, 'message_social_private', 'or a customer');
select pg_temp.expect_error_like($$select public.queue_message('facebook', p_body => 'Look', p_attachment_path => '11111111-0000-0000-0000-000000000001/p17/INV-1.pdf')$$, 'message_social_private', 'or a private document');
select pg_temp.expect_error_like($$select public.queue_message('instagram', p_body => 'Look', p_image_url => 'https://umbane.example.com/a.jpg')$$, 'integration_not_connected', 'a platform that is not connected cannot be used');
select pg_temp.expect_error_like($$select public.queue_message('whatsapp', p_integration_id => 'f1700000-0000-0000-0000-000000000002', p_customer_id => 'f1710000-0000-0000-0000-000000000002', p_body => 'Hi')$$, 'integration_not_connected', 'a connection is only used for its own channel');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect_error_like($$select public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Hi')$$, 'permission denied', 'clients cannot send');

-- The server sends, records and follows delivery
select pg_temp.as_service();
select pg_temp.expect((select id from p17 where k = 'sms') in (select public.due_messages(50)), 'SMS waiting to go out are on the server''s list');
select pg_temp.expect((select status = 'sending' and attempts = 1 from public.claim_message((select id from p17 where k = 'sms'))), 'the server claims an SMS like an email');
select public.record_message_result((select id from p17 where k = 'sms'), true, 'twilio:SM0001', null, false, p_provider => 'twilio', p_response => '{"status": "queued"}');
select pg_temp.expect((select status = 'sent' and provider_message_id = 'twilio:SM0001' and provider_response ->> 'status' = 'queued' from public.communication_logs where id = (select id from p17 where k = 'sms')), 'the result and the provider''s answer are recorded');
select pg_temp.expect(public.record_provider_event('twilio:SM0001', 'message.delivered', 'twilio:SM0001:delivered', '{}', now()), 'a delivery report is recorded');
select pg_temp.expect((select status = 'delivered' and delivered_at is not null from public.communication_logs where id = (select id from p17 where k = 'sms')), 'and marks it delivered');
select public.record_provider_event('twilio:SM0001', 'message.failed', 'twilio:SM0001:failed', '{"error": "late"}', now());
select pg_temp.expect((select status = 'delivered' from public.communication_logs where id = (select id from p17 where k = 'sms')), 'a late failure report does not undo a delivery');
select public.claim_message((select id from p17 where k = 'post'));
select public.record_message_result((select id from p17 where k = 'post'), true, 'facebook:1234567_890', null, false, p_provider => 'facebook', p_external_url => 'https://www.facebook.com/1234567_890');
select pg_temp.expect((select status = 'sent' and external_url = 'https://www.facebook.com/1234567_890' from public.communication_logs where id = (select id from p17 where k = 'post')), 'a published post keeps where it can be seen');
select public.claim_message((select id from p17 where k = 'doc'));
select public.record_message_result((select id from p17 where k = 'doc'), false, null, 'Twilio 400 21211: invalid number', false, p_provider => 'twilio');
select pg_temp.expect((select status = 'failed' and next_attempt_at is null from public.communication_logs where id = (select id from p17 where k = 'doc')), 'a refused message waits for a person');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select public.retry_message((select id from p17 where k = 'doc'));
select pg_temp.expect((select status = 'queued' and recipient = '+27825550101' from public.communication_logs where id = (select id from p17 where k = 'doc')), 'staff can try a failed SMS again, to the current number');
select public.cancel_message((select id from p17 where k = 'doc'));
select pg_temp.as_service();
select pg_temp.expect((select l.revoked_at is not null from public.communication_logs m join public.document_links l on l.id = m.document_link_id where m.id = (select id from p17 where k = 'doc')), 'cancelling a document message switches its link off');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
insert into p17 select 'optout', public.queue_message('sms', p_customer_id => 'f1710000-0000-0000-0000-000000000001', p_body => 'Reminder');
update public.customers set sms_opt_out = true where id = 'f1710000-0000-0000-0000-000000000001';
select pg_temp.expect((select consent_updated_by = 'a3000000-0000-0000-0000-000000000001' from public.customers where id = 'f1710000-0000-0000-0000-000000000001'), 'an SMS opt-out records who changed it');
select pg_temp.as_service();
select pg_temp.expect(not exists (select 1 from public.claim_message((select id from p17 where k = 'optout'))), 'an SMS to someone who opted out since it was queued is not handed over');
select pg_temp.expect((select status = 'cancelled' and error like '%message_opted_out%' from public.communication_logs where id = (select id from p17 where k = 'optout')), 'it is cancelled with the reason');
-- Replies on WhatsApp
select pg_temp.expect(public.log_inbound_message('f1700000-0000-0000-0000-000000000004', '27835550102', 'Thanks, received!', 'whatsapp:wamid.IN1', now()) is not null, 'a reply on WhatsApp is recorded');
select pg_temp.expect((select customer_id = 'f1710000-0000-0000-0000-000000000002' and direction = 'inbound' and channel = 'whatsapp' from public.communication_logs where provider_message_id = 'whatsapp:wamid.IN1'), 'against the customer with that number');
select pg_temp.expect(public.log_inbound_message('f1700000-0000-0000-0000-000000000004', '27835550102', 'Thanks, received!', 'whatsapp:wamid.IN1', now()) is null, 'the same reply twice is recorded once');
select public.log_inbound_message('f1700000-0000-0000-0000-000000000004', '+27 99 111 2222', 'Who is this?', 'whatsapp:wamid.IN2', now());
select pg_temp.expect((select customer_id is null and sender = '+27991112222' from public.communication_logs where provider_message_id = 'whatsapp:wamid.IN2'), 'a reply from an unknown number is kept without a customer');
select pg_temp.expect((select count(*) from public.notifications where dedupe_key = 'inbound:whatsapp:wamid.IN1') = pg_temp.mgrs(), 'managers are told about a customer''s reply');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select message_type = 'direct_message' and provider = 'twilio' and recipient_name = 'Sindi Sms' from public.message_list where id = (select id from p17 where k = 'sms')), 'the history shows every channel with its provider and recipient');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from pg_temp.audit_rows() where table_name = 'integrations' and action = 'INSERT') >= 3, 'connections are in the audit log');

-- Invitations by email
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select public.invite_staff('p17.new@example.test', 'Nomvula New', 'staff');
select pg_temp.expect((select state = 'pending' and expires_at > now() + interval '6 days' from public.staff_invitation_list where email = 'p17.new@example.test'), 'a new invitation is pending and lasts a week');
select pg_temp.as_service();
update public.staff_invitations set delivery_status = 'sent', sent_at = now(), send_count = 1, sent_via = 'Gmail (accounts@umbane.test)' where email = 'p17.new@example.test';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select state = 'sent' from public.staff_invitation_list where email = 'p17.new@example.test'), 'once the server sends it, it shows as sent');
select pg_temp.as_service();
update public.staff_invitations set delivery_status = 'failed', last_error = 'Gmail 401' where email = 'p17.new@example.test';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select state = 'failed' from public.staff_invitation_list where email = 'p17.new@example.test'), 'a delivery failure shows as failed');
update public.staff_invitations set status = 'cancelled', delivery_status = 'sent' where email = 'p17.new@example.test' and status = 'pending';
select pg_temp.expect((select state = 'cancelled' and cancelled_at is not null from public.staff_invitation_list where email = 'p17.new@example.test'), 'an administrator can cancel it');
select pg_temp.as_service();
select pg_temp.expect((select delivery_status = 'failed' from public.staff_invitations where email = 'p17.new@example.test'), 'but cannot rewrite how it was delivered');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select public.invite_staff('p17.late@example.test', 'Lerato Late', 'staff');
select pg_temp.as_service();
update public.staff_invitations set expires_at = now() - interval '1 day' where email = 'p17.late@example.test';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select state = 'expired' from public.staff_invitation_list where email = 'p17.late@example.test'), 'an invitation past its date shows as expired');
select pg_temp.as_service();
select pg_temp.as_owner();
insert into auth.users (id, email, email_confirmed_at) values ('f1730000-0000-0000-0000-000000000001', 'p17.late@example.test', now());
select pg_temp.expect(not exists (select 1 from public.profiles where id = 'f1730000-0000-0000-0000-000000000001'), 'an expired invitation does not let anyone join');
delete from auth.users where id = 'f1730000-0000-0000-0000-000000000001';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect_error_like($$select public.invite_staff('staff1@umbane.test', 'Sam Again', 'manager')$$, 'staff_email_taken', 'someone already on a team is never invited again');
select public.invite_staff('p17.again@example.test', 'Ayo Again', 'staff');
select pg_temp.as_service();
update public.staff_invitations set expires_at = now() - interval '1 day' where email = 'p17.again@example.test';
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((public.invite_staff('p17.again@example.test', 'Ayo Again', 'manager') ->> 'status') = 'invited', 'an expired invitation can be replaced by a new one');
select pg_temp.expect((select count(*) = 2 and count(*) filter (where state = 'expired') = 1 from public.staff_invitation_list where email = 'p17.again@example.test'), 'the old one stays in the list as expired');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.staff_invitation_list) = 0, 'staff cannot see invitations');
select pg_temp.as_service();
insert into public.communication_logs (business_id, channel, direction, message_type, subject, body, status, recipient, invitation_id) select '11111111-0000-0000-0000-000000000001', 'email', 'outbound', 'email', 'You are invited', 'Accept: [invitation link]', 'sent', email, id from public.staff_invitations where email = 'p17.new@example.test';
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.communication_logs where invitation_id is not null) = 0, 'staff do not see invitation emails in the history');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.communication_logs where invitation_id is not null) = 1, 'administrators do');

-- Clean up for the sections after this one
select pg_temp.as_service();
select pg_temp.as_owner();
delete from public.notifications where dedupe_key like 'inbound:%';
delete from public.communication_logs where invitation_id is not null;
delete from public.staff_invitations where email like 'p17.%';
delete from public.communication_logs where customer_id in (select id from public.customers where id::text like 'f171%') or lead_id = 'f1720000-0000-0000-0000-000000000001' or integration_id::text like 'f170%' or report_key = 'sales' or recipient = '+27831234567';
delete from public.integrations where id::text like 'f170%';
delete from public.customers where id::text like 'f171%';
delete from public.leads where id = 'f1720000-0000-0000-0000-000000000001';

-- Search, calendar and personal connections --------------------------------------------------------------
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
create temp table p18 (k text primary key, id uuid);
grant all on p18 to authenticated, service_role;
select pg_temp.expect((select count(*) from public.search_everything('thabo') where kind = 'customer' and title = 'Thabo Mokoena') = 1, 'search finds a customer by name');
select pg_temp.expect(exists (select 1 from public.search_everything('karoo') where kind = 'property' and link = '/properties/d1000000-0000-0000-0000-000000000002'), 'and a property, with a link to it');
select pg_temp.expect(exists (select 1 from public.search_everything('MTR-0001') where kind = 'meter'), 'and a meter by serial number');
select pg_temp.expect(exists (select 1 from public.search_everything('INV-0001') where kind = 'invoice'), 'and an invoice by number');
select pg_temp.expect(exists (select 1 from public.search_everything('display is blank') where kind = 'ticket'), 'and a ticket by subject');
select pg_temp.expect(exists (select 1 from public.search_everything('mtr-prepaid') where kind = 'product'), 'and a product by SKU, whatever the case');
-- The audit checks above changed Thabo's number to +27 82 000 0222.
select pg_temp.expect(exists (select 1 from public.search_everything('082 000 0222') where kind = 'customer' and title = 'Thabo Mokoena'), 'a phone number typed the local way finds the customer');
select pg_temp.expect(exists (select 1 from public.search_everything('+27820000222') where kind = 'customer' and title = 'Thabo Mokoena'), 'and typed the international way');
select pg_temp.expect(not exists (select 1 from public.search_everything('082 000 0002') where kind = 'customer' and title = 'Thabo Mokoena'), 'but not by the number they had before');
select pg_temp.expect(not exists (select 1 from public.search_everything('Other Business')), 'another business''s records are never found');
select pg_temp.expect(not exists (select 1 from public.search_everything('t')), 'one character finds nothing');
select pg_temp.expect(not exists (select 1 from public.search_everything('%%')), 'wildcards are matched literally');
select pg_temp.expect(coalesce((select max(n) from (select count(*) n from public.search_everything('a') group by kind) x), 0) <= 5, 'at most five of each kind');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect(not exists (select 1 from public.search_everything('thabo')), 'a client cannot find other customers');
select pg_temp.expect(exists (select 1 from public.search_everything('sunrise') where kind = 'property'), 'but finds their own property');
select pg_temp.expect(not exists (select 1 from public.search_everything('INV-0003')), 'and not another customer''s invoice');

-- Calendar events
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
insert into public.calendar_events (title, kind, starts_at, ends_at, property_id) values ('Site visit: Karoo Office', 'site_visit', '2026-12-03 09:00+02', '2026-12-03 10:30+02', 'd1000000-0000-0000-0000-000000000002');
insert into p18 select 'visit', id from public.calendar_events where title = 'Site visit: Karoo Office';
select pg_temp.expect((select owner_id = 'a3000000-0000-0000-0000-000000000001' and assigned_to = 'a3000000-0000-0000-0000-000000000001' and customer_id = 'c1000000-0000-0000-0000-000000000002' from public.calendar_events where id = (select id from p18 where k = 'visit')), 'an event belongs to whoever made it, and a property brings its customer');
select pg_temp.expect_error_like($$insert into public.calendar_events (title, starts_at, ends_at, customer_id, property_id) values ('Mixed up', '2026-12-03 09:00+02', '2026-12-03 10:00+02', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')$$, 'calendar_link_mismatch', 'a property of another customer is refused');
select pg_temp.expect_error_like($$insert into public.calendar_events (title, starts_at, ends_at) values ('Backwards', '2026-12-03 10:00+02', '2026-12-03 09:00+02')$$, 'calendar_events_ends_after_start', 'an event cannot end before it starts');
select pg_temp.expect_error_like($$insert into public.calendar_events (title, starts_at, ends_at, assigned_to) values ('For a client', '2026-12-03 09:00+02', '2026-12-03 10:00+02', 'a4000000-0000-0000-0000-000000000001')$$, 'calendar_assignee_invalid', 'events are for team members only');
insert into public.calendar_events (title, kind, starts_at, ends_at, all_day) values ('Stocktake', 'reminder', '2026-12-05 14:00+02', '2026-12-05 15:00+02', true);
insert into p18 select 'allday', id from public.calendar_events where title = 'Stocktake';
select pg_temp.expect((select starts_at = '2026-12-05 00:00+02' and ends_at = '2026-12-06 00:00+02' from public.calendar_events where id = (select id from p18 where k = 'allday')), 'an all-day event covers the whole South African day');
update public.calendar_events set ends_at = '2026-12-06 15:00+02' where id = (select id from p18 where k = 'allday');
select pg_temp.expect((select ends_at = '2026-12-07 00:00+02' from public.calendar_events where id = (select id from p18 where k = 'allday')), 'and every day it touches, up to the midnight after');
update public.calendar_events set ends_at = '2026-12-08 00:00+02' where id = (select id from p18 where k = 'allday');
select pg_temp.expect((select ends_at = '2026-12-08 00:00+02' from public.calendar_events where id = (select id from p18 where k = 'allday')), 'an end already at midnight stays where it is');
update public.calendar_events set google_event_id = 'forged', google_calendar_owner = 'a3000000-0000-0000-0000-000000000001' where id = (select id from p18 where k = 'visit');
select pg_temp.expect((select google_event_id is null and google_calendar_owner is null from public.calendar_events where id = (select id from p18 where k = 'visit')), 'only the server records the Google copy');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- manager
insert into public.calendar_events (title, starts_at, ends_at) values ('Management meeting', '2026-12-04 08:00+02', '2026-12-04 09:00+02');
insert into p18 select 'mgr', id from public.calendar_events where title = 'Management meeting';
update public.calendar_events set title = 'Site visit: Karoo Office (moved)' where id = (select id from p18 where k = 'visit');
select pg_temp.expect((select title like '%(moved)' from public.calendar_events where id = (select id from p18 where k = 'visit')), 'a manager can change anyone''s event');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
update public.calendar_events set title = 'Hijacked' where id = (select id from p18 where k = 'mgr');
delete from public.calendar_events where id = (select id from p18 where k = 'mgr');
select pg_temp.expect((select title = 'Management meeting' from public.calendar_events where id = (select id from p18 where k = 'mgr')), 'staff cannot change or delete an event that is not theirs');
select pg_temp.as_service();
update public.calendar_events set google_event_id = 'umb123', google_calendar_owner = 'a3000000-0000-0000-0000-000000000001', google_synced_at = now() where id = (select id from p18 where k = 'visit');
select pg_temp.expect((select google_event_id = 'umb123' from public.calendar_events where id = (select id from p18 where k = 'visit')), 'the server records the Google copy');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect((select count(*) from public.calendar_events) = 0, 'clients see no calendar');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- other business
select pg_temp.expect((select count(*) from public.calendar_events) = 0, 'another business sees none of these events');

-- The calendar feed
select pg_temp.as_service();
select pg_temp.as_owner();
insert into public.staff_tasks (id, business_id, title, due_date, assigned_to, created_by) values ('f1800000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Replace a meter battery', '2026-12-04', 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) from public.calendar_feed('2026-12-01 00:00+02', '2026-12-08 00:00+02') where source = 'event') = 3, 'the feed has the events in the period');
select pg_temp.expect(exists (select 1 from public.calendar_feed('2026-12-01 00:00+02', '2026-12-08 00:00+02') where source = 'task' and all_day and link = '/tasks/f1800000-0000-0000-0000-000000000001'), 'and tasks on their due date');
select pg_temp.expect(not exists (select 1 from public.calendar_feed('2026-11-27 00:00+02', '2026-12-04 00:00+02') where source = 'task' and id = 'f1800000-0000-0000-0000-000000000001'), 'but not a task due the day after the period ends');
select pg_temp.expect(exists (select 1 from public.calendar_feed('2019-12-20 00:00+02', '2020-01-10 00:00+02') where source = 'invoice' and title = 'INV-0003 due'), 'and unpaid invoices on their due date');
select pg_temp.expect(not exists (select 1 from public.calendar_feed('2026-11-01 00:00+02', '2026-11-08 00:00+02') where source = 'event'), 'and nothing outside the period');
select pg_temp.expect_error_like($$select * from public.calendar_feed('2026-01-01', '2026-06-01')$$, 'calendar_range', 'at most about three months at a time');

-- Google Calendar: a personal connection
select pg_temp.as_service();
select pg_temp.as_owner();
insert into public.integrations (id, business_id, provider, profile_id, account_label, capabilities, connected_at) values
  ('f1810000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'google_calendar', 'a3000000-0000-0000-0000-000000000001', 'staff1@gmail.test', '{calendar_events}', now()),
  ('f1810000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'google_calendar', 'a2000000-0000-0000-0000-000000000001', 'manager1@gmail.test', '{calendar_events}', now());
select pg_temp.expect((select channel = 'calendar' from public.integrations where id = 'f1810000-0000-0000-0000-000000000001'), 'a calendar connection is on the calendar channel');
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, profile_id, capabilities) values ('11111111-0000-0000-0000-000000000001', 'google_calendar', 'a3000000-0000-0000-0000-000000000001', '{calendar_events}')$$, 'integrations_one_personal', 'one calendar connection per person');
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, capabilities) values ('11111111-0000-0000-0000-000000000001', 'google_calendar', '{calendar_events}')$$, 'integrations_personal_owner', 'a calendar connection always belongs to a person');
select pg_temp.expect_error_like($$insert into public.integrations (business_id, provider, profile_id, capabilities) values ('11111111-0000-0000-0000-000000000001', 'resend', 'a3000000-0000-0000-0000-000000000001', '{send_email}')$$, 'integrations_personal_owner', 'and business connections never do');
select pg_temp.expect_error_like($$update public.integrations set is_default = true where id = 'f1810000-0000-0000-0000-000000000001'$$, 'integrations_personal_not_default', 'a personal connection is never a business default');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- staff
select pg_temp.expect((select count(*) from public.integrations where provider = 'google_calendar') = 1, 'people see their own calendar connection, not their colleagues''');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- administrator
select pg_temp.expect((select count(*) from public.integrations where provider = 'google_calendar') = 2, 'administrators see everyone''s, to help');

-- Clean up for the sections after this one
select pg_temp.as_service();
select pg_temp.as_owner();
delete from public.calendar_events where id in (select id from p18);
delete from public.staff_tasks where id = 'f1800000-0000-0000-0000-000000000001';
delete from public.integrations where id::text like 'f181%';

-- Manager ---------------------------------------------------------------------------------------
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
delete from public.customers where name = 'Staff-created customer';
select pg_temp.expect((select count(*) from public.customers where name = 'Staff-created customer') = 0, 'manager can delete');
select pg_temp.expect((select count(*) from public.audit_logs) = 0, 'managers cannot read the audit log (administrators only)');
select pg_temp.expect((select count(*) from pg_temp.audit_rows() where table_name = 'properties' and action = 'INSERT') >= 2, 'property changes are in the audit trail');
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

-- Access requests (public "Create account" button) ------------------------------------------
select pg_temp.as_owner();
set local role anon;
select public.request_access('  Lerato Khumalo ', 'Lerato@Example.co.za ', '+27821234567', 'Please add me');
select public.request_access('Lerato Again', 'lerato@example.co.za');
reset role;
select pg_temp.expect((select count(*) from public.access_requests where email = 'lerato@example.co.za') = 1, 'anonymous request is stored once; a repeat for the same email is ignored');
select pg_temp.expect((select full_name from public.access_requests where email = 'lerato@example.co.za') = 'Lerato Khumalo', 'request input is trimmed and the email lower-cased');
select pg_temp.expect((select business_id from public.access_requests where email = 'lerato@example.co.za') = '11111111-0000-0000-0000-000000000001', 'request goes to the first business');
select pg_temp.expect_error($$set local role anon; select public.request_access('X', 'not-an-email')$$, 'invalid email is rejected');
select pg_temp.expect_error($$set local role anon; select public.request_access('Valid Name', 'ok@example.co.za', '0821234567')$$, 'phone must be +27 format');
select pg_temp.expect_error($$set local role anon; select * from public.access_requests$$, 'anonymous cannot read requests');
select pg_temp.expect_error($$set local role anon; insert into public.access_requests (business_id, full_name, email) values ('11111111-0000-0000-0000-000000000001', 'Direct Insert', 'direct@example.co.za')$$, 'anonymous cannot insert directly');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- client
select pg_temp.expect((select count(*) from public.access_requests) = 0, 'clients cannot see access requests');
select pg_temp.as_user('b1000000-0000-0000-0000-000000000001');  -- admin of business 2
select pg_temp.expect((select count(*) from public.access_requests) = 0, 'another business cannot see the request');
-- The manager was deactivated above; reactivate them to test the manager path.
select pg_temp.as_owner();
update public.profiles set is_active = true where id = 'a2000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.access_requests) = 1, 'manager sees their business requests');
update public.access_requests set status = 'approved' where email = 'lerato@example.co.za';
select pg_temp.expect((select status from public.access_requests where email = 'lerato@example.co.za') = 'approved', 'manager can approve a request');
select pg_temp.expect_error($$insert into public.access_requests (business_id, full_name, email) values ('11111111-0000-0000-0000-000000000001', 'Manager Insert', 'm@example.co.za')$$, 'nobody can insert requests directly, even managers');

rollback;
