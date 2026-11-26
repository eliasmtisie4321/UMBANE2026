-- Invoices and payments (Phase 6). Needs migrations 0006 and 0007. Assumptions are in docs/INVOICES.md.
-- Totals, numbering, status and balances are decided here, not in the app.

-- Billing details on the business ---------------------------------------------------------------
alter table public.businesses
  add column registration_number text check (char_length(registration_number) <= 40),
  add column vat_registered boolean not null default true,
  add column vat_number text check (vat_number ~ '^4\d{9}$'),
  add column bank_name text check (char_length(bank_name) <= 80),
  add column bank_account_name text check (char_length(bank_account_name) <= 120),
  add column bank_account_number text check (bank_account_number ~ '^\d{6,16}$'),
  add column bank_branch_code text check (bank_branch_code ~ '^\d{6}$'),
  add column payment_instructions text check (char_length(payment_instructions) <= 500),
  add column invoice_footer text check (char_length(invoice_footer) <= 500),
  add column default_payment_terms text not null default 'net30'
    check (default_payment_terms in ('receipt', 'net7', 'net14', 'net30'));

-- Everyone signed in, clients included, needs the supplier's details to read and pay an invoice.
create function public.billing_profile()
returns table (
  name text, email text, phone text, address text, registration_number text, vat_registered boolean,
  vat_number text, bank_name text, bank_account_name text, bank_account_number text,
  bank_branch_code text, payment_instructions text, invoice_footer text, default_payment_terms text)
language sql stable security definer set search_path = public as $$
  select name, email, phone, address, registration_number, vat_registered, vat_number, bank_name,
    bank_account_name, bank_account_number, bank_branch_code, payment_instructions, invoice_footer,
    default_payment_terms
  from businesses where id = current_business_id()
$$;
revoke execute on function public.billing_profile() from public, anon;
grant execute on function public.billing_profile() to authenticated;

-- Invoices --------------------------------------------------------------------------------------
alter table public.invoices add constraint invoices_id_business_key unique (id, business_id);
alter table public.invoices alter column business_id set default public.current_business_id();
alter table public.payments alter column business_id set default public.current_business_id();

alter table public.invoices drop constraint invoices_customer_id_fkey;
alter table public.invoices add constraint invoices_customer_id_fkey
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete restrict;
alter table public.invoices drop constraint invoices_order_id_fkey;
alter table public.invoices add constraint invoices_order_id_fkey
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict;
alter table public.payments drop constraint payments_invoice_id_fkey;
alter table public.payments add constraint payments_invoice_id_fkey
  foreign key (invoice_id, business_id) references public.invoices (id, business_id) on delete restrict;

-- A draft has no number yet: numbers are given out when an invoice is issued, so there are no gaps.
alter table public.invoices
  alter column invoice_number drop not null,
  add column property_id uuid,
  add column issue_date date,
  add column payment_terms text not null default 'net30'
    check (payment_terms in ('receipt', 'net7', 'net14', 'net30')),
  add column discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  add column vat_rate numeric(5, 2) not null default 15 check (vat_rate in (0, 15)),
  add column discount numeric(12, 2) not null default 0 check (discount >= 0),
  add column notes text check (char_length(notes) <= 2000),
  add column cancel_reason text check (char_length(cancel_reason) <= 500),
  add column sent_at timestamptz,
  add column issued_by uuid references public.profiles (id) on delete set null,
  add column created_by uuid references public.profiles (id) on delete set null,
  add constraint invoices_property_fkey foreign key (property_id, business_id)
    references public.properties (id, business_id) on delete restrict;

-- "Overdue" depends on the date, so it is worked out when read (see invoice_list), not stored.
update public.invoices set status = 'sent' where status = 'overdue';
update public.invoices set cancel_reason = 'Not recorded' where status = 'cancelled';
update public.invoices set vat_rate = case when subtotal > 0 then least(round(tax / subtotal * 100), 15) else 15 end
  where status <> 'draft';
