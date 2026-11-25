-- Leads, sales and orders (Phase 5). Needs migration 0006. Assumptions are in docs/SALES.md.
-- Order totals, status changes and lead conversion are decided here, not in the app.

-- Links stay inside one business (see migration 0006) ------------------------------------------
alter table public.leads add constraint leads_id_business_key unique (id, business_id);
alter table public.orders add constraint orders_id_business_key unique (id, business_id);
alter table public.products add constraint products_id_business_key unique (id, business_id);

alter table public.leads alter column business_id set default public.current_business_id();
alter table public.orders alter column business_id set default public.current_business_id();
alter table public.order_items alter column business_id set default public.current_business_id();
alter table public.sales alter column business_id set default public.current_business_id();

alter table public.leads drop constraint leads_assigned_to_fkey;
alter table public.leads add constraint leads_assigned_to_fkey
  foreign key (assigned_to, business_id) references public.profiles (id, business_id)
  on delete set null (assigned_to);
alter table public.leads drop constraint leads_converted_customer_id_fkey;
alter table public.leads add constraint leads_converted_customer_id_fkey
  foreign key (converted_customer_id, business_id) references public.customers (id, business_id)
  on delete restrict;
alter table public.orders drop constraint orders_customer_id_fkey;
alter table public.orders add constraint orders_customer_id_fkey
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete restrict;
alter table public.order_items drop constraint order_items_order_id_fkey;
alter table public.order_items add constraint order_items_order_id_fkey
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete cascade;
alter table public.order_items drop constraint order_items_product_id_fkey;
alter table public.order_items add constraint order_items_product_id_fkey
  foreign key (product_id, business_id) references public.products (id, business_id) on delete restrict;
alter table public.sales drop constraint sales_customer_id_fkey;
alter table public.sales add constraint sales_customer_id_fkey
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete restrict;
alter table public.sales drop constraint sales_lead_id_fkey;
alter table public.sales add constraint sales_lead_id_fkey
  foreign key (lead_id, business_id) references public.leads (id, business_id) on delete set null (lead_id);
alter table public.sales drop constraint sales_order_id_fkey;
alter table public.sales add constraint sales_order_id_fkey
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete set null (order_id);

-- Leads -----------------------------------------------------------------------------------------
alter table public.leads
  add column number bigint generated always as identity,
  add column company_name text check (char_length(company_name) <= 160),
  add column service_interest text check (char_length(service_interest) <= 160),
  add column estimated_value numeric(12, 2) check (estimated_value >= 0),
  add column expected_close date,
  add column follow_up_on date,
  add column notes text check (char_length(notes) <= 2000),
  add column lost_reason text check (char_length(lost_reason) <= 500),
  add column closed_on date;

update public.leads set source = case
  when source is null or source in ('web', 'referral', 'tender', 'outreach', 'partner', 'other') then source
  when source ilike 'web%' then 'web'
  else 'other' end;
update public.leads set status = 'qualified' where status = 'converted' and converted_customer_id is null;
update public.leads set converted_customer_id = null where status <> 'converted';
update public.leads set lost_reason = 'Not recorded' where status = 'lost';

alter table public.leads drop constraint leads_status_check;
alter table public.leads
  add constraint leads_status_check check (
    status in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'converted', 'lost')),
  add constraint leads_source_check check (
    source in ('web', 'referral', 'tender', 'outreach', 'partner', 'other')),
  add constraint leads_converted_has_customer check (
    (status = 'converted') = (converted_customer_id is not null)),
  add constraint leads_lost_has_reason check (
    status <> 'lost' or char_length(btrim(coalesce(lost_reason, ''))) >= 3);
create index leads_business_status_idx on public.leads (business_id, status, follow_up_on);

-- Orders ----------------------------------------------------------------------------------------
alter table public.orders
  add column number bigint generated always as identity,
  add column property_id uuid,
  add column lead_id uuid,
  add column assigned_to uuid,
  add column order_date date not null default public.business_today(),
  add column payment_method text check (payment_method in ('eft', 'account', 'card', 'debit_order')),
  add column discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  add column vat_rate numeric(5, 2) not null default 15 check (vat_rate in (0, 15)),
  add column subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  add column discount numeric(12, 2) not null default 0 check (discount >= 0),
  add column tax numeric(12, 2) not null default 0 check (tax >= 0),
  add column notes text check (char_length(notes) <= 2000),
  add column cancel_reason text check (char_length(cancel_reason) <= 500),
  add constraint orders_property_fkey foreign key (property_id, business_id)
    references public.properties (id, business_id) on delete restrict,
  add constraint orders_lead_fkey foreign key (lead_id, business_id)
    references public.leads (id, business_id) on delete restrict,
  add constraint orders_assignee_fkey foreign key (assigned_to, business_id)
    references public.profiles (id, business_id) on delete set null (assigned_to);

