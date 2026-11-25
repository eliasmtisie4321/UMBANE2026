-- DEVELOPMENT / PREVIEW SEED ONLY. Never run against production.
-- Creates two businesses and one test user per role. All test users share the password below,
-- which is acceptable only because this data never touches a production database.
-- Test logins: admin1@umbane.test, manager1@umbane.test, staff1@umbane.test, client1@umbane.test,
-- admin2@umbane.test (business 2). Password: Umbane-dev-1!

insert into public.businesses (id, name, email) values
  ('11111111-0000-0000-0000-000000000001', 'Umbane Energy (Demo)', 'info@demo.umbane.test'),
  ('11111111-0000-0000-0000-000000000002', 'Other Business (Demo)', 'info@other.umbane.test');

-- Auth users (local/preview only: GoTrue normally creates these) ------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Umbane-dev-1!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('a1000000-0000-0000-0000-000000000001'::uuid, 'admin1@umbane.test'),
  ('a2000000-0000-0000-0000-000000000001'::uuid, 'manager1@umbane.test'),
  ('a3000000-0000-0000-0000-000000000001'::uuid, 'staff1@umbane.test'),
  ('a4000000-0000-0000-0000-000000000001'::uuid, 'client1@umbane.test'),
  ('b1000000-0000-0000-0000-000000000001'::uuid, 'admin2@umbane.test')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from auth.users where email like '%@umbane.test';

insert into public.profiles (id, business_id, role, full_name, email) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'administrator', 'Ada Admin', 'admin1@umbane.test'),
  ('a2000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'manager', 'Mia Manager', 'manager1@umbane.test'),
  ('a3000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'staff', 'Sam Staff', 'staff1@umbane.test'),
  ('a4000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'client', 'Cleo Client', 'client1@umbane.test'),
  ('b1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'administrator', 'Olu Other-Admin', 'admin2@umbane.test');

-- Business 1 data -----------------------------------------------------------------------------
insert into public.customers (id, business_id, profile_id, name, email, phone) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'Cleo Client', 'client1@umbane.test', '+27 82 000 0001'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', null, 'Thabo Mokoena', 'thabo@example.test', '+27 82 000 0002');

insert into public.properties (id, business_id, customer_id, name, address, city) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Sunrise Apartments', '12 Long Street', 'Cape Town'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Karoo Office', '4 Main Road', 'Beaufort West');

insert into public.electricity_meters (id, business_id, property_id, serial_number, installed_on) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'MTR-0001', '2025-01-15'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'MTR-0002', '2025-03-01');

insert into public.meter_readings (business_id, meter_id, reading_date, reading_value) values
  ('11111111-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '2026-09-01', 1200.500),
  ('11111111-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '2026-10-01', 1385.250),
  ('11111111-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '2026-10-01', 640.000);

insert into public.leads (business_id, name, email, source, status, assigned_to) values
  ('11111111-0000-0000-0000-000000000001', 'Naledi Dlamini', 'naledi@example.test', 'website', 'new', 'a3000000-0000-0000-0000-000000000001');

insert into public.products (id, business_id, sku, name, unit_price, low_stock_threshold) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'MTR-PREPAID', 'Prepaid meter', 850.00, 5);

insert into public.invoices (id, business_id, customer_id, invoice_number, status, subtotal, tax, total, due_date) values
  ('a0100000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'INV-0001', 'partially_paid', 1000.00, 150.00, 1150.00, '2026-12-15'),
  ('a0100000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'INV-0002', 'draft', 500.00, 75.00, 575.00, '2026-12-31'),
  -- Overdue: unpaid and past its due date (belongs to the other customer, so client 1 never sees it).
  ('a0100000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'INV-0003', 'sent', 260.87, 39.13, 300.00, '2020-01-01');

-- Three part-payments on INV-0001 across three months: 300 + 400 + 200 = 900, balance 250.
insert into public.payments (business_id, invoice_id, amount, reference, paid_at, recorded_by) values
  ('11111111-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001', 300.00, 'EFT-1001', '2026-09-15 10:00:00+00', 'a3000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001', 400.00, 'EFT-1002', '2026-10-12 10:00:00+00', 'a3000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001', 200.00, 'EFT-1003', '2026-11-10 10:00:00+00', 'a3000000-0000-0000-0000-000000000001');

-- Stock: +20 received, -17 sold => 3 on hand, at or below the threshold of 5 (low stock).
insert into public.inventory_transactions (business_id, product_id, transaction_type, quantity, note, recorded_by) values
  ('11111111-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'received', 20, 'Initial stock', 'a3000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'sold', -17, 'Installations', 'a3000000-0000-0000-0000-000000000001');

insert into public.support_tickets (id, business_id, customer_id, reference, subject, status) values
  ('a0200000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'TKT-0001', 'Meter display is blank', 'open'),
  ('a0200000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'TKT-0002', 'Billing question', 'open');

insert into public.ticket_messages (business_id, ticket_id, author_id, body, is_internal) values
  ('11111111-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'The meter screen went dark yesterday.', false),
  ('11111111-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'Internal: check battery batch 7.', true);

-- Business 2 data (must stay invisible to business 1 users) ----------------------------------
insert into public.customers (id, business_id, name, email) values
  ('c2000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Other Business Customer', 'other@example.test');