update public.invoices set vat_rate = 15 where vat_rate not in (0, 15);
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (
    status in ('draft', 'sent', 'partially_paid', 'paid', 'cancelled')),
  add constraint invoices_issued_has_number check (status = 'draft' or invoice_number is not null
    or status = 'cancelled'),
  add constraint invoices_due_after_issue check (due_date is null or issue_date is null or due_date >= issue_date),
  add constraint invoices_cancelled_has_reason check (
    status <> 'cancelled' or char_length(btrim(coalesce(cancel_reason, ''))) >= 3);
create index invoices_business_status_idx on public.invoices (business_id, status, due_date);
-- One live invoice per order.
create unique index invoices_order_uniq on public.invoices (order_id)
  where order_id is not null and status <> 'cancelled';

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete restrict,
  invoice_id uuid not null,
  position integer not null default 1,
  product_id uuid,
  description text not null check (char_length(btrim(description)) between 2 and 300),
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  unit_price numeric(12, 2) not null check (unit_price >= 0 and unit_price <= 9999999.99),
  created_at timestamptz not null default now(),
  constraint invoice_items_invoice_fkey foreign key (invoice_id, business_id)
    references public.invoices (id, business_id) on delete cascade,
  constraint invoice_items_product_fkey foreign key (product_id, business_id)
    references public.products (id, business_id) on delete restrict
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- Numbering: one counter per business and year, taken under a row lock.
create table public.invoice_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  year integer not null,
  last_number integer not null,
  primary key (business_id, year)
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;

-- Payments --------------------------------------------------------------------------------------
alter table public.payments
  add column number bigint generated always as identity,
  add column method text not null default 'eft'
    check (method in ('eft', 'card', 'cash', 'debit_order', 'other')),
  add column notes text check (char_length(notes) <= 500),
  add constraint payments_reference_length check (char_length(reference) <= 80);

-- History: invoices join the sales history table ------------------------------------------------
alter table public.sales_events
  add column invoice_id uuid,
  drop constraint sales_events_one_subject,
  add constraint sales_events_one_subject check (num_nonnulls(lead_id, order_id, invoice_id) = 1),
  add constraint sales_events_invoice_fkey foreign key (invoice_id, business_id)
    references public.invoices (id, business_id) on delete cascade;
create index sales_events_invoice_idx on public.sales_events (invoice_id, created_at)
  where invoice_id is not null;

-- Rules -----------------------------------------------------------------------------------------
create function public.due_date_for(p_issue date, p_terms text) returns date
language sql immutable as $$
  select p_issue + case p_terms when 'net7' then 7 when 'net14' then 14 when 'net30' then 30 else 0 end
$$;

-- draft -> sent (issued: numbered and locked) -> partially paid -> paid, by payments only.
-- A draft can be cancelled by staff; an issued invoice without payments by a manager.
create function public.check_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  paid numeric;
  has_items boolean;
  seq integer;
  trusted boolean := auth.uid() is null;