update public.orders set subtotal = total, vat_rate = 0;
update public.orders set cancel_reason = 'Not recorded' where status = 'cancelled';
alter table public.orders add constraint orders_cancelled_has_reason check (
  status <> 'cancelled' or char_length(btrim(coalesce(cancel_reason, ''))) >= 3);
create index orders_business_status_idx on public.orders (business_id, status, order_date desc);
create index orders_lead_idx on public.orders (lead_id) where lead_id is not null;

-- A line is a product from the catalogue or a described service. The description is kept on the line
-- so renaming a product later does not rewrite old orders.
alter table public.order_items
  alter column product_id drop not null,
  add column position integer not null default 1,
  add column description text;
update public.order_items i set description = coalesce((select name from public.products where id = i.product_id), 'Item');
alter table public.order_items
  alter column description set not null,
  add constraint order_items_description_check check (char_length(btrim(description)) between 2 and 300),
  add constraint order_items_quantity_max check (quantity <= 100000),
  add constraint order_items_price_max check (unit_price <= 9999999.99);

-- One sale per order.
create unique index sales_order_uniq on public.sales (order_id) where order_id is not null;

-- History: written only by the triggers below --------------------------------------------------
create table public.sales_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  lead_id uuid,
  order_id uuid,
  from_status text,
  to_status text not null,
  note text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sales_events_one_subject check (num_nonnulls(lead_id, order_id) = 1),
  constraint sales_events_lead_fkey foreign key (lead_id, business_id)
    references public.leads (id, business_id) on delete cascade,
  constraint sales_events_order_fkey foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete cascade
);
create index sales_events_lead_idx on public.sales_events (lead_id, created_at) where lead_id is not null;
create index sales_events_order_idx on public.sales_events (order_id, created_at) where order_id is not null;
alter table public.sales_events enable row level security;
create policy sales_events_staff_select on public.sales_events for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
revoke all on public.sales_events from anon, authenticated;
grant select on public.sales_events to authenticated;

-- Activities: calls, meetings and tasks on a lead or an order, assigned to staff ---------------
create table public.sales_activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete restrict,
  lead_id uuid,
  order_id uuid,
  kind text not null check (kind in ('call', 'email', 'meeting', 'site_visit', 'task')),
  subject text not null check (char_length(btrim(subject)) between 3 and 200),
  due_on date,
  assigned_to uuid,
  outcome text check (char_length(outcome) <= 1000),
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_activities_one_subject check (num_nonnulls(lead_id, order_id) = 1),
  constraint sales_activities_lead_fkey foreign key (lead_id, business_id)
    references public.leads (id, business_id) on delete cascade,
  constraint sales_activities_order_fkey foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete cascade,
  constraint sales_activities_assignee_fkey foreign key (assigned_to, business_id)
    references public.profiles (id, business_id) on delete set null (assigned_to)
);
create index sales_activities_open_idx on public.sales_activities (business_id, assigned_to, due_on)
  where completed_at is null;
create index sales_activities_lead_idx on public.sales_activities (lead_id) where lead_id is not null;
create index sales_activities_order_idx on public.sales_activities (order_id) where order_id is not null;
alter table public.sales_activities enable row level security;
create policy sales_activities_staff_select on public.sales_activities for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy sales_activities_staff_insert on public.sales_activities for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up());
create policy sales_activities_staff_update on public.sales_activities for update to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up())
  with check (business_id = public.current_business_id() and public.is_staff_up());
create policy sales_activities_manager_delete on public.sales_activities for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
revoke all on public.sales_activities from anon;

