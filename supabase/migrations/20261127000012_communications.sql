-- Phase 10: communications. The rules are explained in docs/COMMUNICATIONS.md.
--
-- Email only, through Resend. Staff queue an email here; a Vercel function (holding the provider key
-- and the service-role key) claims it, sends it and records the result. Resend reports delivery,
-- bounces and complaints to a webhook, also recorded here. Nobody signed in can mark an email as
-- sent or delivered: only the server can.

-- Customer preferences -------------------------------------------------------------------------
alter table public.customers
  add column email_opt_out boolean not null default false,
  add column marketing_consent boolean not null default false,
  add column consent_updated_at timestamptz,
  add column consent_updated_by uuid references public.profiles (id) on delete set null,
  add column email_suppressed_at timestamptz,
  add column email_suppressed_reason text check (email_suppressed_reason in ('bounced', 'complained'));

-- Who changed a preference and when is recorded; a new address clears an old bounce.
create function public.track_customer_consent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_opt_out is distinct from old.email_opt_out
     or new.marketing_consent is distinct from old.marketing_consent then
    new.consent_updated_at := now();
    new.consent_updated_by := auth.uid();
  else
    new.consent_updated_at := old.consent_updated_at;
    new.consent_updated_by := old.consent_updated_by;
  end if;
  if lower(trim(coalesce(new.email, ''))) is distinct from lower(trim(coalesce(old.email, ''))) then
    new.email_suppressed_at := null;
    new.email_suppressed_reason := null;
  elsif auth.uid() is not null then
    -- Only delivery reports, recorded by the server, suppress an address.
    new.email_suppressed_at := old.email_suppressed_at;
    new.email_suppressed_reason := old.email_suppressed_reason;
  end if;
  return new;
end;
$$;
create trigger track_customer_consent before update on public.customers
  for each row execute function public.track_customer_consent();

-- Templates ------------------------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(trim(name)) between 2 and 80),
  purpose text not null default 'transactional' check (purpose in ('transactional', 'marketing')),
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  is_active boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);
create trigger set_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();
alter table public.message_templates enable row level security;
revoke all on public.message_templates from anon;
create policy templates_staff_select on public.message_templates for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy templates_manager_insert on public.message_templates for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy templates_manager_update on public.message_templates for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy templates_manager_delete on public.message_templates for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());

create function public.stamp_template() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' and new.key <> old.key then
    raise exception 'template_key_fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger stamp_template before insert or update on public.message_templates
  for each row execute function public.stamp_template();

