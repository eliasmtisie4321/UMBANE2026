-- Row Level Security for every table (Phase 1a). See docs/PERMISSIONS.md for the matrix.
-- Principle: deny by default; every policy is scoped to the caller's business.

-- Helper functions ------------------------------------------------------------
-- SECURITY DEFINER so policies can read profiles without recursing into profiles' own RLS.
-- All return NULL/false for inactive users, so deactivation revokes access immediately.

create function public.current_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from public.profiles where id = auth.uid() and is_active
$$;

create function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'administrator', false)
$$;

create function public.is_manager_up() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('administrator', 'manager'), false)
$$;

create function public.is_staff_up() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('administrator', 'manager', 'staff'), false)
$$;

create function public.current_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.customers c
  join public.profiles p on p.id = c.profile_id and p.is_active
  where c.profile_id = auth.uid()
$$;

revoke execute on function
  public.current_business_id(), public.current_user_role(), public.is_admin(),
  public.is_manager_up(), public.is_staff_up(), public.current_customer_id()
from public, anon;
grant execute on function
  public.current_business_id(), public.current_user_role(), public.is_admin(),
  public.is_manager_up(), public.is_staff_up(), public.current_customer_id()
to authenticated;

-- Lock everything down, then open it up with policies -------------------------
revoke all on all tables in schema public from anon;

alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.properties enable row level security;
alter table public.electricity_meters enable row level security;
alter table public.meter_readings enable row level security;
alter table public.leads enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.sales enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.staff_tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.communication_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Businesses ------------------------------------------------------------------
create policy businesses_select on public.businesses for select to authenticated
  using (id = public.current_business_id() and public.is_staff_up());
create policy businesses_update on public.businesses for update to authenticated
  using (id = public.current_business_id() and public.is_admin())
  with check (id = public.current_business_id() and public.is_admin());

-- Profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (business_id = public.current_business_id() and public.is_staff_up()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (business_id = public.current_business_id() and public.is_admin())
  with check (business_id = public.current_business_id() and public.is_admin());
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_admin());
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (business_id = public.current_business_id() and public.is_admin() and id <> auth.uid());

-- Block privilege escalation: only administrators may change role or active state,
-- and nobody may move a profile to another business. Service-role calls (auth.uid() is null)
-- are trusted server code and pass the role check.
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id <> old.business_id then
    raise exception 'business_id cannot be changed';
  end if;
  if auth.uid() is not null and not public.is_admin()
     and (new.role <> old.role or new.is_active <> old.is_active) then
    raise exception 'only administrators can change role or active state';
  end if;
  return new;
end;
$$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Staff-operated tables: staff+ create/read/update, managers+ delete ----------
do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'properties', 'electricity_meters', 'meter_readings', 'leads', 'sales',
    'orders', 'order_items', 'invoices', 'payments', 'products', 'inventory_transactions',
    'support_tickets', 'ticket_messages', 'ticket_attachments'
  ] loop
    execute format(
      'create policy %1$s_staff_select on public.%1$I for select to authenticated
         using (business_id = public.current_business_id() and public.is_staff_up())', t);
    execute format(
      'create policy %1$s_staff_insert on public.%1$I for insert to authenticated
         with check (business_id = public.current_business_id() and public.is_staff_up())', t);
    execute format(
      'create policy %1$s_manager_delete on public.%1$I for delete to authenticated
         using (business_id = public.current_business_id() and public.is_manager_up())', t);
  end loop;

  -- Immutable history: no update policy for readings/transactions/messages/attachments/payments.
  foreach t in array array[
    'customers', 'properties', 'electricity_meters', 'leads', 'sales', 'orders', 'order_items',
    'invoices', 'products', 'support_tickets'
  ] loop
    execute format(
      'create policy %1$s_staff_update on public.%1$I for update to authenticated
         using (business_id = public.current_business_id() and public.is_staff_up())
         with check (business_id = public.current_business_id() and public.is_staff_up())', t);
  end loop;
end $$;

-- Client access: only their own records --------------------------------------
create policy customers_client_select on public.customers for select to authenticated
  using (profile_id = auth.uid() and business_id = public.current_business_id());

create policy properties_client_select on public.properties for select to authenticated
  using (customer_id = public.current_customer_id());

create policy meters_client_select on public.electricity_meters for select to authenticated
  using (property_id in (select id from public.properties where customer_id = public.current_customer_id()));

create policy readings_client_select on public.meter_readings for select to authenticated
  using (meter_id in (
    select m.id from public.electricity_meters m
    join public.properties p on p.id = m.property_id
    where p.customer_id = public.current_customer_id()));

create policy orders_client_select on public.orders for select to authenticated
  using (customer_id = public.current_customer_id());

create policy order_items_client_select on public.order_items for select to authenticated
  using (order_id in (select id from public.orders where customer_id = public.current_customer_id()));

create policy invoices_client_select on public.invoices for select to authenticated
  using (customer_id = public.current_customer_id() and status <> 'draft');

create policy payments_client_select on public.payments for select to authenticated
  using (invoice_id in (
    select id from public.invoices
    where customer_id = public.current_customer_id() and status <> 'draft'));

create policy tickets_client_select on public.support_tickets for select to authenticated
  using (customer_id = public.current_customer_id());
create policy tickets_client_insert on public.support_tickets for insert to authenticated
  with check (
    customer_id = public.current_customer_id()
    and business_id = public.current_business_id()
    and status = 'open' and assigned_to is null);

-- Clients never see internal notes.
create policy ticket_messages_client_select on public.ticket_messages for select to authenticated
  using (not is_internal and ticket_id in (
    select id from public.support_tickets where customer_id = public.current_customer_id()));
create policy ticket_messages_client_insert on public.ticket_messages for insert to authenticated
  with check (
    not is_internal and author_id = auth.uid()
    and business_id = public.current_business_id()
    and ticket_id in (
      select id from public.support_tickets where customer_id = public.current_customer_id()));

create policy ticket_attachments_client_select on public.ticket_attachments for select to authenticated
  using (ticket_id in (
    select id from public.support_tickets where customer_id = public.current_customer_id()));
create policy ticket_attachments_client_insert on public.ticket_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and business_id = public.current_business_id()
    and ticket_id in (
      select id from public.support_tickets where customer_id = public.current_customer_id()));

-- Staff tasks: managers+ manage all; staff see and update only their own -------
create policy tasks_manager_all on public.staff_tasks for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy tasks_staff_select on public.staff_tasks for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up() and assigned_to = auth.uid());
create policy tasks_staff_update on public.staff_tasks for update to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up() and assigned_to = auth.uid())
  with check (business_id = public.current_business_id() and assigned_to = auth.uid());

-- Notifications: strictly personal; created by server-side functions ----------
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- Communication logs: staff+ create and read; append-only ----------------------
create policy comm_logs_staff_select on public.communication_logs for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy comm_logs_staff_insert on public.communication_logs for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up());

-- Audit logs: managers+ read; written only by triggers below ------------------
create policy audit_select on public.audit_logs for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());

create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec record := case when tg_op = 'DELETE' then old else new end;
  biz uuid;
begin
  biz := case when tg_table_name = 'businesses' then rec.id else rec.business_id end;
  insert into public.audit_logs (business_id, actor_id, action, table_name, record_id)
  values (biz, auth.uid(), tg_op, tg_table_name, rec.id);
  return rec;
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'customers', 'invoices', 'payments', 'inventory_transactions']
  loop
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I
       for each row execute function public.audit_row_change()', t);
  end loop;
end $$;
