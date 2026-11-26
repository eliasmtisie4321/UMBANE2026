-- Phase 8: customer support and tickets. The rules are explained in docs/SUPPORT.md.
--
-- Clients open tickets for themselves, follow them and reply. Staff and above assign, reply, write
-- internal notes and move tickets through Open -> Assigned -> In Progress -> Resolved -> Closed.
-- History and notifications are written here, by the database, so nobody signed in can fake them.

-- Links include the business, so a ticket cannot point at another business's records ------------
alter table public.support_tickets add constraint tickets_id_business_key unique (id, business_id);

alter table public.support_tickets drop constraint support_tickets_customer_id_fkey;
alter table public.support_tickets add constraint tickets_customer_fkey
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete restrict;
alter table public.support_tickets drop constraint support_tickets_property_id_fkey;
alter table public.support_tickets add constraint tickets_property_fkey
  foreign key (property_id, business_id) references public.properties (id, business_id)
  on delete set null (property_id);
alter table public.support_tickets drop constraint support_tickets_assigned_to_fkey;
alter table public.support_tickets add constraint tickets_assignee_fkey
  foreign key (assigned_to, business_id) references public.profiles (id, business_id)
  on delete set null (assigned_to);

alter table public.ticket_messages drop constraint ticket_messages_ticket_id_fkey;
alter table public.ticket_messages add constraint ticket_messages_ticket_fkey
  foreign key (ticket_id, business_id) references public.support_tickets (id, business_id) on delete cascade;
alter table public.ticket_attachments drop constraint ticket_attachments_ticket_id_fkey;
alter table public.ticket_attachments add constraint ticket_attachments_ticket_fkey
  foreign key (ticket_id, business_id) references public.support_tickets (id, business_id) on delete cascade;

alter table public.support_tickets alter column business_id set default public.current_business_id();
alter table public.ticket_messages alter column business_id set default public.current_business_id();
alter table public.ticket_attachments alter column business_id set default public.current_business_id();

-- Ticket fields ----------------------------------------------------------------------------------
alter table public.support_tickets
  add column number integer,
  add column meter_id uuid,
  add column created_by uuid,
  add column resolution text,
  add column assigned_at timestamptz,
  add column status_changed_at timestamptz not null default now(),
  add column first_response_at timestamptz,
  add column resolved_at timestamptz,
  add column closed_at timestamptz,
  add column last_activity_at timestamptz not null default now(),
  add constraint tickets_meter_fkey foreign key (meter_id, business_id)
    references public.electricity_meters (id, business_id) on delete set null (meter_id),
  add constraint tickets_created_by_fkey foreign key (created_by, business_id)
    references public.profiles (id, business_id) on delete set null (created_by),
  add constraint tickets_subject_length check (char_length(subject) <= 150),
  add constraint tickets_description_length check (char_length(description) <= 5000),
  add constraint tickets_resolution_length check (char_length(resolution) <= 2000);

update public.support_tickets set category = 'general'
  where category is null
     or category not in ('meter_fault', 'telemetry', 'prepaid_token', 'billing', 'installation', 'general');
alter table public.support_tickets
  alter column category set default 'general',
  alter column category set not null,
  add constraint tickets_category_check
    check (category in ('meter_fault', 'telemetry', 'prepaid_token', 'billing', 'installation', 'general'));

create index tickets_assignee_idx on public.support_tickets (assigned_to) where assigned_to is not null;
create index tickets_status_idx on public.support_tickets (business_id, status);

-- One counter per business per year: TKT-2026-00001, TKT-2026-00002, ...
create table public.ticket_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  year integer not null,
  last_number integer not null,
  primary key (business_id, year)
);
alter table public.ticket_counters enable row level security;
revoke all on public.ticket_counters from anon, authenticated;

-- Messages keep the author's name and side as written, so clients can see who replied without
-- being able to read staff profiles.
alter table public.ticket_messages
  add column author_name text,
  add column from_staff boolean not null default false,
  add constraint ticket_messages_body_length check (char_length(body) <= 5000);
update public.ticket_messages m set author_name = p.full_name, from_staff = p.role <> 'client'
  from public.profiles p where p.id = m.author_id;

-- Attachments: files live in the private "ticket-attachments" storage bucket at
-- <business id>/<ticket id>/<file>. Only these types, up to 10 MB each and 20 per ticket.
alter table public.ticket_attachments
  add column uploader_name text,
  alter column content_type set not null,
  alter column size_bytes set not null,
  add constraint ticket_attachments_name_length check (char_length(file_name) between 1 and 200),
  add constraint ticket_attachments_type_check check (content_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'text/plain')),
  add constraint ticket_attachments_size_check check (size_bytes between 1 and 10485760),
  add constraint ticket_attachments_path_key unique (storage_path);

