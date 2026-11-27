-- Search everything, the calendar, and Google Calendar as a personal integration. See
-- docs/CALENDAR.md. Run after 20261201000017_integrations.sql.

-- Search -------------------------------------------------------------------------------------------
-- One query for the top bar's search. Runs as the caller (security invoker), so every table's row
-- security applies: people only ever find what they may already see. At most five per kind.
create function public.search_everything(p_query text)
returns table (kind text, id uuid, title text, subtitle text, link text)
language plpgsql stable security invoker set search_path = public as $$
declare
  q text := left(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'), 100);
  pat text;
  num integer;
  digits text;
begin
  if char_length(q) < 2 then
    return;
  end if;
  -- The text is matched literally: % and _ are not wildcards here.
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- "ORD-00042", "LEAD 7", "TSK-12": a trailing number also finds the record with that number.
  num := nullif(substring(q from '(\d{1,9})\s*$'), '')::integer;
  -- Phone numbers are typed as 082 441 9082 and stored as +27 82 441 9082: match on the digits.
  digits := regexp_replace(q, '\D', '', 'g');
  digits := case when digits ~ '^0' then substr(digits, 2)
                 when digits ~ '^27' and char_length(digits) > 4 then substr(digits, 3)
                 else digits end;
  if char_length(digits) < 4 then
    digits := null;
  end if;

  return query
  (select 'customer'::text, c.id, c.name,
     concat_ws(' · ', nullif(c.company_name, c.name), c.email, c.phone), '/customers/' || c.id
   from customers c
   where c.erased_at is null
     and (c.name ilike pat or c.email ilike pat or c.company_name ilike pat
          or (digits is not null and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
   order by c.name limit 5)
  union all
  (select 'property', p.id, coalesce(p.name, p.address),
     concat_ws(' · ', p.reference, p.address, p.city), '/properties/' || p.id
   from properties p
   where p.name ilike pat or p.address ilike pat or p.reference ilike pat or p.city ilike pat or p.suburb ilike pat
   order by p.name nulls last, p.address limit 5)
  union all
  (select 'meter', m.id, m.serial_number, concat_ws(' · ', pr.name, pr.address), '/electricity-meters/' || m.id
   from electricity_meters m left join properties pr on pr.id = m.property_id
   where m.serial_number ilike pat
   order by m.serial_number limit 5)
  union all
  (select 'lead', l.id, coalesce(l.company_name, l.name),
     concat_ws(' · ', 'LEAD-' || lpad(l.number::text, 5, '0'), nullif(l.name, coalesce(l.company_name, l.name)), l.email),
     '/leads/' || l.id
   from leads l
   where l.name ilike pat or l.company_name ilike pat or l.email ilike pat or l.number = num
   order by l.created_at desc limit 5)
  union all
  (select 'order', o.id, 'ORD-' || lpad(o.number::text, 5, '0'), cu.name, '/sales-orders/' || o.id
   from orders o left join customers cu on cu.id = o.customer_id
   where o.number = num
   order by o.created_at desc limit 5)
  union all
  (select 'invoice', i.id, coalesce(i.invoice_number, 'Draft invoice'), cu.name, '/invoices/' || i.id
   from invoices i left join customers cu on cu.id = i.customer_id
   where i.invoice_number ilike pat
   order by i.created_at desc limit 5)
  union all
  (select 'ticket', t.id, t.reference || ' ' || t.subject, cu.name, '/support-tickets/' || t.id
   from support_tickets t left join customers cu on cu.id = t.customer_id
   where t.reference ilike pat or t.subject ilike pat
   order by t.created_at desc limit 5)
  union all
  (select 'product', pd.id, pd.name, pd.sku, '/inventory/' || pd.id
   from products pd
   where pd.name ilike pat or pd.sku ilike pat
   order by pd.name limit 5)
  union all
  (select 'task', tk.id, tk.title, 'TSK-' || lpad(tk.number::text, 5, '0'), '/tasks/' || tk.id
   from staff_tasks tk
   where tk.title ilike pat or tk.number = num
   order by tk.created_at desc limit 5)
  union all
  (select 'person', pf.id, coalesce(pf.full_name, pf.email), pf.email, '/team/' || pf.id
   from profiles pf
   where pf.role <> 'client' and pf.is_active and (pf.full_name ilike pat or pf.email ilike pat)
   order by pf.full_name limit 5);
end;
$$;
revoke execute on function public.search_everything(text) from public, anon;
grant execute on function public.search_everything(text) to authenticated;

-- Google Calendar: a personal connection -------------------------------------------------------------
-- Business connections (email, SMS, social) belong to the business. A calendar belongs to a person:
-- each team member connects their own, and only they (or an administrator) see or change it.
create or replace function public.integration_channel(p_provider text) returns text
language sql immutable as $$
  select case p_provider
    when 'resend' then 'email' when 'google' then 'email' when 'microsoft' then 'email'
    when 'twilio' then 'sms' when 'whatsapp' then 'whatsapp'
    when 'facebook' then 'facebook' when 'instagram' then 'instagram' when 'linkedin' then 'linkedin'
    when 'google_calendar' then 'calendar'
  end
$$;

alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations drop constraint integrations_capabilities_check;
alter table public.integrations
  add constraint integrations_provider_check check (provider in (
    'resend', 'google', 'microsoft', 'twilio', 'whatsapp', 'facebook', 'instagram', 'linkedin',
    'google_calendar')),
  add constraint integrations_capabilities_check check (capabilities <@ array[
    'send_email', 'direct_message', 'attachments', 'document_links', 'publish_social',
    'receive_messages', 'delivery_tracking', 'calendar_events']::text[]),
  add column profile_id uuid,
  add constraint integrations_profile_fkey foreign key (profile_id, business_id)
    references public.profiles (id, business_id) on delete cascade,
  -- Personal providers always have an owner; business providers never do.
  add constraint integrations_personal_owner check ((provider = 'google_calendar') = (profile_id is not null)),
  add constraint integrations_personal_not_default check (not (is_default and profile_id is not null));

drop index public.integrations_one_live;
create unique index integrations_one_live on public.integrations (business_id, provider)
  where status <> 'disconnected' and profile_id is null;
create unique index integrations_one_personal on public.integrations (profile_id, provider)
  where status <> 'disconnected' and profile_id is not null;

drop policy integrations_staff_select on public.integrations;
create policy integrations_staff_select on public.integrations for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up()
         and (profile_id is null or profile_id = auth.uid() or public.is_admin()));

alter table public.integration_oauth_states drop constraint integration_oauth_states_provider_check;
alter table public.integration_oauth_states add constraint integration_oauth_states_provider_check
  check (provider in ('google', 'microsoft', 'facebook', 'instagram', 'linkedin', 'google_calendar'));

-- Calendar events --------------------------------------------------------------------------------------
-- Appointments made in Umbane: site visits, installations, meetings. Tasks, maintenance and invoice
-- due dates appear on the calendar too, from their own tables (calendar_feed below).
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 150),
  kind text not null default 'appointment'
    check (kind in ('appointment', 'site_visit', 'installation', 'meeting', 'reminder', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text check (char_length(location) <= 300),
  description text check (char_length(description) <= 2000),
  -- Who made it, and who it is for (the same person unless chosen).
  owner_id uuid not null,
  assigned_to uuid,
  customer_id uuid,
  property_id uuid,
  ticket_id uuid,
  task_id uuid,
  lead_id uuid,
  -- The copy in a person's Google Calendar (written by the server only).
  google_event_id text check (char_length(google_event_id) <= 1024),
  google_calendar_owner uuid references public.profiles (id) on delete set null,
  google_html_link text check (char_length(google_html_link) <= 2000 and google_html_link ~ '^https://'),
  google_synced_at timestamptz,
  google_error text check (char_length(google_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_id_business_key unique (id, business_id),
  constraint calendar_events_ends_after_start check (ends_at > starts_at),
  constraint calendar_events_length check (ends_at - starts_at <= interval '31 days'),
  constraint calendar_events_owner_fkey foreign key (owner_id, business_id)
    references public.profiles (id, business_id) on delete cascade,
  constraint calendar_events_assignee_fkey foreign key (assigned_to, business_id)
    references public.profiles (id, business_id) on delete set null (assigned_to),
  constraint calendar_events_customer_fkey foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete set null (customer_id),
  constraint calendar_events_property_fkey foreign key (property_id, business_id)
    references public.properties (id, business_id) on delete set null (property_id),
  constraint calendar_events_ticket_fkey foreign key (ticket_id, business_id)
    references public.support_tickets (id, business_id) on delete set null (ticket_id),
  constraint calendar_events_task_fkey foreign key (task_id, business_id)
    references public.staff_tasks (id, business_id) on delete set null (task_id),
  constraint calendar_events_lead_fkey foreign key (lead_id, business_id)
    references public.leads (id, business_id) on delete set null (lead_id)
);
create index calendar_events_business_start_idx on public.calendar_events (business_id, starts_at);
create index calendar_events_assignee_idx on public.calendar_events (assigned_to, starts_at);
create trigger set_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.calendar_events
  for each row execute function public.audit_row_change();

-- The organiser is whoever made it; links must fit together; the Google fields are the server's.
create function public.check_calendar_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  person boolean := auth.uid() is not null;
  pr properties;
  tk support_tickets;
begin
  if tg_op = 'INSERT' then
    if person then
      new.owner_id := auth.uid();
    end if;
    new.assigned_to := coalesce(new.assigned_to, new.owner_id);
  else
    if new.business_id <> old.business_id then
      raise exception 'business_id cannot be changed';
    end if;
    new.owner_id := old.owner_id;
  end if;
  if person then
    if tg_op = 'INSERT' then
      new.google_event_id := null;
      new.google_calendar_owner := null;
      new.google_html_link := null;
      new.google_synced_at := null;
      new.google_error := null;
    else
      new.google_event_id := old.google_event_id;
      new.google_calendar_owner := old.google_calendar_owner;
      new.google_html_link := old.google_html_link;
      new.google_synced_at := old.google_synced_at;
      new.google_error := old.google_error;
    end if;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from profiles where id = new.assigned_to and business_id = new.business_id
      and is_active and role <> 'client') then
    raise exception 'calendar_assignee_invalid' using errcode = '23514';
  end if;
  -- A property or ticket brings its customer; a customer given with them must match.
  if new.property_id is not null then
    select * into pr from properties where id = new.property_id and business_id = new.business_id;
    if new.customer_id is not null and new.customer_id <> pr.customer_id then
      raise exception 'calendar_link_mismatch' using errcode = '23514';
    end if;
    new.customer_id := coalesce(new.customer_id, pr.customer_id);
  end if;
  if new.ticket_id is not null then
    select * into tk from support_tickets where id = new.ticket_id and business_id = new.business_id;
    if new.customer_id is not null and new.customer_id <> tk.customer_id then
      raise exception 'calendar_link_mismatch' using errcode = '23514';
    end if;
    new.customer_id := coalesce(new.customer_id, tk.customer_id);
  end if;
  -- An all-day event covers whole South African days.
  if new.all_day then
    new.starts_at := ((new.starts_at at time zone 'Africa/Johannesburg')::date)::timestamp
      at time zone 'Africa/Johannesburg';
    new.ends_at := greatest(
      ((new.ends_at at time zone 'Africa/Johannesburg')::date)::timestamp at time zone 'Africa/Johannesburg',
      new.starts_at + interval '1 day');
  end if;
  return new;
end;
$$;
revoke execute on function public.check_calendar_event() from public, anon, authenticated;
create trigger check_calendar_event before insert or update on public.calendar_events
  for each row execute function public.check_calendar_event();

alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon;
create policy calendar_events_staff_select on public.calendar_events for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy calendar_events_staff_insert on public.calendar_events for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up());
-- The organiser, the person it is for, or a manager.
create policy calendar_events_change on public.calendar_events for update to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up()
         and (owner_id = auth.uid() or assigned_to = auth.uid() or public.is_manager_up()))
  with check (business_id = public.current_business_id() and public.is_staff_up());
create policy calendar_events_delete on public.calendar_events for delete to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up()
         and (owner_id = auth.uid() or assigned_to = auth.uid() or public.is_manager_up()));

