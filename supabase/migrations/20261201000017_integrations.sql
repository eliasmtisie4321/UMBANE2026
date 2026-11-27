-- Integrations: one place for every external provider (Settings -> Integrations), one outbox and
-- history for every channel (email, SMS, WhatsApp, social posts), and team invitations sent through
-- the business's own email. See docs/INTEGRATIONS.md. Run after 20261130000016_rate_limits.sql.
--
-- Builds on 0012 (communications): the same queue, claim, record and retry steps, now for every
-- channel. Provider names and capabilities match shared/integrations.ts.

-- Connections ------------------------------------------------------------------------------------
create function public.integration_channel(p_provider text) returns text
language sql immutable as $$
  select case p_provider
    when 'resend' then 'email' when 'google' then 'email' when 'microsoft' then 'email'
    when 'twilio' then 'sms' when 'whatsapp' then 'whatsapp'
    when 'facebook' then 'facebook' when 'instagram' then 'instagram' when 'linkedin' then 'linkedin'
  end
$$;

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in (
    'resend', 'google', 'microsoft', 'twilio', 'whatsapp', 'facebook', 'instagram', 'linkedin')),
  channel text generated always as (public.integration_channel(provider)) stored,
  -- connected: verified with the provider. error: it stopped working (token expired, key revoked).
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  account_label text check (char_length(account_label) <= 200),
  account_id text check (char_length(account_id) <= 200),
  -- What the provider confirmed for this connection; never more than shared/integrations.ts allows.
  capabilities text[] not null default '{}' check (capabilities <@ array[
    'send_email', 'direct_message', 'attachments', 'document_links', 'publish_social',
    'receive_messages', 'delivery_tracking']::text[]),
  -- Non-secret options only (sender name, template name, chosen page). Secrets live in
  -- integration_secrets, which no signed-in person can read.
  settings jsonb not null default '{}'
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192),
  is_default boolean not null default false,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_id_business_key unique (id, business_id),
  constraint integrations_default_connected check (not is_default or status = 'connected')
);
-- One live connection per provider, and one default per channel, for each business.
create unique index integrations_one_live on public.integrations (business_id, provider)
  where status <> 'disconnected';
create unique index integrations_one_default on public.integrations (business_id, channel)
  where is_default;
create trigger set_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.integrations
  for each row execute function public.audit_row_change();

-- Everyone on the team can see what is connected (to choose where to share); only the server
-- changes it, after checking the caller is an administrator and the provider confirmed it.
alter table public.integrations enable row level security;
revoke all on public.integrations from anon;
revoke insert, update, delete, truncate on public.integrations from authenticated;
create policy integrations_staff_select on public.integrations for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());

-- Encrypted credentials (AES-256-GCM, by the server). No policies and no grants: only the server's
-- service role can read or write them.
create table public.integration_secrets (
  integration_id uuid primary key,
  business_id uuid not null,
  ciphertext text not null check (char_length(ciphertext) between 20 and 20000),
  updated_at timestamptz not null default now(),
  constraint integration_secrets_integration_fkey foreign key (integration_id, business_id)
    references public.integrations (id, business_id) on delete cascade
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

-- Sign-in with a provider (OAuth) in progress: what the callback must match. Ten minutes at most.
create table public.integration_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'facebook', 'instagram', 'linkedin')),
  created_by uuid not null references public.profiles (id) on delete cascade,
  code_verifier text not null check (char_length(code_verifier) between 43 and 128),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from anon, authenticated;

-- Private links to a document, for channels that cannot carry the file itself (SMS). Opened through
-- /api/documents, which checks the link and hands out a short-lived download.
create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{48}$'),
  bucket text not null check (bucket = 'message-attachments'),
  path text not null check (char_length(path) <= 400),
  file_name text not null check (char_length(file_name) between 1 and 200),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_count integer not null default 0,
  last_opened_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.document_links enable row level security;
revoke all on public.document_links from anon, authenticated;

-- Consent per channel (POPIA) ---------------------------------------------------------------------
-- SMS: service messages unless the customer said no. WhatsApp: only after they agreed (Meta's rule
-- too). Marketing on any channel still needs marketing_consent.
alter table public.customers
  add column sms_opt_out boolean not null default false,
  add column whatsapp_opt_in boolean not null default false;

create or replace function public.track_customer_consent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_opt_out is distinct from old.email_opt_out
     or new.marketing_consent is distinct from old.marketing_consent
     or new.sms_opt_out is distinct from old.sms_opt_out
     or new.whatsapp_opt_in is distinct from old.whatsapp_opt_in then
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