-- The starting templates every business gets. Placeholders are filled in by the app before sending.
create function public.seed_message_templates(p_business_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into message_templates (business_id, key, name, purpose, subject, body) values
  (p_business_id, 'invoice_issued', 'Invoice issued', 'transactional',
   'Invoice {{invoice_number}} from {{business_name}}',
   E'Good day {{customer_name}},\n\nPlease find attached invoice {{invoice_number}} for {{invoice_total}}, due {{due_date}}.\nBalance due: {{balance_due}}. Please use {{invoice_number}} as your payment reference.\n\nKind regards\n{{sender_name}}\n{{business_name}}'),
  (p_business_id, 'payment_reminder', 'Payment reminder', 'transactional',
   'Reminder: invoice {{invoice_number}} is due',
   E'Good day {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} has a balance of {{balance_due}}, due {{due_date}}. If you have already paid, thank you, and please ignore this message.\n\nKind regards\n{{sender_name}}\n{{business_name}}'),
  (p_business_id, 'ticket_update', 'Support ticket update', 'transactional',
   'Update on your support ticket {{ticket_reference}}',
   E'Good day {{customer_name}},\n\n{{message}}\n\nTicket {{ticket_reference}}: {{ticket_subject}}. You can follow it when you sign in to Umbane.\n\nKind regards\n{{sender_name}}\n{{business_name}}'),
  (p_business_id, 'general', 'General message', 'transactional',
   'A message from {{business_name}}',
   E'Good day {{customer_name}},\n\n{{message}}\n\nKind regards\n{{sender_name}}\n{{business_name}}')
  on conflict (business_id, key) do nothing
$$;
revoke execute on function public.seed_message_templates(uuid) from public, anon, authenticated;
select public.seed_message_templates(id) from public.businesses;

create function public.seed_business_templates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_message_templates(new.id);
  return null;
end;
$$;
create trigger seed_business_templates after insert on public.businesses
  for each row execute function public.seed_business_templates();

-- Messages: the communication history, now also the email outbox --------------------------------
alter table public.communication_logs drop constraint communication_logs_customer_id_fkey;
alter table public.communication_logs
  add constraint comm_logs_id_business_key unique (id, business_id),
  add constraint comm_logs_customer_fkey foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete set null (customer_id),
  add column recipient text check (recipient ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column template_key text,
  add column purpose text not null default 'transactional'
    check (purpose in ('transactional', 'marketing')),
  add column invoice_id uuid,
  add column ticket_id uuid,
  add column provider text,
  add column provider_message_id text unique,
  add column error text check (char_length(error) <= 500),
  add column attempts integer not null default 0 check (attempts between 0 and 10),
  add column next_attempt_at timestamptz,
  add column sent_at timestamptz,
  add column delivered_at timestamptz,
  add column last_event_at timestamptz,
  add column attachment_path text,
  add column attachment_name text check (char_length(attachment_name) <= 200),
  add constraint comm_logs_invoice_fkey foreign key (invoice_id, business_id)
    references public.invoices (id, business_id) on delete set null (invoice_id),
  add constraint comm_logs_ticket_fkey foreign key (ticket_id, business_id)
    references public.support_tickets (id, business_id) on delete set null (ticket_id),
  add constraint comm_logs_subject_length check (char_length(subject) <= 200),
  add constraint comm_logs_body_length check (char_length(body) <= 10000),
  add constraint comm_logs_status_check check (status in (
    'logged', 'queued', 'sending', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed',
    'cancelled')),
  add constraint comm_logs_email_has_recipient
    check (channel <> 'email' or direction <> 'outbound' or recipient is not null);
create index comm_logs_customer_idx on public.communication_logs (customer_id, created_at desc);
create index comm_logs_due_idx on public.communication_logs (next_attempt_at)
  where status in ('queued', 'failed');

-- Outgoing email only enters through queue_email(); people log calls, notes and other channels.
drop policy comm_logs_staff_insert on public.communication_logs;
create policy comm_logs_staff_insert on public.communication_logs for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up()
              and not (channel = 'email' and direction = 'outbound'));
alter table public.communication_logs alter column business_id set default public.current_business_id();

create function public.check_logged_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A contact logged by a person is a record of what happened: who, when, and nothing to send.
  if auth.uid() is not null and not (new.channel = 'email' and new.direction = 'outbound') then
    new.created_by := auth.uid();
    new.created_at := now();
    new.status := 'logged';
    new.recipient := null;
    new.provider := null;
    new.provider_message_id := null;
    new.attempts := 0;
    new.next_attempt_at := null;
    new.sent_at := null;
    new.delivered_at := null;
    new.attachment_path := null;
    if nullif(trim(coalesce(new.body, '')), '') is null then
      raise exception 'contact_note_required' using errcode = '23514';
    end if;
    if new.customer_id is not null and not exists (
      select 1 from customers where id = new.customer_id and business_id = new.business_id) then
      raise exception 'permission denied' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger check_logged_contact before insert on public.communication_logs
  for each row execute function public.check_logged_contact();

-- What the provider told us about each email.
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  message_id uuid not null,
  event text not null check (char_length(event) between 1 and 60),
  provider_event_id text unique,
  detail jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint message_events_message_fkey foreign key (message_id, business_id)
    references public.communication_logs (id, business_id) on delete cascade
);
create index message_events_message_idx on public.message_events (message_id, occurred_at);
alter table public.message_events enable row level security;
revoke all on public.message_events from anon;
revoke insert, update, delete, truncate on public.message_events from authenticated;
create policy message_events_staff_select on public.message_events for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());