-- Everything dated, for one stretch of the calendar (at most 93 days). Runs as the caller, so
-- each source's row security applies: staff see the tasks they may see, and so on.
create function public.calendar_feed(p_from timestamptz, p_to timestamptz)
returns table (source text, id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  all_day boolean, kind text, link text, detail text, assigned_to uuid, assigned_name text,
  owner_id uuid, customer_id uuid, customer_name text, location text, description text,
  property_id uuid, ticket_id uuid, google_event_id text, google_calendar_owner uuid,
  google_html_link text, google_error text)
language plpgsql stable security invoker set search_path = public as $$
declare
  first_day date := (p_from at time zone 'Africa/Johannesburg')::date;
  last_day date := (p_to at time zone 'Africa/Johannesburg')::date;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days' then
    raise exception 'calendar_range' using errcode = '23514';
  end if;
  return query
  select 'event'::text, e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.kind, '/calendar'::text,
    concat_ws(' · ', cu.name, e.location), e.assigned_to, ap.full_name, e.owner_id, e.customer_id,
    cu.name, e.location, e.description, e.property_id, e.ticket_id, e.google_event_id,
    e.google_calendar_owner, e.google_html_link, e.google_error
  from calendar_events e
  left join customers cu on cu.id = e.customer_id
  left join profiles ap on ap.id = e.assigned_to
  where e.starts_at < p_to and e.ends_at > p_from
  union all
  select 'task', t.id, t.title,
    (t.due_date::timestamp at time zone 'Africa/Johannesburg'),
    ((t.due_date + 1)::timestamp at time zone 'Africa/Johannesburg'), true, t.category,
    '/tasks/' || t.id, 'TSK-' || lpad(t.number::text, 5, '0'), t.assigned_to, ap.full_name, null,
    t.customer_id, cu.name, null, null, t.property_id, t.ticket_id, null, null, null, null
  from staff_tasks t
  left join customers cu on cu.id = t.customer_id
  left join profiles ap on ap.id = t.assigned_to
  where t.due_date between first_day and last_day and t.status in ('todo', 'in_progress')
  union all
  select 'maintenance', w.id, initcap(w.kind) || ': ' || m.serial_number,
    (w.scheduled_for::timestamp at time zone 'Africa/Johannesburg'),
    ((w.scheduled_for + 1)::timestamp at time zone 'Africa/Johannesburg'), true, w.kind,
    '/electricity-meters/' || w.meter_id, 'MNT-' || lpad(w.number::text, 5, '0'), w.assigned_to,
    ap.full_name, null, pr.customer_id, cu.name, pr.address, w.issue, pr.id, null, null, null, null, null
  from meter_maintenance w
  join electricity_meters m on m.id = w.meter_id
  left join properties pr on pr.id = m.property_id
  left join customers cu on cu.id = pr.customer_id
  left join profiles ap on ap.id = w.assigned_to
  where w.scheduled_for between first_day and last_day and w.status in ('scheduled', 'pending', 'in_progress')
  union all
  select 'invoice', i.id, coalesce(i.invoice_number, 'Invoice') || ' due',
    (i.due_date::timestamp at time zone 'Africa/Johannesburg'),
    ((i.due_date + 1)::timestamp at time zone 'Africa/Johannesburg'), true, i.status,
    '/invoices/' || i.id, 'R ' || to_char(i.total, 'FM999G999G990D00'), null, null, null,
    i.customer_id, cu.name, null, null, null, null, null, null, null, null
  from invoices i
  left join customers cu on cu.id = i.customer_id
  where i.due_date between first_day and last_day and i.status in ('sent', 'partially_paid');
end;
$$;
revoke execute on function public.calendar_feed(timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_feed(timestamptz, timestamptz) to authenticated;