-- Shared checks ---------------------------------------------------------------------------------
-- The triggers below run before the row policies and with owner rights, so each checks its caller.
create function public.assert_sales_caller(p_business_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (not is_staff_up() or p_business_id is distinct from current_business_id()) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;
create function public.assert_staff_assignee(p_profile_id uuid, p_business_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_profile_id is not null and not exists (
    select 1 from profiles where id = p_profile_id and business_id = p_business_id and role <> 'client'
  ) then
    raise exception 'assignee_not_staff' using errcode = '23514';
  end if;
end;
$$;
revoke execute on function
  public.assert_sales_caller(uuid), public.assert_staff_assignee(uuid, uuid)
from public, anon, authenticated;

-- Lead rules ------------------------------------------------------------------------------------
create function public.check_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform assert_sales_caller(new.business_id);
  perform assert_staff_assignee(new.assigned_to, new.business_id);
  if tg_op = 'INSERT' then
    if new.status in ('converted', 'lost') then
      raise exception 'lead_transition' using errcode = '23514';
    end if;
    new.closed_on := null;
    return new;
  end if;

  if new.business_id <> old.business_id then
    raise exception 'business_id cannot be changed';
  end if;
  if old.status = 'converted' and (
    new.status <> 'converted' or new.converted_customer_id is distinct from old.converted_customer_id
  ) then
    raise exception 'lead_converted' using errcode = '23514';
  end if;
  if new.status = 'converted' and old.status not in ('qualified', 'proposal', 'negotiation', 'converted') then
    raise exception 'lead_not_approved' using errcode = '23514';
  end if;
  if new.status <> 'lost' then
    new.lost_reason := null;
  end if;
  if new.status not in ('converted', 'lost') then
    new.closed_on := null;
  elsif new.status <> old.status then
    new.closed_on := business_today();
  else
    new.closed_on := old.closed_on;
  end if;
  return new;
end;
$$;
create trigger check_lead before insert or update on public.leads
  for each row execute function public.check_lead();

create function public.log_lead_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into sales_events (business_id, lead_id, to_status, actor_id)
    values (new.business_id, new.id, new.status, auth.uid());
  elsif new.status <> old.status then
    insert into sales_events (business_id, lead_id, from_status, to_status, note, actor_id)
    values (new.business_id, new.id, old.status, new.status, new.lost_reason, auth.uid());
  end if;
  return new;
end;
$$;
create trigger log_lead_event after insert or update on public.leads
  for each row execute function public.log_lead_event();

-- Existing customers this lead may already be. Phones compare on their last nine digits.
create function public.lead_matches(p_lead_id uuid)
returns table (id uuid, name text, company_name text, email text, phone text, matched_on text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.name, c.company_name, c.email, c.phone,
    case
      when lower(btrim(c.email)) = lower(btrim(l.email)) then 'email'
      when right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(l.phone, '\D', '', 'g'), 9)
        or right(regexp_replace(c.alt_phone, '\D', '', 'g'), 9) = right(regexp_replace(l.phone, '\D', '', 'g'), 9)
        then 'phone'
      else 'company'
    end
  from leads l
  join customers c on c.business_id = l.business_id and (
    lower(btrim(c.email)) = lower(btrim(l.email))
    or (length(regexp_replace(l.phone, '\D', '', 'g')) >= 9 and (
      right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(l.phone, '\D', '', 'g'), 9)
      or right(regexp_replace(c.alt_phone, '\D', '', 'g'), 9) = right(regexp_replace(l.phone, '\D', '', 'g'), 9)))
    or lower(btrim(c.company_name)) = lower(btrim(l.company_name)))
  where l.id = p_lead_id
  order by 6, c.name
  limit 20
$$;

-- Converts an approved lead: links an existing customer, or creates one. A matching email is always
-- refused (it is the same customer); a shared phone or company needs p_create_anyway.
create function public.convert_lead(
  p_lead_id uuid, p_customer_id uuid default null, p_create_anyway boolean default false
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l leads;
  target uuid := p_customer_id;
begin
  select * into l from leads where id = p_lead_id for update;
  if l.id is null then
    raise exception 'lead_not_found' using errcode = '42501';
  end if;
  if l.status = 'converted' then
    raise exception 'lead_converted' using errcode = '23514';
  end if;
  if l.status not in ('qualified', 'proposal', 'negotiation') then
    raise exception 'lead_not_approved' using errcode = '23514';
  end if;

  if target is null then
    if exists (
      select 1 from lead_matches(l.id) m where m.matched_on = 'email' or not p_create_anyway
    ) then
      raise exception 'lead_customer_exists' using errcode = '23514';
    end if;
    insert into customers (name, email, phone, customer_type, company_name, status)
    values (
      l.name, l.email, l.phone,
      case when l.company_name is null then 'individual' else 'business' end, l.company_name, 'active')
    returning id into target;
  end if;

  update leads set status = 'converted', converted_customer_id = target where id = l.id;
  return target;
end;
$$;

-- Order rules -----------------------------------------------------------------------------------
-- pending -> confirmed -> fulfilled; pending or confirmed -> cancelled. Only a pending order can be
-- edited. Totals always come from the lines: prices exclude VAT, the discount comes off first.
create function public.check_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  has_items boolean;
begin
  perform assert_sales_caller(new.business_id);
  perform assert_staff_assignee(new.assigned_to, new.business_id);

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'order_transition' using errcode = '23514';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.business_id <> old.business_id then
      raise exception 'business_id cannot be changed';
    end if;
    if new.status <> old.status and not (
      (old.status = 'pending' and new.status in ('confirmed', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('fulfilled', 'cancelled'))
    ) then
      raise exception 'order_transition' using errcode = '23514';
    end if;
    if old.status <> 'pending' then
      if (new.customer_id, new.property_id, new.lead_id, new.order_date, new.discount_percent, new.vat_rate)
         is distinct from
         (old.customer_id, old.property_id, old.lead_id, old.order_date, old.discount_percent, old.vat_rate)
      then
        raise exception 'order_locked' using errcode = '23514';
      end if;
      new.subtotal := old.subtotal;
      new.discount := old.discount;
      new.tax := old.tax;
      new.total := old.total;
      return new;
    end if;
  end if;

  if new.order_date > business_today() then
    raise exception 'order_date_future' using errcode = '23514';
  end if;
  if new.property_id is not null and not exists (
    select 1 from properties where id = new.property_id and customer_id = new.customer_id and business_id = new.business_id
  ) then
    raise exception 'order_property_mismatch' using errcode = '23514';
  end if;
  if new.lead_id is not null and not exists (
    select 1 from leads where id = new.lead_id and converted_customer_id = new.customer_id and business_id = new.business_id
  ) then
    raise exception 'order_lead_mismatch' using errcode = '23514';
  end if;

  select coalesce(sum(round(quantity * unit_price, 2)), 0), count(*) > 0
    into new.subtotal, has_items
    from order_items where order_id = new.id;
  if new.status = 'confirmed' and not has_items then
    raise exception 'order_empty' using errcode = '23514';
  end if;
  new.discount := round(new.subtotal * new.discount_percent / 100, 2);
  new.tax := round((new.subtotal - new.discount) * new.vat_rate / 100, 2);
  new.total := new.subtotal - new.discount + new.tax;
  return new;
end;
$$;
create trigger check_order before insert or update on public.orders
  for each row execute function public.check_order();

create function public.check_order_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.order_items := case when tg_op = 'DELETE' then old else new end;
  o public.orders;
begin
  perform assert_sales_caller(rec.business_id);
  if tg_op = 'UPDATE' and (new.order_id, new.business_id) is distinct from (old.order_id, old.business_id) then
    raise exception 'order_locked' using errcode = '23514';
  end if;
  -- The lock makes "confirm" and "edit" take turns.
  select * into o from orders where id = rec.order_id and business_id = rec.business_id for update;
  -- The order is already gone when its lines are removed with it.
  if o.id is not null and o.status <> 'pending' then
    raise exception 'order_locked' using errcode = '23514';
  end if;
  return rec;
end;
$$;
create trigger check_order_item before insert or update or delete on public.order_items
  for each row execute function public.check_order_item();

create function public.refresh_order_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.order_items := case when tg_op = 'DELETE' then old else new end;
begin
  update orders set updated_at = now() where id = rec.order_id;
  return null;
end;
$$;
create trigger refresh_order_total after insert or update or delete on public.order_items
  for each row execute function public.refresh_order_total();

-- History, and the sale itself when an order is fulfilled (amount excludes VAT).
create function public.log_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into sales_events (business_id, order_id, to_status, actor_id)
    values (new.business_id, new.id, new.status, auth.uid());
  elsif new.status <> old.status then
    insert into sales_events (business_id, order_id, from_status, to_status, note, actor_id)
    values (new.business_id, new.id, old.status, new.status, new.cancel_reason, auth.uid());
    if new.status = 'fulfilled' then
      insert into sales (business_id, customer_id, lead_id, order_id, amount, sold_by)
      values (new.business_id, new.customer_id, new.lead_id, new.id, new.subtotal - new.discount,
        coalesce(new.assigned_to, auth.uid()));
    end if;
  end if;
  return new;
end;
$$;
create trigger log_order_event after insert or update on public.orders
  for each row execute function public.log_order_event();

create function public.check_sales_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform assert_sales_caller(new.business_id);
  perform assert_staff_assignee(new.assigned_to, new.business_id);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  elsif (new.business_id, new.lead_id, new.order_id) is distinct from (old.business_id, old.lead_id, old.order_id) then
    raise exception 'an activity cannot be moved';
  end if;
  -- When it was done is the database's to say.
  if new.completed_at is not null then
    new.completed_at := case when tg_op = 'UPDATE' and old.completed_at is not null
      then old.completed_at else now() end;
  end if;
  return new;
end;
$$;
create trigger check_sales_activity before insert or update on public.sales_activities
  for each row execute function public.check_sales_activity();
create trigger set_updated_at before update on public.sales_activities
  for each row execute function public.set_updated_at();

revoke execute on function
  public.check_lead(), public.log_lead_event(), public.check_order(), public.check_order_item(),
  public.refresh_order_total(), public.log_order_event(), public.check_sales_activity()
from public, anon, authenticated;

create trigger audit_row_change after insert or update or delete on public.leads
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.orders
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.sales
  for each row execute function public.audit_row_change();

-- Saves an order and its lines together: all or nothing.
create function public.save_order(
  p_order_id uuid, p_customer_id uuid, p_items jsonb,
  p_property_id uuid default null, p_lead_id uuid default null, p_assigned_to uuid default null,
  p_order_date date default null, p_payment_method text default null,
  p_discount_percent numeric default 0, p_vat_rate numeric default 15, p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  oid uuid := p_order_id;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_empty' using errcode = '23514';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'order_too_many_items' using errcode = '23514';
  end if;

  if oid is null then
    insert into orders (customer_id, property_id, lead_id, assigned_to, order_date, payment_method,
      discount_percent, vat_rate, notes)
    values (p_customer_id, p_property_id, p_lead_id, p_assigned_to,
      coalesce(p_order_date, business_today()), p_payment_method, p_discount_percent, p_vat_rate, p_notes)
    returning id into oid;
  else
    update orders set customer_id = p_customer_id, property_id = p_property_id, lead_id = p_lead_id,
      assigned_to = p_assigned_to, order_date = coalesce(p_order_date, order_date),
      payment_method = p_payment_method, discount_percent = p_discount_percent,
      vat_rate = p_vat_rate, notes = p_notes
    where id = oid and status = 'pending';
    if not found then
      if exists (select 1 from orders where id = oid) then
        raise exception 'order_locked' using errcode = '23514';
      end if;
      raise exception 'order_not_found' using errcode = '42501';
    end if;
    delete from order_items where order_id = oid;
  end if;

  insert into order_items (order_id, position, product_id, description, quantity, unit_price)
  select oid, t.ord, nullif(t.item ->> 'product_id', '')::uuid, btrim(t.item ->> 'description'),
    (t.item ->> 'quantity')::integer, (t.item ->> 'unit_price')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
  return oid;
end;
$$;

revoke execute on function
  public.lead_matches(uuid), public.convert_lead(uuid, uuid, boolean),
  public.save_order(uuid, uuid, jsonb, uuid, uuid, uuid, date, text, numeric, numeric, text)
from public, anon;
grant execute on function
  public.lead_matches(uuid), public.convert_lead(uuid, uuid, boolean),
  public.save_order(uuid, uuid, jsonb, uuid, uuid, uuid, date, text, numeric, numeric, text)
to authenticated;

-- Policies --------------------------------------------------------------------------------------
-- Staff cannot delete records, but editing a pending order replaces its lines.
create policy order_items_staff_delete_pending on public.order_items for delete to authenticated
  using (
    business_id = public.current_business_id() and public.is_staff_up()
    and exists (select 1 from public.orders o where o.id = order_id and o.status = 'pending'));

-- A sale that belongs to an order is written by the order alone, so its amount cannot be invented.
drop policy sales_staff_insert on public.sales;
create policy sales_staff_insert on public.sales for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up() and order_id is null);
drop policy sales_staff_update on public.sales;
create policy sales_staff_update on public.sales for update to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up() and order_id is null)
  with check (business_id = public.current_business_id() and public.is_staff_up() and order_id is null);

-- Read models (security_invoker) ---------------------------------------------------------------
create view public.lead_list with (security_invoker = true) as
select
  l.id, l.business_id, 'LEAD-' || lpad(l.number::text, 5, '0') as reference, l.number,
  l.name, l.company_name, l.email, l.phone, l.source, l.service_interest, l.status,
  l.estimated_value, l.expected_close, l.follow_up_on, l.assigned_to, a.full_name as assigned_name,
  l.notes, l.lost_reason, l.closed_on, l.converted_customer_id, c.name as customer_name,
  l.created_at, l.updated_at,
  (l.status not in ('converted', 'lost')) as is_open,
  (l.status not in ('converted', 'lost') and l.follow_up_on < public.business_today()) as follow_up_overdue
from public.leads l
left join public.profiles a on a.id = l.assigned_to
left join public.customers c on c.id = l.converted_customer_id;

create view public.lead_summary with (security_invoker = true) as
select business_id, status, count(*)::integer as lead_count,
  coalesce(sum(estimated_value), 0)::numeric(16, 2) as total_value
from public.leads group by business_id, status;

create view public.order_list with (security_invoker = true) as
select
  o.id, o.business_id, 'ORD-' || lpad(o.number::text, 5, '0') as reference, o.number,
  o.customer_id, c.name as customer_name, o.property_id,
  coalesce(p.name, p.address) as property_name, o.lead_id, o.order_date, o.status, o.payment_method,
  o.discount_percent, o.vat_rate, o.subtotal, o.discount, o.tax, o.total, o.notes, o.cancel_reason,
  o.assigned_to, a.full_name as assigned_name, o.created_at,
  i.item_count, i.first_item
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.properties p on p.id = o.property_id
left join public.profiles a on a.id = o.assigned_to
left join lateral (
  select count(*)::integer as item_count,
    (array_agg(description order by position))[1] as first_item
  from public.order_items where order_id = o.id
) i on true;

create view public.sales_summary with (security_invoker = true) as
select
  business_id,
  (count(*) filter (where status = 'pending'))::integer as pending_count,
  coalesce(sum(total) filter (where status = 'pending'), 0)::numeric(16, 2) as pending_value,
  (count(*) filter (where status = 'confirmed'))::integer as confirmed_count,
  coalesce(sum(total) filter (where status = 'confirmed'), 0)::numeric(16, 2) as confirmed_value,
  (count(*) filter (where status = 'fulfilled'))::integer as fulfilled_count,
  (count(*) filter (where status = 'cancelled'))::integer as cancelled_count
from public.orders group by business_id;

-- Sales per South African calendar month, excluding VAT.
create view public.monthly_sales with (security_invoker = true) as
select business_id,
  date_trunc('month', sold_at at time zone 'Africa/Johannesburg')::date as month,
  sum(amount)::numeric(16, 2) as total, count(*)::integer as sale_count
from public.sales
group by business_id, date_trunc('month', sold_at at time zone 'Africa/Johannesburg');

create view public.sales_timeline with (security_invoker = true) as
select e.id, e.business_id, e.lead_id, e.order_id, e.from_status, e.to_status, e.note,
  p.full_name as actor_name, e.created_at
from public.sales_events e left join public.profiles p on p.id = e.actor_id;

create view public.sales_activity_list with (security_invoker = true) as
select
  s.id, s.business_id, s.lead_id, s.order_id, s.kind, s.subject, s.due_on, s.assigned_to,
  a.full_name as assigned_name, s.outcome, s.completed_at, s.created_at,
  (s.completed_at is null) as is_open,
  (s.completed_at is null and s.due_on < public.business_today()) as is_overdue,
  coalesce(l.company_name, l.name, c.name) as subject_name,
  coalesce('LEAD-' || lpad(l.number::text, 5, '0'), 'ORD-' || lpad(o.number::text, 5, '0')) as subject_reference
from public.sales_activities s
left join public.profiles a on a.id = s.assigned_to
left join public.leads l on l.id = s.lead_id
left join public.orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id;

revoke all on
  public.lead_list, public.lead_summary, public.order_list, public.sales_summary,
  public.monthly_sales, public.sales_timeline, public.sales_activity_list
from anon;
grant select on
  public.lead_list, public.lead_summary, public.order_list, public.sales_summary,
  public.monthly_sales, public.sales_timeline, public.sales_activity_list
to authenticated;