-- Attachments for outgoing email (invoice PDFs), private, at <business id>/<message key>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.message_file_access(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(array_length(string_to_array(p_name, '/'), 1), 0) = 3
    and split_part(p_name, '/', 1) = current_business_id()::text
    and split_part(p_name, '/', 3) <> ''
    and is_staff_up()
$$;
revoke execute on function public.message_file_access(text) from public, anon;
grant execute on function public.message_file_access(text) to authenticated;
create policy umbane_message_files_select on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and public.message_file_access(name));
create policy umbane_message_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'message-attachments' and public.message_file_access(name));

-- Staff: queue, retry and cancel ----------------------------------------------------------------
-- Checks that this customer may be emailed for this purpose. Raises the reason if not.
create function public.assert_can_email(p_customer customers, p_purpose text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_customer.email is null or trim(p_customer.email) = '' then
    raise exception 'message_no_email' using errcode = '23514';
  end if;
  if p_customer.email_suppressed_at is not null then
    raise exception 'message_recipient_suppressed' using errcode = '23514';
  end if;
  if p_customer.email_opt_out then
    raise exception 'message_opted_out' using errcode = '23514';
  end if;
  if p_purpose = 'marketing' and not p_customer.marketing_consent then
    raise exception 'message_no_consent' using errcode = '23514';
  end if;
end;
$$;
revoke execute on function public.assert_can_email(customers, text) from public, anon, authenticated;

create function public.queue_email(
  p_customer_id uuid, p_subject text, p_body text,
  p_template_key text default null, p_purpose text default 'transactional',
  p_invoice_id uuid default null, p_ticket_id uuid default null,
  p_attachment_path text default null, p_attachment_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  biz uuid := current_business_id();
  c customers;
  new_id uuid;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into c from customers where id = p_customer_id and business_id = biz;
  if not found then
    raise exception 'message_customer_not_found' using errcode = '23514';
  end if;
  perform assert_can_email(c, p_purpose);
  if p_invoice_id is not null and not exists (
    select 1 from invoices where id = p_invoice_id and business_id = biz and customer_id = c.id) then
    raise exception 'message_link_mismatch' using errcode = '23514';
  end if;
  if p_ticket_id is not null and not exists (
    select 1 from support_tickets where id = p_ticket_id and business_id = biz and customer_id = c.id) then
    raise exception 'message_link_mismatch' using errcode = '23514';
  end if;
  if p_attachment_path is not null and (
       split_part(p_attachment_path, '/', 1) <> biz::text
       or not exists (select 1 from storage.objects
                      where bucket_id = 'message-attachments' and name = p_attachment_path)) then
    raise exception 'attachment_not_uploaded' using errcode = '23514';
  end if;
  insert into communication_logs (business_id, customer_id, channel, direction, subject, body, status,
    created_by, recipient, template_key, purpose, invoice_id, ticket_id, next_attempt_at,
    attachment_path, attachment_name)
  values (biz, c.id, 'email', 'outbound', trim(p_subject), trim(p_body), 'queued', auth.uid(),
    lower(trim(c.email)), p_template_key, p_purpose, p_invoice_id, p_ticket_id, now(),
    p_attachment_path, p_attachment_name)
  returning id into new_id;
  insert into message_events (business_id, message_id, event, detail)
  values (biz, new_id, 'queued', jsonb_build_object('by', auth.uid()));
  return new_id;
end;
$$;
revoke execute on function public.queue_email(uuid, text, text, text, text, uuid, uuid, text, text)
  from public, anon;
grant execute on function public.queue_email(uuid, text, text, text, text, uuid, uuid, text, text)
  to authenticated;

-- A failed email is tried again now, to the customer's current address.
create function public.retry_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  c customers;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into m from communication_logs
  where id = p_id and business_id = current_business_id() and channel = 'email'
    and direction = 'outbound'
  for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if m.status <> 'failed' then
    raise exception 'message_not_retryable' using errcode = '23514';
  end if;
  select * into c from customers where id = m.customer_id;
  if not found then
    raise exception 'message_customer_not_found' using errcode = '23514';
  end if;
  perform assert_can_email(c, m.purpose);
  update communication_logs set status = 'queued', attempts = 0, next_attempt_at = now(),
    recipient = lower(trim(c.email)), error = null, last_event_at = now()
  where id = p_id;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, 'retried', jsonb_build_object('by', auth.uid()));
end;
$$;

create function public.cancel_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into m from communication_logs
  where id = p_id and business_id = current_business_id() and channel = 'email'
    and direction = 'outbound'
  for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if m.status not in ('queued', 'failed') then
    raise exception 'message_not_cancellable' using errcode = '23514';
  end if;
  update communication_logs set status = 'cancelled', next_attempt_at = null, last_event_at = now()
  where id = p_id;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, 'cancelled', jsonb_build_object('by', auth.uid()));