-- A phone number in international form (+27821234567), from how people type South African numbers.
create function public.e164_phone(p_phone text) returns text
language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if d ~ '^\+[1-9][0-9]{7,14}$' then return d; end if;
  if d ~ '^0[0-9]{9}$' then return '+27' || substr(d, 2); end if;
  if d ~ '^27[0-9]{9}$' then return '+' || d; end if;
  return null;
end;
$$;

-- The history: every channel, every provider --------------------------------------------------------
alter table public.communication_logs drop constraint communication_logs_channel_check;
alter table public.communication_logs drop constraint communication_logs_recipient_check;
alter table public.communication_logs
  add constraint communication_logs_channel_check check (channel in (
    'email', 'sms', 'whatsapp', 'facebook', 'instagram', 'linkedin', 'call', 'note')),
  add column integration_id uuid,
  add column message_type text check (message_type in (
    'email', 'direct_message', 'document_share', 'social_post', 'logged')),
  -- The account it went from (an address, number or page), as it was when sent.
  add column sender text check (char_length(sender) <= 200),
  add column recipient_name text check (char_length(recipient_name) <= 200),
  add column recipient_profile_id uuid references public.profiles (id) on delete set null,
  add column lead_id uuid,
  add column order_id uuid,
  add column invitation_id uuid references public.staff_invitations (id) on delete set null,
  add column report_key text check (report_key ~ '^[a-z_]{2,40}$'),
  -- One Share action to several platforms: the same share_id on each message.
  add column share_id uuid,
  -- The same key twice means the same send: the second is never queued (double clicks, retries).
  add column idempotency_key text unique check (char_length(idempotency_key) between 8 and 120),
  add column provider_response jsonb check (pg_column_size(provider_response) <= 4096),
  add column link_url text check (char_length(link_url) <= 500 and link_url ~ '^https://[^\s]{4,}$'),
  add column image_url text check (char_length(image_url) <= 500 and image_url ~ '^https://[^\s]{4,}$'),
  -- Where a published post can be seen.
  add column external_url text
    check (char_length(external_url) <= 500 and external_url ~ '^https://[^\s]{4,}$'),
  add column document_link_id uuid references public.document_links (id) on delete set null,
  add constraint comm_logs_integration_fkey foreign key (integration_id, business_id)
    references public.integrations (id, business_id) on delete set null (integration_id),
  add constraint comm_logs_lead_fkey foreign key (lead_id, business_id)
    references public.leads (id, business_id) on delete set null (lead_id),
  add constraint comm_logs_order_fkey foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete set null (order_id),
  add constraint comm_logs_recipient_format check (
    recipient is null
    or (channel = 'email' and recipient ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    or (channel in ('sms', 'whatsapp') and recipient ~ '^\+[1-9][0-9]{7,14}$')),
  add constraint comm_logs_posts_are_public check (
    channel not in ('facebook', 'instagram', 'linkedin') or direction = 'inbound' or recipient is null);
create index comm_logs_share_idx on public.communication_logs (share_id) where share_id is not null;
create index comm_logs_lead_idx on public.communication_logs (lead_id, created_at desc) where lead_id is not null;

update public.communication_logs set message_type = case
  when channel = 'email' and direction = 'outbound' and status <> 'logged' then 'email' else 'logged' end;
alter table public.communication_logs alter column message_type set not null;

-- A contact logged by a person is a record of what happened (0012). Messages queued through
-- queue_message() run with the function owner's rights, so only rows a signed-in person writes
-- directly (as the authenticated role) are treated as logged contacts; those can never pose as a
-- send. Runs as the caller, so it can tell the two apart; the customer check obeys their row
-- security.
create or replace function public.check_logged_contact() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is not null and current_user in ('authenticated', 'anon')
     and not (new.channel = 'email' and new.direction = 'outbound') then
    new.created_by := auth.uid();
    new.created_at := now();
    new.status := 'logged';
    new.message_type := 'logged';
    new.recipient := null;
    new.provider := null;
    new.provider_message_id := null;
    new.integration_id := null;
    new.attempts := 0;
    new.next_attempt_at := null;
    new.sent_at := null;
    new.delivered_at := null;
    new.attachment_path := null;
    new.idempotency_key := null;
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

-- Older paths (queue_email, automations, contacts logged by hand) do not name a type.
create function public.fill_message_type() returns trigger
language plpgsql as $$
begin
  if new.message_type is null then
    new.message_type := case
      when new.channel = 'email' and new.direction = 'outbound' and coalesce(new.status, '') <> 'logged'
        then 'email' else 'logged' end;
  end if;
  return new;
end;
$$;
-- After check_logged_contact (triggers run in name order), which settles the status first.
create trigger fill_message_type before insert on public.communication_logs
  for each row execute function public.fill_message_type();

-- Who may receive what, per channel ----------------------------------------------------------------
create function public.assert_can_message(p_customer customers, p_channel text, p_purpose text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_channel = 'email' then
    perform assert_can_email(p_customer, p_purpose);
    return;
  end if;
  if e164_phone(p_customer.phone) is null then
    raise exception 'message_no_phone' using errcode = '23514';
  end if;
  if p_channel = 'sms' and p_customer.sms_opt_out then
    raise exception 'message_opted_out' using errcode = '23514';
  end if;
  if p_channel = 'whatsapp' and not p_customer.whatsapp_opt_in then
    raise exception 'message_no_whatsapp_consent' using errcode = '23514';
  end if;
  if p_purpose = 'marketing' and not p_customer.marketing_consent then
    raise exception 'message_no_consent' using errcode = '23514';
  end if;
end;
$$;
revoke execute on function public.assert_can_message(customers, text, text) from public, anon, authenticated;

-- Queues one message to one destination. Recipients are always taken from the record on file
-- (customer, lead or team member); a typed address is for managers sending service messages only
-- (a report to the accountant). Public posts are for managers, carry no customer records or
-- documents, and need a connection that can publish.
create function public.queue_message(
  p_channel text,
  p_integration_id uuid default null,
  p_customer_id uuid default null,
  p_lead_id uuid default null,
  p_profile_id uuid default null,
  p_address text default null,
  p_subject text default null,
  p_body text default null,
  p_purpose text default 'transactional',
  p_template_key text default null,
  p_invoice_id uuid default null,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_report_key text default null,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_link_url text default null,
  p_image_url text default null,
  p_share_id uuid default null,
  p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  biz uuid := current_business_id();
  integ integrations;
  c customers;
  l leads;
  person profiles;
  addr text;
  rname text;
  mtype text;
  purpose text := coalesce(p_purpose, 'transactional');
  body text := trim(coalesce(p_body, ''));
  social boolean := p_channel in ('facebook', 'instagram', 'linkedin');
  max_length integer;
  missing text;
  link_id uuid;
  new_id uuid;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select id into new_id from communication_logs
    where idempotency_key = p_idempotency_key and business_id = biz;
    if found then
      return new_id;
    end if;
  end if;
  if p_channel is null or p_channel not in ('email', 'sms', 'whatsapp', 'facebook', 'instagram', 'linkedin') then
    raise exception 'message_channel_unknown' using errcode = '23514';
  end if;

  -- The connection: the one chosen, or the business's default for the channel. Email may have none:
  -- then the server's built-in sender is used, if one is set up.
  if p_integration_id is not null then
    select * into integ from integrations
    where id = p_integration_id and business_id = biz and status = 'connected';
    if not found or integ.channel <> p_channel then
      raise exception 'integration_not_connected' using errcode = '23514';
    end if;
  else
    select * into integ from integrations
    where business_id = biz and channel = p_channel and status = 'connected'
    order by is_default desc, connected_at
    limit 1;
    if not found and p_channel <> 'email' then
      raise exception 'integration_not_connected' using errcode = '23514';
    end if;
  end if;

  if body = '' then
    raise exception 'message_body_required' using errcode = '23514';
  end if;
  max_length := case p_channel when 'sms' then 1500 when 'whatsapp' then 4000
    when 'instagram' then 2200 when 'linkedin' then 3000 else 10000 end;
  if char_length(body) > max_length then
    raise exception 'message_too_long' using errcode = '23514';
  end if;

  if social then
    if not is_manager_up() then
      raise exception 'message_social_manager' using errcode = '42501';
    end if;
    if not ('publish_social' = any (integ.capabilities)) then
      raise exception 'integration_cannot_publish' using errcode = '23514';
    end if;
    if num_nonnulls(p_customer_id, p_lead_id, p_profile_id, p_address, p_invoice_id, p_ticket_id,
                    p_order_id, p_report_key, p_attachment_path) > 0 then
      raise exception 'message_social_private' using errcode = '23514';
    end if;
    if p_channel = 'instagram' and p_image_url is null then
      raise exception 'message_image_required' using errcode = '23514';
    end if;
    mtype := 'social_post';
    purpose := 'marketing';
  else
    if num_nonnulls(p_customer_id, p_lead_id, p_profile_id, nullif(trim(coalesce(p_address, '')), '')) <> 1 then
      raise exception 'message_one_recipient' using errcode = '23514';
    end if;
    if integ.id is not null and p_channel <> 'email' and not ('direct_message' = any (integ.capabilities)) then
      raise exception 'integration_cannot_message' using errcode = '23514';
    end if;
    if p_channel = 'email' and nullif(trim(coalesce(p_subject, '')), '') is null then
      raise exception 'message_subject_required' using errcode = '23514';
    end if;
    if p_image_url is not null then
      raise exception 'message_image_social_only' using errcode = '23514';
    end if;

    if p_customer_id is not null then
      select * into c from customers where id = p_customer_id and business_id = biz;
      if not found then
        raise exception 'message_customer_not_found' using errcode = '23514';
      end if;
      perform assert_can_message(c, p_channel, purpose);
      addr := case when p_channel = 'email' then lower(trim(c.email)) else e164_phone(c.phone) end;
      rname := c.name;
    elsif p_lead_id is not null then
      select * into l from leads where id = p_lead_id and business_id = biz;
      if not found then
        raise exception 'message_lead_not_found' using errcode = '23514';
      end if;
      -- Someone who asked about the service may be answered; marketing needs them as a customer
      -- who agreed to it.
      if purpose = 'marketing' then
        raise exception 'message_no_consent' using errcode = '23514';
      end if;
      addr := case when p_channel = 'email' then lower(trim(l.email)) else e164_phone(l.phone) end;
      rname := l.name;
    elsif p_profile_id is not null then
      select * into person from profiles
      where id = p_profile_id and business_id = biz and is_active and role <> 'client';
      if not found then
        raise exception 'message_recipient_not_found' using errcode = '23514';
      end if;
      if purpose = 'marketing' then
        raise exception 'message_no_consent' using errcode = '23514';
      end if;
      addr := case when p_channel = 'email' then lower(trim(person.email)) else e164_phone(person.phone) end;
      rname := person.full_name;
    else
      if not is_manager_up() then
        raise exception 'message_address_manager' using errcode = '42501';
      end if;
      if purpose = 'marketing' then
        raise exception 'message_no_consent' using errcode = '23514';
      end if;
      addr := case when p_channel = 'email' then lower(trim(p_address)) else e164_phone(p_address) end;
      if addr is null or (p_channel = 'email' and addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
        raise exception 'message_address_invalid' using errcode = '23514';
      end if;
    end if;
    if addr is null or addr = '' then
      missing := case when p_channel = 'email' then 'message_no_email' else 'message_no_phone' end;
      raise exception '%', missing using errcode = '23514';
    end if;
    mtype := case when p_channel = 'email' then 'email'
                  when p_attachment_path is not null then 'document_share' else 'direct_message' end;
  end if;

  -- Linked records must belong to this business, and to the customer when one is the recipient.
  if p_invoice_id is not null and not exists (
    select 1 from invoices where id = p_invoice_id and business_id = biz
      and (p_customer_id is null or customer_id = p_customer_id)) then
    raise exception 'message_link_mismatch' using errcode = '23514';
  end if;
  if p_ticket_id is not null and not exists (
    select 1 from support_tickets where id = p_ticket_id and business_id = biz
      and (p_customer_id is null or customer_id = p_customer_id)) then
    raise exception 'message_link_mismatch' using errcode = '23514';
  end if;
  if p_order_id is not null and not exists (
    select 1 from orders where id = p_order_id and business_id = biz
      and (p_customer_id is null or customer_id = p_customer_id)) then
    raise exception 'message_link_mismatch' using errcode = '23514';
  end if;
  if p_attachment_path is not null then
    if split_part(p_attachment_path, '/', 1) <> biz::text or not exists (
         select 1 from storage.objects where bucket_id = 'message-attachments' and name = p_attachment_path) then
      raise exception 'attachment_not_uploaded' using errcode = '23514';
    end if;
    -- SMS cannot carry a file: it gets a private link that works for 30 days.
    if p_channel = 'sms' then
      insert into document_links (business_id, token, bucket, path, file_name, expires_at, created_by)
      values (biz, encode(extensions.gen_random_bytes(24), 'hex'), 'message-attachments',
        p_attachment_path, coalesce(nullif(trim(p_attachment_name), ''), 'document.pdf'),
        now() + interval '30 days', auth.uid())
      returning id into link_id;
    end if;
  end if;

  insert into communication_logs (business_id, customer_id, lead_id, recipient_profile_id, channel,
    direction, subject, body, status, created_by, recipient, recipient_name, template_key, purpose,
    invoice_id, ticket_id, order_id, report_key, next_attempt_at, attachment_path, attachment_name,
    integration_id, provider, sender, message_type, link_url, image_url, share_id, idempotency_key,
    document_link_id)
  values (biz, c.id, l.id, person.id, p_channel, 'outbound',
    nullif(trim(coalesce(p_subject, '')), ''), body, 'queued', auth.uid(), addr, rname,
    p_template_key, purpose, p_invoice_id, p_ticket_id, p_order_id, p_report_key, now(),
    p_attachment_path, p_attachment_name, integ.id, integ.provider, integ.account_label, mtype,
    p_link_url, p_image_url, p_share_id, p_idempotency_key, link_id)
  returning id into new_id;
  insert into message_events (business_id, message_id, event, detail)
  values (biz, new_id, 'queued', jsonb_strip_nulls(jsonb_build_object('by', auth.uid(),
    'provider', integ.provider)));
  return new_id;
end;
$$;
revoke execute on function public.queue_message(text, uuid, uuid, uuid, uuid, text, text, text, text,
  text, uuid, uuid, uuid, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.queue_message(text, uuid, uuid, uuid, uuid, text, text, text, text,
  text, uuid, uuid, uuid, text, text, text, text, text, uuid, text) to authenticated;

-- Retry and cancel now cover every channel. A retry re-checks consent and takes the current address.
create or replace function public.retry_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  c customers;
  addr text;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into m from communication_logs
  where id = p_id and business_id = current_business_id() and direction = 'outbound'
    and message_type <> 'logged'
  for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if m.status <> 'failed' then
    raise exception 'message_not_retryable' using errcode = '23514';
  end if;
  if m.message_type = 'social_post' and not is_manager_up() then
    raise exception 'message_social_manager' using errcode = '42501';
  end if;
  if m.integration_id is not null and not exists (
    select 1 from integrations where id = m.integration_id and status = 'connected') then
    raise exception 'integration_not_connected' using errcode = '23514';
  end if;
  addr := m.recipient;
  if m.customer_id is not null then
    select * into c from customers where id = m.customer_id;
    if not found then
      raise exception 'message_customer_not_found' using errcode = '23514';
    end if;
    perform assert_can_message(c, m.channel, m.purpose);
    addr := case when m.channel = 'email' then lower(trim(c.email)) else e164_phone(c.phone) end;
  elsif m.invitation_id is not null then
    -- An invitation is sent again from the Team page, with a fresh link.
    raise exception 'message_not_retryable' using errcode = '23514';
  end if;
  update communication_logs set status = 'queued', attempts = 0, next_attempt_at = now(),
    recipient = addr, error = null, last_event_at = now()
  where id = p_id;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, 'retried', jsonb_build_object('by', auth.uid()));
end;
$$;

create or replace function public.cancel_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
begin
  if auth.uid() is null or not is_staff_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into m from communication_logs
  where id = p_id and business_id = current_business_id() and direction = 'outbound'
    and message_type <> 'logged'
  for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if m.status not in ('queued', 'failed') then
    raise exception 'message_not_cancellable' using errcode = '23514';
  end if;
  update communication_logs set status = 'cancelled', next_attempt_at = null, last_event_at = now()
  where id = p_id;
  update document_links set revoked_at = now() where id = m.document_link_id and revoked_at is null;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, 'cancelled', jsonb_build_object('by', auth.uid()));
end;
$$;

-- Server only: claim, record and due lists for every channel ---------------------------------------
create or replace function public.claim_message(p_id uuid) returns setof public.communication_logs
language plpgsql security definer set search_path = public as $$
declare
  m communication_logs;
  c customers;
begin
  select * into m from communication_logs
  where id = p_id and direction = 'outbound' and message_type <> 'logged'
    and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  for update skip locked;
  if not found then
    return;
  end if;
  begin
    if m.customer_id is not null then
      select * into c from customers where id = m.customer_id;
      perform assert_can_message(c, m.channel, m.purpose);
    elsif m.recipient_profile_id is not null and not exists (
      select 1 from profiles where id = m.recipient_profile_id and is_active) then
      raise exception 'message_recipient_not_found';
    end if;
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

drop function public.record_message_result(uuid, boolean, text, text, boolean);
create function public.record_message_result(
  p_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_retryable boolean,
  p_provider text default null, p_response jsonb default null, p_external_url text default null,
  p_sender text default null
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
    update communication_logs set status = 'sent', sent_at = now(),
      provider = coalesce(p_provider, provider, 'resend'), sender = coalesce(p_sender, sender),
      provider_message_id = p_provider_message_id, provider_response = p_response,
      external_url = coalesce(p_external_url, external_url), error = null, next_attempt_at = null,
      last_event_at = now()
    where id = p_id;
  else
    wait := case m.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes'
                            when 3 then interval '15 minutes' else interval '60 minutes' end;
    update communication_logs set status = 'failed', error = left(p_error, 500),
      provider = coalesce(p_provider, provider), provider_response = p_response,
      next_attempt_at = case when p_retryable and m.attempts < message_max_attempts()
                             then now() + wait end,
      last_event_at = now()
    where id = p_id;
  end if;
  insert into message_events (business_id, message_id, event, detail)
  values (m.business_id, p_id, case when p_ok then 'sent' else 'failed' end,
    jsonb_strip_nulls(jsonb_build_object('provider', p_provider,
      'provider_message_id', p_provider_message_id, 'error', left(p_error, 500),
      'retryable', p_retryable, 'attempt', m.attempts)));
end;
$$;

-- Delivery reports from any provider. Email events keep their Resend names; SMS and WhatsApp
-- reports arrive as message.delivered, message.read and message.failed.
create or replace function public.record_provider_event(
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
    when 'message.delivered' then 'delivered'
    when 'message.read' then 'delivered'
    when 'message.failed' then 'failed'
  end;
  if next_status is null or m.status in ('bounced', 'complained', 'cancelled')
     or (m.status = 'delivered' and next_status in ('delayed', 'delivered', 'failed'))
     or (m.status = 'failed' and next_status = 'failed') then
    return true;
  end if;
  update communication_logs set status = next_status, last_event_at = now(),
    delivered_at = case when next_status = 'delivered' then coalesce(p_occurred_at, now())
                        else delivered_at end,
    error = case when next_status = 'failed'
                 then left(coalesce(p_detail ->> 'error', 'The provider could not deliver it.'), 500)
                 else error end,
    next_attempt_at = case when next_status = 'failed' then null else next_attempt_at end
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

create or replace function public.due_messages(p_limit integer) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from communication_logs
  where direction = 'outbound' and message_type <> 'logged' and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  order by next_attempt_at nulls first, created_at
  limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.due_messages_for(p_business_id uuid, p_limit integer) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from communication_logs
  where business_id = p_business_id and direction = 'outbound' and message_type <> 'logged'
    and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  order by next_attempt_at nulls first, created_at
  limit least(greatest(p_limit, 1), 50)
$$;

-- A customer's reply on WhatsApp, recorded in the history. Matched to the customer by phone number
-- within the connection's business; unknown numbers are recorded without a customer.
create function public.log_inbound_message(
  p_integration_id uuid, p_from text, p_body text, p_provider_message_id text, p_received_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  integ integrations;
  who customers;
  from_phone text := e164_phone(p_from);
  new_id uuid;
begin
  select * into integ from integrations where id = p_integration_id and status = 'connected';
  if not found or from_phone is null then
    return null;
  end if;
  if exists (select 1 from communication_logs where provider_message_id = p_provider_message_id) then
    return null;
  end if;
  select * into who from customers cu
  where cu.business_id = integ.business_id and e164_phone(cu.phone) = from_phone and cu.erased_at is null
  order by cu.created_at
  limit 1;
  insert into communication_logs (business_id, customer_id, channel, direction, subject, body, status,
    recipient, recipient_name, message_type, provider, provider_message_id, integration_id, sender,
    created_at)
  values (integ.business_id, who.id, integ.channel, 'inbound', null,
    left(coalesce(nullif(trim(p_body), ''), '(A message that is not text)'), 4000), 'delivered',
    null, null, 'direct_message', integ.provider, p_provider_message_id, integ.id, from_phone,
    coalesce(p_received_at, now()))
  returning id into new_id;
  if who.id is not null then
    perform notify_people(business_managers(integ.business_id), integ.business_id, 'customers',
      'WhatsApp message from ' || who.name, left(p_body, 140), '/customers/' || who.id,
      'inbound:' || p_provider_message_id, false);
  end if;
  return new_id;
end;
$$;

revoke execute on function
  public.claim_message(uuid),
  public.record_message_result(uuid, boolean, text, text, boolean, text, jsonb, text, text),
  public.record_provider_event(text, text, text, jsonb, timestamptz),
  public.due_messages(integer), public.due_messages_for(uuid, integer),
  public.log_inbound_message(uuid, text, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.claim_message(uuid),
  public.record_message_result(uuid, boolean, text, text, boolean, text, jsonb, text, text),
  public.record_provider_event(text, text, text, jsonb, timestamptz),
  public.due_messages(integer), public.due_messages_for(uuid, integer),
  public.log_inbound_message(uuid, text, text, text, timestamptz)
to service_role;
revoke execute on function public.fill_message_type() from public, anon, authenticated;

-- Notification emails go out from each business's own email connection, so the claim says which
-- business each one belongs to.
drop function public.claim_notification_emails(integer, uuid);
create function public.claim_notification_emails(p_limit integer, p_business_id uuid default null)
returns table (id uuid, recipient text, title text, body text, link text, business_name text,
  business_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  update notifications n set email_status = 'skipped', email_error = 'Too old to send', email_next_at = null
  where n.email_status in ('queued', 'failed', 'sending') and n.created_at < now() - interval '2 days'
    and (p_business_id is null or n.business_id = p_business_id);
  update notifications n set email_status = 'skipped', email_error = 'No longer wanted', email_next_at = null
  where n.email_status in ('queued', 'failed')
    and (p_business_id is null or n.business_id = p_business_id)
    and (not exists (select 1 from profiles p where p.id = n.user_id and p.is_active
                     and nullif(trim(coalesce(p.email, '')), '') is not null)
         or exists (select 1 from notification_preferences np
                    where np.user_id = n.user_id and np.category = n.category and not np.email));
  return query
  with picked as (
    select n.id from notifications n
    where (p_business_id is null or n.business_id = p_business_id)
      and n.email_attempts < 5
      and ((n.email_status in ('queued', 'failed') and n.email_next_at <= now())
           or (n.email_status = 'sending' and n.email_next_at <= now() - interval '10 minutes'))
    order by n.created_at
    limit least(greatest(p_limit, 1), 200)
    for update skip locked
  )
  update notifications n
  set email_status = 'sending', email_attempts = n.email_attempts + 1, email_next_at = now()
  from picked, profiles p
  where n.id = picked.id and p.id = n.user_id
  returning n.id, lower(trim(p.email)), n.title, n.body, n.link,
    (select b.name from businesses b where b.id = n.business_id), n.business_id;
end;
$$;
revoke execute on function public.claim_notification_emails(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer, uuid) to service_role;

-- The history views, for every channel --------------------------------------------------------------
create or replace view public.message_list with (security_invoker = true) as
select
  m.id, m.channel, m.direction, m.status, m.purpose, m.subject, m.body, m.recipient, m.template_key,
  m.customer_id, c.name as customer_name,
  m.invoice_id, i.invoice_number, m.ticket_id, t.reference as ticket_reference,
  m.created_by, p.full_name as created_by_name, m.created_at,
  m.attempts, m.next_attempt_at, m.sent_at, m.delivered_at, m.last_event_at, m.error,
  m.attachment_name,
  m.status = 'failed' and m.next_attempt_at is not null as will_retry,
  m.message_type, m.provider, m.sender, m.recipient_name, m.integration_id, m.lead_id,
  l.name as lead_name, m.order_id, m.invitation_id, m.report_key, m.share_id, m.link_url,
  m.image_url, m.external_url
from public.communication_logs m
left join public.customers c on c.id = m.customer_id
left join public.invoices i on i.id = m.invoice_id
left join public.support_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.created_by
left join public.leads l on l.id = m.lead_id;

create or replace view public.message_summary with (security_invoker = true) as
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
where direction = 'outbound' and message_type <> 'logged';

-- Team invitations sent by email ---------------------------------------------------------------------
-- Statuses: pending (not sent yet), sent, failed (delivery), accepted, expired, cancelled.
alter table public.staff_invitations drop constraint staff_invitations_status_check;
alter table public.staff_invitations
  add constraint staff_invitations_status_check
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  add column expires_at timestamptz,
  add column delivery_status text not null default 'not_sent'
    check (delivery_status in ('not_sent', 'sending', 'sent', 'failed')),
  add column sent_at timestamptz,
  add column send_count integer not null default 0 check (send_count between 0 and 50),
  add column last_error text check (char_length(last_error) <= 500),
  add column sent_via text check (char_length(sent_via) <= 200),
  add column cancelled_at timestamptz,
  -- The sign-in account Supabase made for the invitation link, removed again if it is cancelled
  -- before anyone used it.
  add column auth_user_id uuid;
-- Invitations already waiting keep at least a week from now.
update public.staff_invitations set expires_at = case
  when status = 'pending' then greatest(created_at + interval '30 days', now() + interval '7 days')
  else created_at + interval '7 days' end;
alter table public.staff_invitations
  alter column expires_at set not null,
  alter column expires_at set default now() + interval '7 days';

-- A person may only cancel a pending invitation; delivery details are the server's to record.
create or replace function public.check_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() < 2 and auth.uid() is not null then
    -- Cancelled by an administrator, or marked expired by invite_staff once its time is up.
    if old.status <> 'pending'
       or not (new.status = 'cancelled' or (new.status = 'expired' and old.expires_at <= now()))
       or (new.email, new.role, new.business_id) is distinct from (old.email, old.role, old.business_id) then
      raise exception 'invitation_closed' using errcode = '23514';
    end if;
    new.delivery_status := old.delivery_status;
    new.sent_at := old.sent_at;
    new.send_count := old.send_count;
    new.last_error := old.last_error;
    new.sent_via := old.sent_via;
    new.expires_at := old.expires_at;
    new.auth_user_id := old.auth_user_id;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

-- As before (0011), and an expired invitation no longer blocks inviting the same person again.
create or replace function public.invite_staff(
  p_email text, p_full_name text, p_role public.user_role,
  p_phone text default null, p_department text default null, p_job_title text default null,
  p_start_date date default null, p_reports_to uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  biz uuid := current_business_id();
  addr text := lower(trim(p_email));
  account auth.users;
  inv_id uuid;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_role = 'client' then
    raise exception 'staff_role_client' using errcode = '23514';
  end if;
  select * into account from auth.users where lower(email) = addr limit 1;
  if exists (select 1 from profiles where lower(email) = addr)
     or (account.id is not null and exists (select 1 from profiles where id = account.id)) then
    raise exception 'staff_email_taken' using errcode = '23514';
  end if;
  update staff_invitations set status = 'expired'
  where email = addr and status = 'pending' and expires_at <= now();
  if exists (select 1 from staff_invitations where email = addr and status = 'pending') then
    raise exception 'staff_already_invited' using errcode = '23514';
  end if;

  if account.id is not null and account.email_confirmed_at is not null then
    insert into profiles (id, business_id, role, full_name, email, phone, department, job_title,
                          start_date, reports_to)
    values (account.id, biz, p_role, trim(p_full_name), addr, p_phone, p_department, p_job_title,
            p_start_date, p_reports_to);
    insert into staff_invitations (business_id, email, full_name, role, phone, department, job_title,
      start_date, reports_to, status, invited_by, profile_id, accepted_at)
    values (biz, addr, trim(p_full_name), p_role, p_phone, p_department, p_job_title, p_start_date,
      p_reports_to, 'accepted', auth.uid(), account.id, now());
    return jsonb_build_object('status', 'linked', 'profile_id', account.id);
  end if;

  insert into staff_invitations (business_id, email, full_name, role, phone, department, job_title,
    start_date, reports_to, invited_by)
  values (biz, addr, trim(p_full_name), p_role, p_phone, p_department, p_job_title, p_start_date,
    p_reports_to, auth.uid())
  returning id into inv_id;
  return jsonb_build_object('status', 'invited', 'invitation_id', inv_id);
end;
$$;

-- As before (0011), but an expired or cancelled invitation never creates a profile.
create or replace function public.link_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv staff_invitations;
begin
  if new.email_confirmed_at is null or exists (select 1 from profiles where id = new.id) then
    return new;
  end if;
  select * into inv from staff_invitations
  where status = 'pending' and email = lower(new.email) and expires_at > now() for update;
  if not found then
    return new;
  end if;
  begin
    insert into profiles (id, business_id, role, full_name, email, phone, department, job_title,
                          start_date, reports_to)
    values (new.id, inv.business_id, inv.role, inv.full_name, lower(new.email), inv.phone,
            inv.department, inv.job_title, inv.start_date, inv.reports_to);
    update staff_invitations set status = 'accepted', accepted_at = now(), profile_id = new.id
    where id = inv.id;
  exception when others then
    raise warning 'staff invitation % could not be accepted: %', inv.id, sqlerrm;
  end;
  return new;
end;
$$;

-- What the Team page shows: one status per invitation.
create view public.staff_invitation_list with (security_invoker = true) as
select
  i.id, i.business_id, i.email, i.full_name, i.role, i.department, i.job_title, i.created_at,
  i.expires_at, i.sent_at, i.send_count, i.sent_via, i.last_error, i.accepted_at, i.cancelled_at,
  i.profile_id, i.invited_by, p.full_name as invited_by_name,
  case
    when i.status = 'accepted' then 'accepted'
    when i.status = 'cancelled' then 'cancelled'
    when i.status = 'expired' or i.expires_at <= now() then 'expired'
    when i.delivery_status = 'failed' then 'failed'
    when i.delivery_status in ('sent', 'sending') then 'sent'
    else 'pending'
  end as state
from public.staff_invitations i
left join public.profiles p on p.id = i.invited_by;
revoke all on public.staff_invitation_list from anon;
grant select on public.staff_invitation_list to authenticated;

-- Invitation emails are in the history too; like invitations, only administrators see them.
drop policy comm_logs_staff_select on public.communication_logs;
create policy comm_logs_staff_select on public.communication_logs for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up()
         and (invitation_id is null or public.is_admin()));
