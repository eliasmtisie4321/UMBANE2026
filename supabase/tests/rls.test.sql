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