end;
$$;
revoke execute on function public.retry_message(uuid), public.cancel_message(uuid) from public, anon;
grant execute on function public.retry_message(uuid), public.cancel_message(uuid) to authenticated;

-- Server only (service role): claim, record, and provider events ------------------------------------
-- At most this many tries; then the email waits for a person to retry it.
create function public.message_max_attempts() returns integer language sql immutable as $$ select 5 $$;

-- Takes an email for sending. Returns nothing if it is not due, already being sent, or no longer
-- allowed (the customer opted out or bounced since it was queued).
create function public.claim_message(p_id uuid) returns setof public.communication_logs
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  c customers;
begin
  select * into m from communication_logs
  where id = p_id and channel = 'email' and direction = 'outbound'
    and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  for update skip locked;
  if not found then
    return;
  end if;
  select * into c from customers where id = m.customer_id;
  begin
    perform assert_can_email(c, m.purpose);
  exception when others then
    update communication_logs set status = 'cancelled', next_attempt_at = null, error = sqlerrm,
      last_event_at = now() where id = p_id;
    insert into message_events (business_id, message_id, event, detail)
    values (m.business_id, p_id, 'cancelled', jsonb_build_object('reason', sqlerrm));
    return;
  end;
  return query
  update communication_logs set status = 'sending', attempts = attempts + 1, last_event_at = now()
  where id = p_id
  returning *;
end;
$$;

-- What happened when the server tried to send. A temporary failure is tried again later
-- (1, 5, 15, 60 minutes); a permanent one waits for a person.
create function public.record_message_result(
  p_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_retryable boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  wait interval;
begin
  select * into m from communication_logs where id = p_id and status = 'sending' for update;
  if not found then
    return;
  end if;
  if p_ok then
    update communication_logs set status = 'sent', sent_at = now(), provider = 'resend',
      provider_message_id = p_provider_message_id, error = null, next_attempt_at = null,
      last_event_at = now()
    where id = p_id;
  else
    wait := case m.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes'
                            when 3 then interval '15 minutes' else interval '60 minutes' end;
    update communication_logs set status = 'failed', error = left(p_error, 500),
      next_attempt_at = case when p_retryable and m.attempts < message_max_attempts()
                             then now() + wait end,
      last_event_at = now()
    where id = p_id;
  end if;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, case when p_ok then 'sent' else 'failed' end,
    jsonb_strip_nulls(jsonb_build_object('provider_message_id', p_provider_message_id,
      'error', left(p_error, 500), 'retryable', p_retryable, 'attempt', m.attempts)));
end;
$$;