-- History: status, assignment and priority changes, written by the database only --------------
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  ticket_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'assigned', 'priority', 'attachment')),
  from_value text,
  to_value text,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint ticket_events_ticket_fkey foreign key (ticket_id, business_id)
    references public.support_tickets (id, business_id) on delete cascade
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);
alter table public.ticket_events enable row level security;
revoke insert, update, delete, truncate on public.ticket_events from anon, authenticated;
create policy ticket_events_staff_select on public.ticket_events for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
-- Clients follow progress, but assignment and priority changes are the team's business.
create policy ticket_events_client_select on public.ticket_events for select to authenticated
  using (kind in ('created', 'status', 'attachment') and ticket_id in (
    select id from public.support_tickets where customer_id = public.current_customer_id()));

-- Notifications link to the page they are about.
alter table public.notifications
  add column link text check (link ~ '^/[A-Za-z0-9/_-]*$');

-- Helpers ----------------------------------------------------------------------------------------
-- Staff of the ticket's business, or the client the ticket belongs to. Server code (no auth.uid())
-- is trusted. Raised before any other rule so errors never reveal other businesses' records.
create function public.assert_ticket_caller(p_business_id uuid, p_customer_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_business_id is distinct from current_business_id()
     or not (is_staff_up()
             or (current_customer_id() is not null and p_customer_id = current_customer_id())) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;

create function public.assert_ticket_assignee(p_profile_id uuid, p_business_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_profile_id is not null and not exists (
    select 1 from profiles
    where id = p_profile_id and business_id = p_business_id and role <> 'client' and is_active
  ) then
    raise exception 'assignee_not_staff' using errcode = '23514';
  end if;
end;
$$;

-- In-app notifications. Nobody is notified about their own action, and inactive users are skipped.
create function public.notify_user(
  p_user uuid, p_business_id uuid, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then
    return;
  end if;
  insert into notifications (business_id, user_id, title, body, link)
  select p_business_id, id, p_title, left(p_body, 300), p_link
  from profiles where id = p_user and business_id = p_business_id and is_active;
end;
$$;

create function public.notify_managers(
  p_business_id uuid, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (business_id, user_id, title, body, link)
  select p_business_id, id, p_title, left(p_body, 300), p_link
  from profiles
  where business_id = p_business_id and is_active and role in ('administrator', 'manager')
    and id is distinct from auth.uid();
end;
$$;

create function public.ticket_status_label(p_status text) returns text
language sql immutable as $$
  select initcap(replace(p_status, '_', ' '))
$$;

revoke execute on function
  public.assert_ticket_caller(uuid, uuid), public.assert_ticket_assignee(uuid, uuid),
  public.notify_user(uuid, uuid, text, text, text), public.notify_managers(uuid, text, text, text)
from public, anon, authenticated;

-- Ticket rules -----------------------------------------------------------------------------------
create function public.check_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := auth.uid() is null or is_staff_up();
  seq integer;
  owner_id uuid;
  meter_property uuid;
begin
  if tg_op = 'INSERT' then
    -- A client's ticket is always their own; the team sets priority and assignment.
    if not is_staff then
      new.customer_id := coalesce(new.customer_id, current_customer_id());
    end if;
    perform assert_ticket_caller(new.business_id, new.customer_id);
    if not is_staff then
      new.priority := 'normal';
      new.assigned_to := null;
    end if;
    perform assert_ticket_assignee(new.assigned_to, new.business_id);
    if auth.uid() is not null and nullif(trim(coalesce(new.description, '')), '') is null then
      raise exception 'ticket_description_required' using errcode = '23514';
    end if;
    new.status := case when new.assigned_to is null then 'open' else 'assigned' end;
    new.assigned_at := case when new.assigned_to is null then null else now() end;
    new.resolution := null;
    new.first_response_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.status_changed_at := now();
    new.last_activity_at := now();
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    if auth.uid() is not null or new.reference is null then
      insert into ticket_counters (business_id, year, last_number)
      values (new.business_id, extract(year from business_today())::integer, 1)
      on conflict (business_id, year) do update set last_number = ticket_counters.last_number + 1
      returning last_number into seq;
      new.number := seq;
      new.reference := 'TKT-' || extract(year from business_today())::integer || '-'
        || lpad(seq::text, 5, '0');
    end if;
  else
    -- UPDATE. A direct write is staff only; nested writes come from this file's own triggers or
    -- from a linked record being deleted.
    if pg_trigger_depth() < 2 and auth.uid() is not null
       and not (is_staff_up() and old.business_id = current_business_id()) then
      raise exception 'permission denied' using errcode = '42501';
    end if;
    if new.business_id <> old.business_id or new.customer_id <> old.customer_id
       or new.number is distinct from old.number or new.reference <> old.reference
       or new.created_at <> old.created_at
       or (new.created_by is distinct from old.created_by and new.created_by is not null) then
      raise exception 'ticket_fixed_fields' using errcode = '23514';
    end if;
    if old.status = 'closed' then
      if pg_trigger_depth() < 2 then
        raise exception 'ticket_closed' using errcode = '23514';
      end if;
      return new;
    end if;

    -- Timestamps are the database's.
    new.assigned_at := old.assigned_at;
    new.status_changed_at := old.status_changed_at;
    new.resolved_at := old.resolved_at;
    new.closed_at := old.closed_at;
    if pg_trigger_depth() < 2 then
      new.first_response_at := old.first_response_at;
    end if;
    new.last_activity_at := now();

    if new.assigned_to is distinct from old.assigned_to then
      perform assert_ticket_assignee(new.assigned_to, new.business_id);
      new.assigned_at := case when new.assigned_to is null then null else now() end;
      -- Assigning or unassigning moves the status along unless a status was chosen as well.
      if new.status = old.status then
        if new.assigned_to is null and new.status in ('assigned', 'in_progress') then
          new.status := 'open';
        elsif new.assigned_to is not null and new.status = 'open' then
          new.status := 'assigned';
        end if;
      end if;
    end if;

    if new.status <> old.status then
      if new.status in ('assigned', 'in_progress') and new.assigned_to is null then
        raise exception 'ticket_needs_assignee' using errcode = '23514';
      end if;
      if new.status = 'open' and new.assigned_to is not null then
        raise exception 'ticket_open_assigned' using errcode = '23514';
      end if;
      if new.status in ('resolved', 'closed')
         and nullif(trim(coalesce(new.resolution, '')), '') is null then
        raise exception 'ticket_resolution_required' using errcode = '23514';
      end if;
      new.status_changed_at := now();
      if new.status = 'resolved' then
        new.resolved_at := now();
      elsif new.status = 'closed' then
        new.closed_at := now();
      else
        new.resolved_at := null;
      end if;
    end if;

    if auth.uid() is not null and new.description is distinct from old.description
       and nullif(trim(coalesce(new.description, '')), '') is null then
      raise exception 'ticket_description_required' using errcode = '23514';
    end if;
    if new.property_id is not distinct from old.property_id
       and new.meter_id is not distinct from old.meter_id then
      return new;
    end if;
  end if;

  -- The property and meter must be the customer's, and the meter must be at the property.
  if new.property_id is not null then
    select customer_id into owner_id from properties
    where id = new.property_id and business_id = new.business_id;
    if owner_id is distinct from new.customer_id then
      raise exception 'ticket_property_mismatch' using errcode = '23514';
    end if;
  end if;
  if new.meter_id is not null then
    select p.customer_id, m.property_id into owner_id, meter_property
    from electricity_meters m join properties p on p.id = m.property_id
    where m.id = new.meter_id and m.business_id = new.business_id;
    if owner_id is distinct from new.customer_id
       or (new.property_id is not null and meter_property is distinct from new.property_id) then
      raise exception 'ticket_meter_mismatch' using errcode = '23514';
    end if;
    new.property_id := meter_property;
  end if;
  return new;
end;
$$;
create trigger check_ticket before insert or update on public.support_tickets
  for each row execute function public.check_ticket();

create function public.after_ticket_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_name text := (select full_name from profiles where id = auth.uid());
  client_user uuid := (select profile_id from customers where id = new.customer_id);
  link text := '/support-tickets/' || new.id;
  summary text := new.reference || ': ' || new.subject;
begin
  if tg_op = 'INSERT' then
    insert into ticket_events (business_id, ticket_id, kind, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'created', new.status, auth.uid(), actor_name);
    if new.assigned_to is not null then
      perform notify_user(new.assigned_to, new.business_id, 'Ticket assigned to you', summary, link);
    else
      perform notify_managers(new.business_id, 'New support ticket', summary, link);
    end if;
    -- Opened by the team on the customer's behalf.
    perform notify_user(client_user, new.business_id, 'Support ticket opened', summary, link);
    return null;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into ticket_events (business_id, ticket_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'assigned',
      (select full_name from profiles where id = old.assigned_to),
      (select full_name from profiles where id = new.assigned_to), auth.uid(), actor_name);
    perform notify_user(new.assigned_to, new.business_id, 'Ticket assigned to you', summary, link);
  end if;
  if new.status <> old.status then
    insert into ticket_events (business_id, ticket_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'status', old.status, new.status, auth.uid(), actor_name);
    perform notify_user(client_user, new.business_id,
      new.reference || ' is now ' || ticket_status_label(new.status), new.subject, link);
  end if;
  if new.priority <> old.priority then
    insert into ticket_events (business_id, ticket_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'priority', old.priority, new.priority, auth.uid(), actor_name);
  end if;
  return null;
end;
$$;
create trigger after_ticket_change after insert or update on public.support_tickets
  for each row execute function public.after_ticket_change();

-- Messages ---------------------------------------------------------------------------------------
create function public.check_ticket_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tk support_tickets;
  author profiles;
begin
  select * into tk from support_tickets where id = new.ticket_id for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform assert_ticket_caller(tk.business_id, tk.customer_id);
  new.business_id := tk.business_id;
  if auth.uid() is not null then
    new.author_id := auth.uid();
    new.created_at := now();
  end if;
  select * into author from profiles where id = new.author_id;
  new.author_name := author.full_name;
  new.from_staff := author.role <> 'client';
  if new.is_internal and not new.from_staff then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if tk.status = 'closed' then
    raise exception 'ticket_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_ticket_message before insert on public.ticket_messages
  for each row execute function public.check_ticket_message();

create function public.after_ticket_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tk support_tickets;
  link text;
  preview text := left(new.body, 140);
begin
  -- A customer replying to a resolved ticket reopens it.
  update support_tickets set
    first_response_at = case when new.from_staff and not new.is_internal
                          then coalesce(first_response_at, now()) else first_response_at end,
    status = case when not new.from_staff and status = 'resolved'
               then case when assigned_to is null then 'open' else 'in_progress' end
               else status end
  where id = new.ticket_id
  returning * into tk;

  link := '/support-tickets/' || tk.id;
  if new.is_internal then
    perform notify_user(tk.assigned_to, tk.business_id, 'Internal note on ' || tk.reference, preview, link);
  elsif new.from_staff then
    perform notify_user((select profile_id from customers where id = tk.customer_id), tk.business_id,
      'New reply on ' || tk.reference, preview, link);
    perform notify_user(tk.assigned_to, tk.business_id, 'Reply on ' || tk.reference, preview, link);
  elsif tk.assigned_to is not null then
    perform notify_user(tk.assigned_to, tk.business_id, 'Customer replied on ' || tk.reference, preview, link);
  else
    perform notify_managers(tk.business_id, 'Customer replied on ' || tk.reference, preview, link);
  end if;
  return null;
end;
$$;
create trigger after_ticket_message after insert on public.ticket_messages
  for each row execute function public.after_ticket_message();

-- Attachments ------------------------------------------------------------------------------------
create function public.check_ticket_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tk support_tickets;
  stored jsonb;
  prefix text;
begin
  select * into tk from support_tickets where id = new.ticket_id for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform assert_ticket_caller(tk.business_id, tk.customer_id);
  new.business_id := tk.business_id;
  if auth.uid() is not null then
    new.uploaded_by := auth.uid();
    new.created_at := now();
  end if;
  new.uploader_name := (select full_name from profiles where id = new.uploaded_by);
  if tk.status = 'closed' then
    raise exception 'ticket_closed' using errcode = '23514';
  end if;
  if (select count(*) from ticket_attachments where ticket_id = tk.id) >= 20 then
    raise exception 'ticket_attachment_limit' using errcode = '23514';
  end if;
  prefix := tk.business_id || '/' || tk.id || '/';
  if left(new.storage_path, length(prefix)) <> prefix
     or length(new.storage_path) = length(prefix)
     or position('/' in substr(new.storage_path, length(prefix) + 1)) > 0 then
    raise exception 'attachment_path_mismatch' using errcode = '23514';
  end if;
  -- The file must really have been uploaded; its stored size and type win over what was sent.
  select metadata into stored from storage.objects
  where bucket_id = 'ticket-attachments' and name = new.storage_path;
  if not found then
    raise exception 'attachment_not_uploaded' using errcode = '23514';
  end if;
  new.size_bytes := coalesce((stored ->> 'size')::integer, new.size_bytes);
  new.content_type := coalesce(stored ->> 'mimetype', new.content_type);
  return new;
end;
$$;
create trigger check_ticket_attachment before insert on public.ticket_attachments
  for each row execute function public.check_ticket_attachment();

create function public.after_ticket_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into ticket_events (business_id, ticket_id, kind, to_value, actor_id, actor_name)
  values (new.business_id, new.ticket_id, 'attachment', new.file_name, new.uploaded_by, new.uploader_name);
  update support_tickets set last_activity_at = now() where id = new.ticket_id;
  return null;
end;
$$;
create trigger after_ticket_attachment after insert on public.ticket_attachments
  for each row execute function public.after_ticket_attachment();

revoke execute on function
  public.check_ticket(), public.after_ticket_change(), public.check_ticket_message(),
  public.after_ticket_message(), public.check_ticket_attachment(), public.after_ticket_attachment()
from public, anon, authenticated;

-- Removing tickets, messages or files is for managers; keep a record of who did it.
create trigger audit_row_change after delete on public.support_tickets
  for each row execute function public.audit_row_change();
create trigger audit_row_change after delete on public.ticket_messages
  for each row execute function public.audit_row_change();
create trigger audit_row_change after delete on public.ticket_attachments
  for each row execute function public.audit_row_change();

-- Storage: a private bucket, with the same access as the ticket the file belongs to --------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.ticket_file_access(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(p_name, '/');
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) <> 3 or parts[1] !~ uuid_re or parts[2] !~ uuid_re
     or parts[3] = '' then
    return false;
  end if;
  return exists (
    select 1 from support_tickets t
    where t.id = parts[2]::uuid and t.business_id = parts[1]::uuid
      and t.business_id = current_business_id()
      and (is_staff_up() or (current_customer_id() is not null and t.customer_id = current_customer_id()))
      and (not p_write or t.status <> 'closed'));
end;
$$;
revoke execute on function public.ticket_file_access(text, boolean) from public, anon;
grant execute on function public.ticket_file_access(text, boolean) to authenticated;

create policy umbane_ticket_files_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and public.ticket_file_access(name, false));
create policy umbane_ticket_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and public.ticket_file_access(name, true));
create policy umbane_ticket_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and public.is_manager_up()
         and public.ticket_file_access(name, false));

-- Views (they obey the caller's row security) ---------------------------------------------------
create view public.ticket_list with (security_invoker = true) as
select
  t.id, t.number, t.reference, t.subject, t.category, t.description, t.status, t.priority,
  t.customer_id, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
  t.property_id, coalesce(p.name, p.address) as property_name, p.address as property_address,
  t.meter_id, m.serial_number as meter_serial,
  t.assigned_to, a.full_name as assignee_name, t.resolution,
  t.created_at, t.updated_at, t.assigned_at, t.status_changed_at, t.first_response_at,
  t.resolved_at, t.closed_at, t.last_activity_at,
  t.status in ('open', 'assigned', 'in_progress') as is_open,
  (select count(*) from ticket_messages tm where tm.ticket_id = t.id)::integer as message_count,
  (select count(*) from ticket_attachments ta where ta.ticket_id = t.id)::integer as attachment_count
from public.support_tickets t
join public.customers c on c.id = t.customer_id
left join public.properties p on p.id = t.property_id
left join public.electricity_meters m on m.id = t.meter_id
left join public.profiles a on a.id = t.assigned_to;

create view public.ticket_summary with (security_invoker = true) as
select
  count(*)::integer as total,
  count(*) filter (where status = 'open')::integer as open,
  count(*) filter (where status = 'assigned')::integer as assigned,
  count(*) filter (where status = 'in_progress')::integer as in_progress,
  count(*) filter (where status = 'resolved')::integer as resolved,
  count(*) filter (where status = 'closed')::integer as closed,
  count(*) filter (where priority = 'urgent' and status in ('open', 'assigned', 'in_progress'))::integer
    as urgent_open
from public.support_tickets;

-- Active tickets per team member, for choosing whom to assign.
create view public.ticket_workload with (security_invoker = true) as
select
  p.id, p.full_name, p.role,
  count(t.id) filter (where t.status in ('assigned', 'in_progress'))::integer as active_tickets,
  count(t.id) filter (where t.status in ('assigned', 'in_progress') and t.priority = 'urgent')::integer
    as urgent_tickets
from public.profiles p
left join public.support_tickets t on t.assigned_to = p.id
where p.role <> 'client' and p.is_active
group by p.id, p.full_name, p.role;

revoke all on public.ticket_list, public.ticket_summary, public.ticket_workload from anon;
grant select on public.ticket_list, public.ticket_summary, public.ticket_workload to authenticated;