begin
  perform assert_sales_caller(new.business_id);

  if tg_op = 'INSERT' then
    if not trusted then
      if new.status <> 'draft' then
        raise exception 'invoice_transition' using errcode = '23514';
      end if;
      new.created_by := auth.uid();
    end if;
    if new.status = 'draft' then
      new.invoice_number := null;
      new.issue_date := null;
      new.sent_at := null;
    end if;
  else
    if new.business_id <> old.business_id then
      raise exception 'business_id cannot be changed';
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' then
      raise exception 'invoice_transition' using errcode = '23514';
    end if;
    if old.status = 'draft' and new.status not in ('draft', 'sent', 'cancelled') then
      raise exception 'invoice_transition' using errcode = '23514';
    end if;

    if old.status <> 'draft' then
      -- Issued: what the customer received cannot change.
      if (new.customer_id, new.order_id, new.property_id, new.invoice_number, new.issue_date,
          new.due_date, new.payment_terms, new.discount_percent, new.vat_rate, new.notes)
         is distinct from
         (old.customer_id, old.order_id, old.property_id, old.invoice_number, old.issue_date,
          old.due_date, old.payment_terms, old.discount_percent, old.vat_rate, old.notes) then
        raise exception 'invoice_locked' using errcode = '23514';
      end if;
      new.subtotal := old.subtotal;
      new.discount := old.discount;
      new.tax := old.tax;
      new.total := old.total;
      new.sent_at := old.sent_at;
      new.issued_by := old.issued_by;
      select coalesce(sum(amount), 0) into paid from payments where invoice_id = new.id;
      if new.status = 'cancelled' and old.status <> 'cancelled' then
        if paid > 0 then
          raise exception 'invoice_has_payments' using errcode = '23514';
        end if;
        if not trusted and not is_manager_up() then
          raise exception 'invoice_cancel_manager' using errcode = '23514';
        end if;
      elsif new.status <> 'cancelled' then
        -- Paid or not is the payments' to say, whatever the caller sent.
        new.status := case when paid <= 0 then 'sent' when paid < new.total then 'partially_paid' else 'paid' end;
      end if;
      return new;
    end if;
  end if;

  -- Draft (or being issued now): checks and totals.
  if new.property_id is not null and not exists (
    select 1 from properties where id = new.property_id and customer_id = new.customer_id
      and business_id = new.business_id) then
    raise exception 'invoice_property_mismatch' using errcode = '23514';
  end if;
  if new.order_id is not null and not exists (
    select 1 from orders where id = new.order_id and customer_id = new.customer_id
      and business_id = new.business_id) then
    raise exception 'invoice_order_mismatch' using errcode = '23514';
  end if;
  if new.vat_rate > 0 and not (select vat_registered from businesses where id = new.business_id) then
    raise exception 'invoice_vat_not_registered' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' then
    -- Imported or seeded by trusted server code: keep the figures given.
    return new;
  end if;

  select coalesce(sum(round(quantity * unit_price, 2)), 0), count(*) > 0
    into new.subtotal, has_items
    from invoice_items where invoice_id = new.id;
  new.discount := round(new.subtotal * new.discount_percent / 100, 2);
  new.tax := round((new.subtotal - new.discount) * new.vat_rate / 100, 2);
  new.total := new.subtotal - new.discount + new.tax;

  if tg_op = 'UPDATE' and new.status = 'sent' then
    if not has_items then
      raise exception 'invoice_empty' using errcode = '23514';
    end if;
    new.issue_date := coalesce(new.issue_date, business_today());
    if new.issue_date > business_today() then
      raise exception 'invoice_date_future' using errcode = '23514';
    end if;
    new.due_date := coalesce(new.due_date, due_date_for(new.issue_date, new.payment_terms));
    insert into invoice_counters (business_id, year, last_number)
    values (new.business_id, extract(year from new.issue_date)::integer, 1)
    on conflict (business_id, year) do update set last_number = invoice_counters.last_number + 1
    returning last_number into seq;
    new.invoice_number := 'INV-' || extract(year from new.issue_date)::integer || '-' || lpad(seq::text, 5, '0');
    new.sent_at := now();
    new.issued_by := auth.uid();
    -- A nothing-due invoice is settled the moment it is issued.
    if new.total = 0 then
      new.status := 'paid';
    end if;
  elsif new.status = 'draft' then
    new.invoice_number := null;
  end if;
  return new;
end;
$$;
create trigger check_invoice before insert or update on public.invoices
  for each row execute function public.check_invoice();

create function public.log_invoice_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into sales_events (business_id, invoice_id, to_status, actor_id)
    values (new.business_id, new.id, new.status, auth.uid());
  elsif new.status <> old.status then
    insert into sales_events (business_id, invoice_id, from_status, to_status, note, actor_id)
    values (new.business_id, new.id, old.status, new.status,
      case when new.status = 'cancelled' then new.cancel_reason
           when old.status = 'draft' then new.invoice_number end,
      auth.uid());
  end if;
  return new;
