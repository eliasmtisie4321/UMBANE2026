-- Phase 13: settings, administration and audit logs.
--
-- * Business profile: description, website and a structured address (administrators edit).
-- * Ticket and product categories become lists each business manages (managers and up). A category
--   in use is switched off rather than deleted; renaming a product category renames it on products.
-- * The audit log records what changed (old and new values, with ID and bank numbers masked), who
--   did it (with their name kept, even if the person is later removed) and when. Only
--   administrators read it; managers get a plain "recent activity" feed without the sensitive parts.
-- * Security events (password changed, signed out elsewhere) are logged.
-- * Deactivating someone tells the managers what open work is still assigned to them.
-- * Data retention: a daily clean-up of old notifications, automation history, processed account
--   requests and audit entries past their keeping period, and an administrator's "erase personal
--   details" for a customer (POPIA), which keeps invoices and payments for tax.
--
-- Run after 0014.

-- Business profile --------------------------------------------------------------------------------
alter table public.businesses
  add column description text check (char_length(description) <= 500),
  add column website text check (website ~ '^https?://[^\s]+$' and char_length(website) <= 200),
  add column city text check (char_length(city) <= 80),
  add column province text check (province in (
    'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
    'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape')),
  add column postal_code text check (postal_code ~ '^[0-9]{4}$'),
  -- Checked on every change from now on; existing values are left as they are.
  add constraint businesses_email_check check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') not valid,
  add constraint businesses_name_length check (char_length(name) <= 120) not valid,
  add constraint businesses_address_length check (char_length(address) <= 300) not valid;

-- Audit log ---------------------------------------------------------------------------------------
alter table public.audit_logs
  add column actor_name text check (char_length(actor_name) <= 120);
update public.audit_logs a set actor_name = p.full_name from public.profiles p where p.id = a.actor_id;
create index audit_business_table_idx on public.audit_logs (business_id, table_name, created_at desc);

-- Only administrators read the audit log. Nobody signed in writes, changes or deletes it.
drop policy audit_select on public.audit_logs;
create policy audit_admin_select on public.audit_logs for select to authenticated
  using (business_id = public.current_business_id() and public.is_admin());
revoke insert, update, delete, truncate on public.audit_logs from authenticated, anon;

