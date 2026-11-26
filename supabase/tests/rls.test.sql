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
select pg_temp.expect((select details ->> 'reading_value' from public.audit_logs where table_name = 'meter_readings' and action = 'DELETE') = '2785.250', 'a manager can remove a reading and the audit keeps its value');
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
select pg_temp.expect((select details ->> 'amount' = '130000.00' from public.audit_logs where table_name = 'payments' and action = 'DELETE'), 'the audit keeps a removed payment''s amount');
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
select pg_temp.expect_error_like($$insert into public.support_tickets (subject, description, category) values ('Odd', 'x', 'gossip')$$, 'tickets_category_check', 'unknown categories are refused');
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
select pg_temp.expect_error_like($$insert into public.notifications (business_id, user_id, title) values ('11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Fake')$$, 'row-level security', 'nobody writes notifications directly');
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
select pg_temp.expect((select count(*) = 3 from public.ticket_messages where ticket_id = (select id from ref where k = 'tk')) and exists (select 1 from public.audit_logs where table_name = 'ticket_messages' and action = 'DELETE'), 'a manager can remove a message, and it is in the audit log');

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
