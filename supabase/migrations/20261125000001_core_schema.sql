-- Umbane CRM core schema (Phase 1a).
-- Every business table carries business_id. RLS is enabled in the next migration.

create type public.user_role as enum ('administrator', 'manager', 'staff', 'client');

-- Shared updated_at trigger ---------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Businesses and profiles -----------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete restrict,
  role public.user_role not null default 'client',
  full_name text not null default '',
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_business_idx on public.profiles (business_id);

-- Customers and properties ----------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  profile_id uuid unique references public.profiles (id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_business_idx on public.customers (business_id);
create unique index customers_business_email_uniq
  on public.customers (business_id, lower(email)) where email is not null;

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  name text,
  address text not null check (length(trim(address)) > 0),
  city text,
  property_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_business_idx on public.properties (business_id);
create index properties_customer_idx on public.properties (customer_id);

-- Electricity -----------------------------------------------------------------
create table public.electricity_meters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  property_id uuid not null references public.properties (id) on delete restrict,
  serial_number text not null check (length(trim(serial_number)) > 0),
  status text not null default 'active'
    check (status in ('active', 'maintenance', 'replaced', 'decommissioned')),
  installed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, serial_number)
);
create index meters_business_idx on public.electricity_meters (business_id);
create index meters_property_idx on public.electricity_meters (property_id);

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  meter_id uuid not null references public.electricity_meters (id) on delete restrict,
  reading_date date not null,
  reading_value numeric(14, 3) not null check (reading_value >= 0),
  is_estimate boolean not null default false,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (meter_id, reading_date)
);
create index readings_business_idx on public.meter_readings (business_id);
create index readings_meter_date_idx on public.meter_readings (meter_id, reading_date desc);

-- Leads, sales, products, orders ----------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  source text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'converted', 'lost')),
  assigned_to uuid references public.profiles (id) on delete set null,
  converted_customer_id uuid references public.customers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_business_idx on public.leads (business_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  sku text not null check (length(trim(sku)) > 0),
  name text not null check (length(trim(name)) > 0),
  description text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku)
);
create index products_business_idx on public.products (business_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'fulfilled', 'cancelled')),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_business_idx on public.orders (business_id);
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,
  lead_id uuid references public.leads (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  amount numeric(12, 2) not null check (amount >= 0),
  sold_by uuid references public.profiles (id) on delete set null,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index sales_business_idx on public.sales (business_id);

-- Invoices and payments -------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  order_id uuid references public.orders (id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, invoice_number)
);
create index invoices_business_idx on public.invoices (business_id);
create index invoices_customer_idx on public.invoices (customer_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);

-- Inventory -------------------------------------------------------------------
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  transaction_type text not null check (transaction_type in ('received', 'sold', 'adjusted', 'returned')),
  quantity integer not null check (quantity <> 0),
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index inventory_product_idx on public.inventory_transactions (product_id, created_at desc);

-- Support tickets -------------------------------------------------------------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  property_id uuid references public.properties (id) on delete set null,
  reference text not null,
  subject text not null check (length(trim(subject)) > 0),
  category text,
  description text,
  status text not null default 'open'
    check (status in ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, reference)
);
create index tickets_business_idx on public.support_tickets (business_id);
create index tickets_customer_idx on public.support_tickets (customer_id);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes integer check (size_bytes >= 0),
  created_at timestamptz not null default now()
);
create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);

-- Tasks, notifications, logs --------------------------------------------------
create table public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  ticket_id uuid references public.support_tickets (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_business_idx on public.staff_tasks (business_id);
create index tasks_assignee_idx on public.staff_tasks (assigned_to);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, is_read);

create table public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'call', 'note')),
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  subject text,
  body text,
  status text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index comm_logs_business_idx on public.communication_logs (business_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  table_name text,
  record_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_business_idx on public.audit_logs (business_id, created_at desc);

-- updated_at triggers ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'businesses', 'profiles', 'customers', 'properties', 'electricity_meters', 'leads',
    'products', 'orders', 'invoices', 'support_tickets', 'staff_tasks'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