-- Masks ID and bank account numbers and shortens long text before it is kept in the log.
create function public.audit_redact(p_row jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  v_out jsonb := p_row;
begin
  for k, v in select key, value from jsonb_each(coalesce(p_row, '{}')) loop
    if k in ('id_number', 'bank_account_number') and jsonb_typeof(v) = 'string' then
      v_out := v_out || jsonb_build_object(k, '•••' || right(v #>> '{}', 3));
    elsif jsonb_typeof(v) = 'string' and char_length(v #>> '{}') > 300 then
      v_out := v_out || jsonb_build_object(k, left(v #>> '{}', 300) || '…');
    end if;
  end loop;
  return v_out;
end;
$$;

-- Columns that change by themselves (timestamps, running totals, automation results) are not
-- changes anyone made, so an update touching only these is not logged.
create function public.audit_noise() returns text[]
language sql immutable as $$
  select array['updated_at', 'last_activity_at', 'status_changed_at', 'last_event_at',
    'stock_on_hand', 'last_run_at', 'last_status', 'last_message', 'number']
$$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec record := case when tg_op = 'DELETE' then old else new end;
  biz uuid;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}';
  v_details jsonb;
  k text;
begin
  -- Two statements, not a CASE: plpgsql checks every field named in an expression, and businesses has
  -- no business_id.
  if tg_table_name = 'businesses' then
    biz := rec.id;
  else
    biz := rec.business_id;
  end if;
  if tg_op = 'UPDATE' then
    v_old := audit_redact(to_jsonb(old));
    v_new := audit_redact(to_jsonb(new));
    for k in select key from jsonb_each(v_new) loop
      if not (k = any(audit_noise())) and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}' then
      return null;
    end if;
    v_details := jsonb_build_object('changes', v_changes);
  else
    v_details := jsonb_build_object('row', audit_redact(to_jsonb(rec)) - audit_noise());
  end if;
  insert into audit_logs (business_id, actor_id, actor_name, action, table_name, record_id, details)
  values (biz, auth.uid(), (select full_name from profiles where id = auth.uid()), tg_op,
    tg_table_name, rec.id, v_details);
  return null;
end;
$$;

-- Settings and administration are audited too.
create trigger audit_row_change after update on public.businesses
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.staff_invitations
  for each row execute function public.audit_row_change();
create trigger audit_row_change after update on public.automations
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.message_templates
  for each row execute function public.audit_row_change();

-- Security events the app reports for the person signed in (it cannot report anyone else's).
create function public.log_security_event(p_event text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_business_id() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_event not in ('password_changed', 'signed_out_other_sessions') then
    raise exception 'security_event_unknown' using errcode = '23514';
  end if;
  insert into audit_logs (business_id, actor_id, actor_name, action, table_name, record_id, details)
  values (current_business_id(), auth.uid(), (select full_name from profiles where id = auth.uid()),
    'SECURITY', 'profiles', auth.uid(), jsonb_build_object('event', p_event));
end;
$$;

-- What managers see on the dashboard: everyday records only, no users, settings or security.
create function public.recent_activity(p_limit integer default 8)
returns table (id uuid, action text, table_name text, record_id uuid, actor_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.table_name, a.record_id, a.actor_name, a.created_at
  from audit_logs a
  where a.business_id = current_business_id() and is_manager_up()
    and a.action in ('INSERT', 'UPDATE', 'DELETE')
    and a.table_name in ('customers', 'properties', 'electricity_meters', 'meter_readings',
      'meter_maintenance', 'leads', 'orders', 'sales', 'invoices', 'payments', 'products',
      'inventory_transactions', 'support_tickets', 'staff_tasks')
  order by a.created_at desc
  limit least(greatest(p_limit, 1), 50)
$$;

-- Categories --------------------------------------------------------------------------------------
create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  is_active boolean not null default true,
  position integer not null default 100 check (position between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);
create unique index ticket_categories_label_uniq on public.ticket_categories (business_id, lower(btrim(label)));
create trigger set_updated_at before update on public.ticket_categories
  for each row execute function public.set_updated_at();

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60 and name = btrim(name)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_categories_name_uniq on public.product_categories (business_id, lower(name));
create trigger set_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();

alter table public.ticket_categories enable row level security;
alter table public.product_categories enable row level security;
revoke all on public.ticket_categories, public.product_categories from anon;
-- Everyone in the business sees ticket categories (clients choose one when they open a ticket);
-- product categories are for staff. Managers and up manage both.
create policy ticket_categories_select on public.ticket_categories for select to authenticated
  using (business_id = public.current_business_id()
         and (public.is_staff_up() or is_active));
create policy product_categories_select on public.product_categories for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy ticket_categories_manage on public.ticket_categories for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy product_categories_manage on public.product_categories for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());

create trigger audit_row_change after insert or update or delete on public.ticket_categories
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.product_categories
  for each row execute function public.audit_row_change();

-- Every business starts with the six ticket categories used until now.
create function public.seed_ticket_categories(p_business_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into ticket_categories (business_id, key, label, position) values
    (p_business_id, 'meter_fault', 'Meter fault', 10),
    (p_business_id, 'prepaid_token', 'Prepaid token', 20),
    (p_business_id, 'billing', 'Billing', 30),
    (p_business_id, 'telemetry', 'Telemetry', 40),
    (p_business_id, 'installation', 'Installation', 50),
    (p_business_id, 'general', 'General question', 60)
  on conflict (business_id, key) do nothing
$$;
select public.seed_ticket_categories(id) from public.businesses;
create function public.seed_business_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_ticket_categories(new.id);
  return null;
end;
$$;
create trigger seed_business_categories after insert on public.businesses
  for each row execute function public.seed_business_categories();

-- Product categories already typed on products become the starting list.
insert into public.product_categories (business_id, name)
select distinct on (business_id, lower(btrim(category))) business_id, btrim(category)
from public.products
where char_length(btrim(coalesce(category, ''))) between 2 and 60
order by business_id, lower(btrim(category)), btrim(category)
on conflict do nothing;

-- A category key is fixed (tickets store it); a category in use cannot be deleted, only switched off.
create function public.guard_ticket_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.key <> old.key then
    raise exception 'category_key_fixed' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' and exists (
      select 1 from support_tickets where business_id = old.business_id and category = old.key) then
    raise exception 'category_in_use' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger guard_ticket_category before update or delete on public.ticket_categories
  for each row execute function public.guard_ticket_category();

alter table public.support_tickets drop constraint tickets_category_check;

-- A ticket's category must be one of the business's categories, and a new choice must be switched on.
create function public.check_ticket_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.category = old.category then
    return new;
  end if;
  if not exists (select 1 from ticket_categories
                 where business_id = new.business_id and key = new.category and is_active) then
    raise exception 'ticket_category_unknown' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_ticket_category before insert or update of category on public.support_tickets
  for each row execute function public.check_ticket_category();

-- Product category: matched to the list ignoring case and spaces, and stored with the list's
-- spelling. Whoever may create products can type a new one, which joins the list; renaming,
-- switching off and deleting categories are for managers.
create function public.check_product_category() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c product_categories;
begin
  if new.category is null or btrim(new.category) = '' then
    new.category := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then
    return new;
  end if;
  select * into c from product_categories
  where business_id = new.business_id and lower(name) = lower(btrim(new.category));
  if not found then
    insert into product_categories (business_id, name) values (new.business_id, btrim(new.category))
    returning * into c;
  elsif not c.is_active then
    raise exception 'product_category_inactive' using errcode = '23514';
  end if;
  new.category := c.name;
  return new;
end;
$$;
create trigger check_product_category before insert or update of category on public.products
  for each row execute function public.check_product_category();

-- Renaming a product category renames it on every product; one in use cannot be deleted.
create function public.sync_product_category() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.name <> old.name then
    update products set category = new.name
    where business_id = new.business_id and category = old.name;
  end if;
  if tg_op = 'DELETE' and exists (
      select 1 from products where business_id = old.business_id and category = old.name) then
    raise exception 'category_in_use' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger sync_product_category_before before delete on public.product_categories
  for each row execute function public.sync_product_category();
create trigger sync_product_category_after after update of name on public.product_categories
  for each row execute function public.sync_product_category();

-- Deactivation ----------------------------------------------------------------------------------
-- Access stops at once (every rule checks is_active). The managers are told what work is still
-- assigned to the person, so it can be handed on.
create function public.after_profile_deactivated() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tickets integer;
  v_tasks integer;
  v_visits integer;
begin
  if not (old.is_active and not new.is_active) or new.role = 'client' then
    return null;
  end if;
  select count(*) into v_tickets from support_tickets
  where assigned_to = new.id and status in ('open', 'assigned', 'in_progress');
  select count(*) into v_tasks from staff_tasks
  where assigned_to = new.id and status in ('todo', 'in_progress');
  select count(*) into v_visits from meter_maintenance
  where assigned_to = new.id and status in ('scheduled', 'pending', 'in_progress');
  perform notify_people(business_managers(new.business_id), new.business_id, 'general',
    new.full_name || ' was deactivated',
    case when v_tickets + v_tasks + v_visits = 0 then 'Nothing open is assigned to them.'
         else 'Still assigned to them: ' || concat_ws(', ',
           case when v_tickets > 0 then v_tickets || ' open ticket' || case when v_tickets = 1 then '' else 's' end end,
           case when v_tasks > 0 then v_tasks || ' open task' || case when v_tasks = 1 then '' else 's' end end,
           case when v_visits > 0 then v_visits || ' maintenance visit' || case when v_visits = 1 then '' else 's' end end)
           || '. Hand it on to someone else.' end,
    '/team/' || new.id, 'deactivated:' || new.id || ':' || now()::date, true);
  return null;
end;
$$;
create trigger after_profile_deactivated after update of is_active on public.profiles
  for each row execute function public.after_profile_deactivated();

-- Erasing a customer's personal details (POPIA) --------------------------------------------------
alter table public.customers
  add column erased_at timestamptz,
  add column erased_by uuid references public.profiles (id) on delete set null,
  add column erase_reason text check (char_length(erase_reason) <= 300);

-- Removes a customer's name, contact and identity details, the text of their messages and tickets,
-- and their sign-in, keeping the customer record, invoices, payments, properties and meters (needed
-- for tax and the electricity supply). Refused while they owe money or have open tickets.
create function public.erase_customer(p_customer_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c customers;
  v_label text;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'erase_reason_required' using errcode = '23514';
  end if;
  select * into c from customers where id = p_customer_id and business_id = current_business_id()
  for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if c.erased_at is not null then
    raise exception 'customer_already_erased' using errcode = '23514';
  end if;
  if exists (select 1 from invoice_list where customer_id = c.id and balance > 0) then
    raise exception 'customer_has_balance' using errcode = '23514';
  end if;
  if exists (select 1 from support_tickets where customer_id = c.id and status in ('open', 'assigned', 'in_progress')) then
    raise exception 'customer_has_open_tickets' using errcode = '23514';
  end if;
  v_label := 'Erased customer ' || upper(left(c.id::text, 8));

  update customers set name = v_label, customer_type = 'individual', company_name = null,
    email = null, phone = null, alt_phone = null, id_number = null, registration_number = null,
    street_address = null, suburb = null, city = null, postal_code = null, notes = null,
    status = 'inactive', email_opt_out = true, marketing_consent = false, profile_id = null,
    erased_at = now(), erased_by = auth.uid(), erase_reason = btrim(p_reason)
  where id = c.id;

  -- Their sign-in stops working; the account itself is removed in Supabase (see docs/SETTINGS.md).
  if c.profile_id is not null then
    update profiles set is_active = false, full_name = v_label, phone = null where id = c.profile_id;
  end if;
  -- The audit trail held the details too, including the entries these very changes just added.
  update audit_logs set details = jsonb_build_object('erased', true)
  where (table_name = 'customers' and record_id = c.id)
     or (table_name = 'profiles' and record_id = c.profile_id);
  insert into audit_logs (business_id, actor_id, actor_name, action, table_name, record_id, details)
  values (c.business_id, auth.uid(), (select full_name from profiles where id = auth.uid()), 'ERASE',
    'customers', c.id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

-- The rest of the erasure, as a consequence of the customer being marked erased (so the ticket
-- rules, which let only the database's own follow-on changes touch closed tickets, allow it).
create function public.after_customer_erased() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.erased_at is not null or new.erased_at is null then
    return null;
  end if;
  update communication_logs set subject = '[erased]', body = '[erased]',
    recipient = case when recipient is not null then 'erased@erased.invalid' end,
    status = case when status in ('queued', 'failed', 'sending') then 'cancelled' else status end,
    attachment_name = null
  where customer_id = new.id;
  update support_tickets set description = '[erased]',
    resolution = case when resolution is not null then '[erased]' end
  where customer_id = new.id;
  update ticket_messages set body = '[erased]'
  where ticket_id in (select id from support_tickets where customer_id = new.id);
  -- Earlier audit entries for this customer held the details too.
  update audit_logs set details = jsonb_build_object('erased', true)
  where table_name = 'customers' and record_id = new.id;
  return null;
end;
$$;
create trigger after_customer_erased after update of erased_at on public.customers
  for each row execute function public.after_customer_erased();

-- An erased customer's personal details stay empty.
create function public.guard_erased_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.erased_at is not null and auth.uid() is not null and (
       new.name, new.email, new.phone, new.alt_phone, new.id_number, new.company_name,
       new.registration_number, new.street_address, new.suburb, new.city, new.postal_code,
       new.notes, new.profile_id, new.erased_at)
       is distinct from
       (old.name, old.email, old.phone, old.alt_phone, old.id_number, old.company_name,
       old.registration_number, old.street_address, old.suburb, old.city, old.postal_code,
       old.notes, old.profile_id, old.erased_at) then
    raise exception 'customer_erased' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_erased_customer before update on public.customers
  for each row execute function public.guard_erased_customer();

-- Retention (server, daily) ----------------------------------------------------------------------
-- How long things are kept. Invoices, payments, customers, tickets, readings and messages are
-- business and tax records and are not removed here.
create function public.retention_periods() returns jsonb
language sql immutable as $$
  select '{"read_notifications_days": 365, "notifications_days": 730, "automation_history_days": 730,
           "processed_access_requests_days": 365, "audit_days": 2557}'::jsonb
$$;

create function public.apply_retention() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p jsonb := retention_periods();
  b uuid;
  v_ids uuid[];
  v_notes integer;
  v_runs integer;
  v_actions integer;
  v_requests integer;
  v_audit integer;
  v_total jsonb := '[]';
begin
  for b in select id from businesses order by id loop
    delete from notifications
    where business_id = b and (
      (is_read and created_at < now() - make_interval(days => (p ->> 'read_notifications_days')::integer))
      or created_at < now() - make_interval(days => (p ->> 'notifications_days')::integer));
    get diagnostics v_notes = row_count;
    delete from automation_actions
    where business_id = b and created_at < now() - make_interval(days => (p ->> 'automation_history_days')::integer);
    get diagnostics v_actions = row_count;
    delete from automation_runs
    where business_id = b and started_at < now() - make_interval(days => (p ->> 'automation_history_days')::integer);
    get diagnostics v_runs = row_count;
    -- The audit log's copies of a removed request go with it.
    select coalesce(array_agg(id), '{}') into v_ids from access_requests
    where business_id = b and status <> 'pending'
      and created_at < now() - make_interval(days => (p ->> 'processed_access_requests_days')::integer);
    delete from access_requests where id = any(v_ids);
    v_requests := cardinality(v_ids);
    delete from audit_logs where table_name = 'access_requests' and record_id = any(v_ids);
    delete from audit_logs
    where business_id = b and created_at < now() - make_interval(days => (p ->> 'audit_days')::integer);
    get diagnostics v_audit = row_count;
    if v_notes + v_actions + v_runs + v_requests + v_audit > 0 then
      insert into audit_logs (business_id, actor_id, actor_name, action, table_name, details)
      values (b, null, null, 'RETENTION', null, jsonb_build_object('notifications', v_notes,
        'automation_runs', v_runs, 'automation_actions', v_actions, 'access_requests', v_requests,
        'audit_logs', v_audit));
    end if;
    v_total := v_total || jsonb_build_array(jsonb_build_object('business_id', b,
      'notifications', v_notes, 'automation_runs', v_runs, 'automation_actions', v_actions,
      'access_requests', v_requests, 'audit_logs', v_audit));
  end loop;
  return jsonb_build_object('businesses', v_total);
end;
$$;

-- Access -----------------------------------------------------------------------------------------
revoke execute on function
  public.audit_redact(jsonb), public.audit_noise(), public.guard_ticket_category(),
  public.check_ticket_category(), public.check_product_category(), public.sync_product_category(),
  public.seed_ticket_categories(uuid), public.seed_business_categories(),
  public.after_profile_deactivated(), public.guard_erased_customer(), public.after_customer_erased(),
  public.apply_retention()
from public, anon, authenticated;
grant execute on function public.apply_retention() to service_role;
revoke execute on function public.log_security_event(text), public.recent_activity(integer),
  public.erase_customer(uuid, text), public.retention_periods()
from public, anon;
grant execute on function public.log_security_event(text), public.recent_activity(integer),
  public.erase_customer(uuid, text), public.retention_periods()
to authenticated;

-- Account requests go to the oldest business; two created at the same moment are told apart by id,
-- so the choice never depends on the order rows happen to be stored in.
create or replace function public.request_access(
  p_full_name text, p_email text, p_phone text default null, p_message text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  biz uuid;
begin
  select id into biz from public.businesses order by created_at, id limit 1;
  if biz is null then
    raise exception 'not configured';
  end if;

  insert into public.access_requests (business_id, full_name, email, phone, message)
  values (
    biz,
    btrim(p_full_name),
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_message, '')), '')
  )
  on conflict (business_id, lower(email)) where status = 'pending' do nothing;
end;
$$;