end;
$$;
create trigger log_invoice_event after insert or update on public.invoices
  for each row execute function public.log_invoice_event();

create function public.check_invoice_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.invoice_items := case when tg_op = 'DELETE' then old else new end;
  inv public.invoices;
begin
  perform assert_sales_caller(rec.business_id);
  if tg_op = 'UPDATE' and (new.invoice_id, new.business_id) is distinct from (old.invoice_id, old.business_id) then
    raise exception 'invoice_locked' using errcode = '23514';
  end if;
  select * into inv from invoices where id = rec.invoice_id and business_id = rec.business_id for update;
  if inv.id is not null and inv.status <> 'draft' then
    raise exception 'invoice_locked' using errcode = '23514';
  end if;
  return rec;
end;
$$;
create trigger check_invoice_item before insert or update or delete on public.invoice_items
  for each row execute function public.check_invoice_item();

create function public.refresh_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  iid uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  update invoices set updated_at = now() where id = iid;
  return null;
end;
$$;
create trigger refresh_invoice after insert or update or delete on public.invoice_items
  for each row execute function public.refresh_invoice();

-- Payments: only on an issued, unpaid invoice; never more than what is owed; not in the future.
create function public.check_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.invoices;
  paid numeric;
begin
  perform assert_sales_caller(new.business_id);
  if tg_op = 'UPDATE' then
    raise exception 'payments cannot be changed; remove and record again';
  end if;
  -- The lock makes two people recording at once take turns, so neither can overpay.
  select * into inv from invoices where id = new.invoice_id and business_id = new.business_id for update;
  if inv.id is null then
    raise exception 'payment_invoice_not_found' using errcode = '23503';
  end if;
  if inv.status not in ('sent', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into paid from payments where invoice_id = inv.id;
  if new.amount > inv.total - paid then
    raise exception 'payment_exceeds_balance' using errcode = '23514';
  end if;
  if (new.paid_at at time zone 'Africa/Johannesburg')::date > business_today() then
    raise exception 'payment_in_future' using errcode = '23514';
  end if;
  if inv.issue_date is not null and (new.paid_at at time zone 'Africa/Johannesburg')::date < inv.issue_date then
    raise exception 'payment_before_issue' using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger check_payment before insert or update on public.payments
  for each row execute function public.check_payment();

create function public.after_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.payments := case when tg_op = 'DELETE' then old else new end;
  inv public.invoices;
begin
  update invoices set updated_at = now() where id = rec.invoice_id returning * into inv;
  insert into sales_events (business_id, invoice_id, from_status, to_status, note, actor_id)
  values (rec.business_id, rec.invoice_id,
    case when tg_op = 'DELETE' then 'payment_removed' else 'payment' end, coalesce(inv.status, 'sent'),
    'R ' || to_char(rec.amount, 'FM999G999G999G990D00') || coalesce(' (' || rec.reference || ')', ''),
    auth.uid());
  return null;
end;
$$;
create trigger after_payment after insert or delete on public.payments
  for each row execute function public.after_payment();

-- Removing a payment is how a mistake is corrected, so the audit keeps what it was.
drop trigger audit_row_change on public.payments;
create function public.audit_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.payments := case when tg_op = 'DELETE' then old else new end;
begin
  insert into audit_logs (business_id, actor_id, action, table_name, record_id, details)
  values (rec.business_id, auth.uid(), tg_op, tg_table_name, rec.id, jsonb_build_object(
    'invoice_id', rec.invoice_id, 'amount', rec.amount, 'reference', rec.reference, 'paid_at', rec.paid_at));
  return rec;
end;
$$;
create trigger audit_payment after insert or delete on public.payments
  for each row execute function public.audit_payment();

revoke execute on function
  public.check_invoice(), public.log_invoice_event(), public.check_invoice_item(),
  public.refresh_invoice(), public.check_payment(), public.after_payment(), public.audit_payment()
from public, anon, authenticated;

-- Saving and creating: all or nothing ------------------------------------------------------------
create function public.save_invoice(
  p_invoice_id uuid, p_customer_id uuid, p_items jsonb,
  p_property_id uuid default null, p_order_id uuid default null, p_payment_terms text default 'net30',
  p_due_date date default null, p_discount_percent numeric default 0, p_vat_rate numeric default 15,
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  iid uuid := p_invoice_id;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invoice_empty' using errcode = '23514';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'invoice_too_many_items' using errcode = '23514';
  end if;
  if iid is null then
    insert into invoices (customer_id, property_id, order_id, payment_terms, due_date,
      discount_percent, vat_rate, notes)
    values (p_customer_id, p_property_id, p_order_id, p_payment_terms, p_due_date,
      p_discount_percent, p_vat_rate, p_notes)
    returning id into iid;
  else
    update invoices set customer_id = p_customer_id, property_id = p_property_id, order_id = p_order_id,
      payment_terms = p_payment_terms, due_date = p_due_date, discount_percent = p_discount_percent,
      vat_rate = p_vat_rate, notes = p_notes
    where id = iid and status = 'draft';
    if not found then
      if exists (select 1 from invoices where id = iid) then
        raise exception 'invoice_locked' using errcode = '23514';
      end if;
      raise exception 'invoice_not_found' using errcode = '42501';
    end if;
    delete from invoice_items where invoice_id = iid;
  end if;
  insert into invoice_items (invoice_id, position, product_id, description, quantity, unit_price)
  select iid, t.ord, nullif(t.item ->> 'product_id', '')::uuid, btrim(t.item ->> 'description'),
    (t.item ->> 'quantity')::integer, (t.item ->> 'unit_price')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
  return iid;
end;
$$;

-- A draft invoice with the order's lines, discount and VAT. The order must be confirmed or fulfilled.
create function public.invoice_order(p_order_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  o orders;
  iid uuid;
  terms text;
begin
  select * into o from orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'order_not_found' using errcode = '42501';
  end if;
  if o.status not in ('confirmed', 'fulfilled') then
    raise exception 'order_not_invoiceable' using errcode = '23514';
  end if;
  if exists (select 1 from invoices where order_id = o.id and status <> 'cancelled') then
    raise exception 'order_already_invoiced' using errcode = '23514';
  end if;
  select default_payment_terms into terms from billing_profile();
  insert into invoices (customer_id, property_id, order_id, payment_terms, discount_percent, vat_rate, notes)
  values (o.customer_id, o.property_id, o.id, coalesce(terms, 'net30'), o.discount_percent, o.vat_rate, null)
  returning id into iid;
  insert into invoice_items (invoice_id, position, product_id, description, quantity, unit_price)
  select iid, position, product_id, description, quantity, unit_price from order_items where order_id = o.id;
  update invoices set updated_at = now() where id = iid;
  return iid;
end;
$$;

revoke execute on function
  public.save_invoice(uuid, uuid, jsonb, uuid, uuid, text, date, numeric, numeric, text),
  public.invoice_order(uuid)
from public, anon;
grant execute on function
  public.save_invoice(uuid, uuid, jsonb, uuid, uuid, text, date, numeric, numeric, text),
  public.invoice_order(uuid)
to authenticated;

-- Clients see what was issued to them: never drafts, including drafts that were cancelled.
drop policy invoices_client_select on public.invoices;
create policy invoices_client_select on public.invoices for select to authenticated
  using (customer_id = public.current_customer_id() and invoice_number is not null);
drop policy payments_client_select on public.payments;
create policy payments_client_select on public.payments for select to authenticated
  using (invoice_id in (
    select id from public.invoices
    where customer_id = public.current_customer_id() and invoice_number is not null));

-- Policies --------------------------------------------------------------------------------------
alter table public.invoice_items enable row level security;
create policy invoice_items_staff_select on public.invoice_items for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy invoice_items_staff_insert on public.invoice_items for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up());
-- Editing a draft replaces its lines.
create policy invoice_items_staff_delete_draft on public.invoice_items for delete to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up()
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'));
create policy invoice_items_client_select on public.invoice_items for select to authenticated
  using (invoice_id in (
    select id from public.invoices
    where customer_id = public.current_customer_id() and invoice_number is not null));
revoke all on public.invoice_items from anon;

-- Read models (security_invoker) ---------------------------------------------------------------
create view public.invoice_list with (security_invoker = true) as
select
  i.id, i.business_id, i.invoice_number, coalesce(i.invoice_number, 'Draft') as reference,
  i.customer_id, c.name as customer_name, c.email as customer_email,
  i.order_id, 'ORD-' || lpad(o.number::text, 5, '0') as order_reference,
  i.property_id, coalesce(p.name, p.address) as property_name,
  i.issue_date, i.due_date, i.payment_terms, i.status, i.discount_percent, i.vat_rate,
  i.subtotal, i.discount, i.tax, i.total, i.notes, i.cancel_reason, i.sent_at, i.created_at,
  coalesce(pay.paid, 0)::numeric(12, 2) as paid,
  case when i.status in ('sent', 'partially_paid') then greatest(i.total - coalesce(pay.paid, 0), 0)
    else 0 end::numeric(12, 2) as balance,
  (i.status in ('sent', 'partially_paid') and i.due_date < public.business_today()) as is_overdue,
  case when i.status in ('sent', 'partially_paid') and i.due_date < public.business_today()
    then 'overdue' else i.status end as display_status
from public.invoices i
join public.customers c on c.id = i.customer_id
left join public.orders o on o.id = i.order_id
left join public.properties p on p.id = i.property_id
left join (select invoice_id, sum(amount) as paid from public.payments group by invoice_id) pay
  on pay.invoice_id = i.id;

create view public.invoice_status_summary with (security_invoker = true) as
select
  business_id,
  (count(*) filter (where status = 'draft'))::integer as drafts,
  (count(*) filter (where status not in ('draft', 'cancelled')))::integer as issued,
  (count(*) filter (where status = 'paid'))::integer as paid,
  (count(*) filter (where status in ('sent', 'partially_paid') and not is_overdue))::integer as unpaid,
  (count(*) filter (where is_overdue))::integer as overdue,
  coalesce(sum(balance), 0)::numeric(16, 2) as outstanding,
  coalesce(sum(balance) filter (where is_overdue), 0)::numeric(16, 2) as overdue_amount
from public.invoice_list
group by business_id;

create view public.payment_list with (security_invoker = true) as
select
  p.id, p.business_id, 'PAY-' || lpad(p.number::text, 5, '0') as reference_number, p.number,
  p.invoice_id, i.invoice_number, i.customer_id, c.name as customer_name,
  p.amount, p.method, p.reference, p.notes, p.paid_at,
  (p.paid_at at time zone 'Africa/Johannesburg')::date as paid_on,
  r.full_name as recorded_by_name, p.created_at
from public.payments p
join public.invoices i on i.id = p.invoice_id
join public.customers c on c.id = i.customer_id
left join public.profiles r on r.id = p.recorded_by;

create or replace view public.sales_timeline with (security_invoker = true) as
select e.id, e.business_id, e.lead_id, e.order_id, e.from_status, e.to_status, e.note,
  p.full_name as actor_name, e.created_at, e.invoice_id
from public.sales_events e left join public.profiles p on p.id = e.actor_id;

revoke all on public.invoice_list, public.invoice_status_summary, public.payment_list from anon;
grant select on public.invoice_list, public.invoice_status_summary, public.payment_list to authenticated;