-- A delivery report from Resend's webhook. Repeated reports are ignored; a later report never
-- undoes a final one (delivered, bounced, complained).
create function public.record_provider_event(
  p_provider_message_id text, p_event text, p_provider_event_id text, p_detail jsonb,
  p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  next_status text;
begin
  select * into m from communication_logs where provider_message_id = p_provider_message_id for update;
  if not found then
    return false;
  end if;
  if p_provider_event_id is not null
     and exists (select 1 from message_events where provider_event_id = p_provider_event_id) then
    return true;
  end if;
  insert into message_events (business_id, message_id, event, provider_event_id, detail, occurred_at)
  values (m.business_id, m.id, p_event, p_provider_event_id, p_detail, coalesce(p_occurred_at, now()));

  next_status := case p_event
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
  end;
  if next_status is null or m.status in ('bounced', 'complained')
     or (m.status = 'delivered' and next_status in ('delayed', 'delivered')) then
    return true;
  end if;
  update communication_logs set status = next_status, last_event_at = now(),
    delivered_at = case when next_status = 'delivered' then coalesce(p_occurred_at, now())
                        else delivered_at end
  where id = m.id;
  -- Stop emailing an address that bounced, and anyone who reported the email as spam.
  if next_status in ('bounced', 'complained') then
    update customers set
      email_suppressed_at = now(),
      email_suppressed_reason = next_status,
      email_opt_out = email_opt_out or next_status = 'complained',
      marketing_consent = marketing_consent and next_status <> 'complained'
    where id = m.customer_id and lower(trim(email)) = m.recipient;
  end if;
  return true;
end;
$$;

-- Emails due for another try, oldest first.
create function public.due_messages(p_limit integer) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from communication_logs
  where channel = 'email' and direction = 'outbound' and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  order by next_attempt_at nulls first, created_at
  limit least(greatest(p_limit, 1), 50)
$$;

revoke execute on function
  public.claim_message(uuid), public.record_message_result(uuid, boolean, text, text, boolean),
  public.record_provider_event(text, text, text, jsonb, timestamptz), public.due_messages(integer)
from public, anon, authenticated;
grant execute on function
  public.claim_message(uuid), public.record_message_result(uuid, boolean, text, text, boolean),
  public.record_provider_event(text, text, text, jsonb, timestamptz), public.due_messages(integer)
to service_role;
revoke execute on function public.track_customer_consent(), public.stamp_template(),
  public.seed_business_templates(), public.check_logged_contact()
from public, anon, authenticated;

-- Views (they obey the caller's row security) ---------------------------------------------------
create view public.message_list with (security_invoker = true) as
select
  m.id, m.channel, m.direction, m.status, m.purpose, m.subject, m.body, m.recipient, m.template_key,
  m.customer_id, c.name as customer_name,
  m.invoice_id, i.invoice_number, m.ticket_id, t.reference as ticket_reference,
  m.created_by, p.full_name as created_by_name, m.created_at,
  m.attempts, m.next_attempt_at, m.sent_at, m.delivered_at, m.last_event_at, m.error,
  m.attachment_name,
  m.status = 'failed' and m.next_attempt_at is not null as will_retry
from public.communication_logs m
left join public.customers c on c.id = m.customer_id
left join public.invoices i on i.id = m.invoice_id
left join public.support_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.created_by;

create view public.message_summary with (security_invoker = true) as
select
  count(*) filter (where status in ('sent', 'delivered', 'delayed', 'bounced', 'complained')
    and sent_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')::integer
    as sent_this_month,
  count(*) filter (where status = 'delivered'
    and sent_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')::integer
    as delivered_this_month,
  count(*) filter (where status in ('bounced', 'complained')
    and sent_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')::integer
    as bounced_this_month,
  count(*) filter (where status in ('queued', 'sending'))::integer as waiting,
  count(*) filter (where status = 'failed')::integer as failed
from public.communication_logs
where channel = 'email' and direction = 'outbound';

revoke all on public.message_list, public.message_summary from anon;
grant select on public.message_list, public.message_summary to authenticated;
