-- Customer and property fields from the Stitch designs (Phase 3).
-- Empty strings are stored as NULL by the application, so "optional" means NULL and unique indexes
-- only apply when a value is present.

-- Customers -------------------------------------------------------------------------------------
alter table public.customers
  add column customer_type text not null default 'individual'
    constraint customers_type_check check (customer_type in ('individual', 'business')),
  add column segment text
    constraint customers_segment_check check (segment in ('residential', 'commercial', 'industrial', 'municipal')),
  add column id_number text
    constraint customers_id_number_check check (id_number ~ '^[0-9]{13}$'),
  add column alt_phone text,
  add column company_name text,
  add column registration_number text,
  add column street_address text,
  add column suburb text,
  add column city text,
  add column province text
    constraint customers_province_check check (province in (
      'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
      'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape')),
  add column postal_code text
    constraint customers_postal_code_check check (postal_code ~ '^[0-9]{4}$');

-- The design adds a "Pending" status alongside Active and Inactive.
alter table public.customers drop constraint customers_status_check;
alter table public.customers add constraint customers_status_check
  check (status in ('active', 'pending', 'inactive'));

-- A business customer must name the company.
alter table public.customers add constraint customers_business_needs_company
  check (customer_type <> 'business' or length(trim(coalesce(company_name, ''))) > 0);

-- Duplicate protection, per business. (Email is already unique per business.)
create unique index customers_business_id_number_uniq
  on public.customers (business_id, id_number) where id_number is not null;
create unique index customers_business_registration_uniq
  on public.customers (business_id, lower(registration_number)) where registration_number is not null;

-- Properties ------------------------------------------------------------------------------------
alter table public.properties
  add column reference text,
  add column suburb text,
  add column province text
    constraint properties_province_check check (province in (
      'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
      'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape')),
  add column postal_code text
    constraint properties_postal_code_check check (postal_code ~ '^[0-9]{4}$'),
  add column units integer
    constraint properties_units_check check (units >= 1),
  add column status text not null default 'active'
    constraint properties_status_check check (status in ('active', 'maintenance', 'offline'));

alter table public.properties add constraint properties_type_check
  check (property_type in ('residential', 'commercial', 'industrial', 'mixed_use'));

-- A reference code, when given, is unique within the business.
create unique index properties_business_reference_uniq
  on public.properties (business_id, lower(reference)) where reference is not null;

-- The same customer cannot register the same address twice (separate units use separate addresses
-- or the units field). Different customers may share a building address.
create unique index properties_customer_address_uniq
  on public.properties (
    business_id, customer_id, lower(address), lower(coalesce(suburb, '')), lower(coalesce(city, '')));

-- Property changes belong in the audit trail alongside customers and invoices.
create trigger audit_row_change after insert or update or delete on public.properties
  for each row execute function public.audit_row_change();

-- The caller's business is filled in by the database, so the app never sends business_id and a
-- client cannot choose another business (the insert policy still checks it).
alter table public.customers alter column business_id set default public.current_business_id();
alter table public.properties alter column business_id set default public.current_business_id();
