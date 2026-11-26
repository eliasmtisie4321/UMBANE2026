-- Phase 12: notifications and automations.
--
-- Notifications
-- * Every notification has a category (tickets, tasks, invoices, inventory, customers, maintenance,
--   general). Each person chooses, per category, whether they get it in the app, by email, or both
--   (notification_preferences). The default is in the app only.
-- * All notifications go through notify(). A notification can carry a dedupe key: the same key is
--   never delivered to the same person twice, however often the code that sends it runs.
-- * Emails for notifications are queued on the notification itself and sent by the server
--   (api/), like customer email: claimed, sent once (idempotency key), retried on temporary failure.
--
-- Automations
-- * A fixed list (no custom builder). Managers switch each on or off and change its settings.
-- * Scheduled ones are run by run_automations() (daily by Vercel Cron, or "Run now"); the others
--   react to changes (stock, new customers, urgent tickets, ticket status).
-- * Every action an automation takes is logged with a dedupe key in automation_actions: an action
--   that succeeded is never repeated, a failure is logged without its key so the next run tries
--   again, and two runs at the same moment cannot both act (advisory lock + unique key).
-- * Customer emails (payment reminder, overdue notice, ticket status) are off until a manager
--   switches them on, and go through the Phase 10 email queue with all its consent checks.
--
-- Run after 0013 (needs 0012 for the email queue and templates).

-- Notification categories ------------------------------------------------------------------------
create function public.notification_category(p_link text) returns text
language sql immutable as $$
  select case
    when p_link like '/support-tickets%' then 'tickets'
    when p_link like '/tasks%' then 'tasks'
    when p_link like '/invoices%' then 'invoices'
    when p_link like '/inventory%' then 'inventory'
    when p_link like '/customers%' then 'customers'
    when p_link like '/electricity-meters%' then 'maintenance'
    else 'general'
  end
$$;

alter table public.notifications
  add column category text not null default 'general'
    constraint notifications_category_check check (category in (
      'tickets', 'tasks', 'invoices', 'inventory', 'customers', 'maintenance', 'general')),
  add column dedupe_key text check (char_length(dedupe_key) <= 200),
  add column in_app boolean not null default true,
  add column email_status text check (email_status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  add column email_attempts integer not null default 0 check (email_attempts between 0 and 10),
  add column email_next_at timestamptz,
  add column email_error text check (char_length(email_error) <= 500),
  add column emailed_at timestamptz;
update public.notifications set category = public.notification_category(link);
create unique index notifications_dedupe_uniq on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;
create index notifications_email_due_idx on public.notifications (email_next_at)
  where email_status in ('queued', 'failed', 'sending');
create index notifications_user_category_idx on public.notifications (user_id, category, created_at desc);

-- People see their own in-app notifications and can only mark them read.
drop policy notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid() and in_app);
revoke insert, update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- Preferences --------------------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid not null,
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  category text not null check (category in (
    'tickets', 'tasks', 'invoices', 'inventory', 'customers', 'maintenance', 'general')),
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category),
  constraint notification_prefs_user_fkey foreign key (user_id, business_id)
    references public.profiles (id, business_id) on delete cascade
);
create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon;
create policy notification_prefs_own_select on public.notification_preferences for select
  to authenticated using (user_id = auth.uid());
create policy notification_prefs_own_insert on public.notification_preferences for insert
  to authenticated with check (user_id = auth.uid() and business_id = public.current_business_id());
create policy notification_prefs_own_update on public.notification_preferences for update
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and business_id = public.current_business_id());
create policy notification_prefs_own_delete on public.notification_preferences for delete
  to authenticated using (user_id = auth.uid());

-- Sending ----------------------------------------------------------------------------------------
-- The one way a notification is created. Returns true if it was delivered (in the app or queued
-- for email). Skips inactive people, people who switched the category off entirely, a repeated
-- dedupe key, and (unless p_skip_self is false) the person whose action caused it.
create function public.notify(
  p_user uuid, p_business_id uuid, p_category text, p_title text, p_body text, p_link text,
  p_dedupe_key text default null, p_skip_self boolean default true
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_in_app boolean := true;
  v_send boolean := false;
  v_id uuid;
begin
  if p_user is null or (p_skip_self and p_user is not distinct from auth.uid()) then
    return false;
  end if;
  select email into v_email from profiles
  where id = p_user and business_id = p_business_id and is_active;
  if not found then
    return false;
  end if;
  select np.in_app, np.email into v_in_app, v_send
  from notification_preferences np where np.user_id = p_user and np.category = p_category;
  v_in_app := coalesce(v_in_app, true);
  v_send := coalesce(v_send, false) and nullif(trim(coalesce(v_email, '')), '') is not null;
  if not v_in_app and not v_send then
    return false;
  end if;
  insert into notifications (business_id, user_id, category, title, body, link, dedupe_key, in_app,
    email_status, email_next_at)
  values (p_business_id, p_user, p_category, left(p_title, 200), left(p_body, 300), p_link,
    p_dedupe_key, v_in_app, case when v_send then 'queued' end, case when v_send then now() end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- The Phase 8 helpers keep their signatures; they now go through notify().
create or replace function public.notify_user(
  p_user uuid, p_business_id uuid, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform notify(p_user, p_business_id, notification_category(p_link), p_title, p_body, p_link);
end;
$$;

create or replace function public.notify_managers(
  p_business_id uuid, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m uuid;
begin
  for m in select id from profiles
           where business_id = p_business_id and is_active and role in ('administrator', 'manager')
  loop
    perform notify(m, p_business_id, notification_category(p_link), p_title, p_body, p_link);
  end loop;
end;
$$;

-- Notifies several people at once; returns how many were reached.
create function public.notify_people(
  p_users uuid[], p_business_id uuid, p_category text, p_title text, p_body text, p_link text,
  p_dedupe_key text, p_skip_self boolean
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  n integer := 0;
begin
  for u in select distinct x from unnest(p_users) x where x is not null loop
    if notify(u, p_business_id, p_category, p_title, p_body, p_link, p_dedupe_key, p_skip_self) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create function public.business_managers(p_business_id uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by id), '{}') from profiles
  where business_id = p_business_id and is_active and role in ('administrator', 'manager')
$$;

-- Notification email (server only) ----------------------------------------------------------------
-- Hands the server up to p_limit notification emails to send, marking them "sending". Emails older
-- than two days, or no longer wanted (person inactive, no address, email switched off), are
-- skipped instead: a notification is news, and late news is noise.
create function public.claim_notification_emails(p_limit integer, p_business_id uuid default null)
returns table (id uuid, recipient text, title text, body text, link text, business_name text)
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
    (select b.name from businesses b where b.id = n.business_id);
end;
$$;

-- What happened to one notification email. Temporary failures wait 5, 10, 15, 20 minutes.
create function public.record_notification_email(
  p_id uuid, p_ok boolean, p_error text, p_retryable boolean
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update notifications set
    email_status = case when p_ok then 'sent' else 'failed' end,
    emailed_at = case when p_ok then now() end,
    email_error = case when p_ok then null else left(coalesce(p_error, 'Unknown error'), 500) end,
    email_next_at = case
      when p_ok then null
      when p_retryable and email_attempts < 5 then now() + interval '5 minutes' * email_attempts
    end
  where id = p_id and email_status = 'sending';
  return found;
end;
$$;

-- Customer emails due to go out for one business (the app's "flush" call uses this).
create function public.due_messages_for(p_business_id uuid, p_limit integer) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from communication_logs
  where business_id = p_business_id and channel = 'email' and direction = 'outbound'
    and attempts < message_max_attempts()
    and ((status in ('queued', 'failed') and next_attempt_at <= now())
         or (status = 'sending' and last_event_at < now() - interval '10 minutes'))
  order by next_attempt_at nulls first, created_at
  limit least(greatest(p_limit, 1), 50)
$$;

-- Templates for automated customer email ------------------------------------------------------------
create function public.format_rand(p_amount numeric) returns text
language sql immutable as $$
  select 'R ' || to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00')
$$;

create function public.format_sa_date(p_date date) returns text
language sql immutable as $$
  select to_char(p_date, 'FMDD Mon YYYY')
$$;

-- Fills {{placeholders}}; any left unfilled are removed rather than sent as braces.
create function public.render_template(p_text text, p_values jsonb) returns text
language plpgsql immutable as $$
declare
  k text;
  v text;
  v_out text := p_text;
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_values, '{}')) loop
    v_out := replace(v_out, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return regexp_replace(v_out, '\{\{\s*[a-z_]+\s*\}\}', '', 'g');
end;
$$;

create or replace function public.seed_message_templates(p_business_id uuid) returns void
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
   E'Good day {{customer_name}},\n\n{{message}}\n\nKind regards\n{{sender_name}}\n{{business_name}}'),
  (p_business_id, 'invoice_overdue', 'Invoice overdue', 'transactional',
   'Invoice {{invoice_number}} is overdue',
   E'Good day {{customer_name}},\n\nOur records show that invoice {{invoice_number}} was due on {{due_date}} and still has a balance of {{balance_due}}. Please arrange payment, using {{invoice_number}} as your reference. If you have already paid, thank you, and please send us the proof of payment.\n\nKind regards\n{{sender_name}}\n{{business_name}}')
  on conflict (business_id, key) do nothing
$$;
select public.seed_message_templates(id) from public.businesses;

-- Queues an automated email to a customer from one of their business's templates. Raises the same
-- message_* reasons as queue_email when the customer cannot be emailed.
create function public.automation_queue_email(
  p_business_id uuid, p_customer_id uuid, p_template_key text, p_values jsonb,
  p_invoice_id uuid default null, p_ticket_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c customers;
  t message_templates;
  v_name text := (select name from businesses where id = p_business_id);
  v_values jsonb;
  v_id uuid;
begin
  select * into c from customers where id = p_customer_id and business_id = p_business_id;
  if not found then
    raise exception 'message_customer_not_found' using errcode = '23514';
  end if;
  select * into t from message_templates
  where business_id = p_business_id and key = p_template_key and is_active;
  if not found then
    raise exception 'message_template_off' using errcode = '23514';
  end if;
  perform assert_can_email(c, t.purpose);
  v_values := jsonb_build_object('customer_name', c.name, 'business_name', v_name, 'sender_name', v_name)
              || coalesce(p_values, '{}');
  insert into communication_logs (business_id, customer_id, channel, direction, subject, body, status,
    created_by, recipient, template_key, purpose, invoice_id, ticket_id, next_attempt_at)
  values (p_business_id, c.id, 'email', 'outbound', left(render_template(t.subject, v_values), 200),
    render_template(t.body, v_values), 'queued', null, lower(trim(c.email)), t.key, t.purpose,
    p_invoice_id, p_ticket_id, now())
  returning id into v_id;
  insert into message_events (business_id, message_id, event, detail)
  values (p_business_id, v_id, 'queued', jsonb_build_object('automation', p_template_key));
  return v_id;
end;
$$;

-- Automations ------------------------------------------------------------------------------------
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  key text not null check (key in (
    'overdue_invoices', 'low_stock', 'new_customer', 'urgent_ticket', 'task_reminders',
    'maintenance_reminders', 'payment_reminder', 'overdue_notice', 'ticket_status_email')),
  enabled boolean not null default false,
  settings jsonb not null default '{}',
  last_run_at timestamptz,
  last_status text check (last_status in ('success', 'partial', 'failed', 'nothing_to_do')),
  last_message text check (char_length(last_message) <= 500),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);
create trigger set_updated_at before update on public.automations
  for each row execute function public.set_updated_at();

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  business_id uuid not null references public.businesses (id) on delete cascade,
  automation_key text not null,
  trigger text not null check (trigger in ('schedule', 'manual')),
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text check (status in ('success', 'partial', 'failed', 'nothing_to_do')),
  checked integer not null default 0,
  done integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  error text check (char_length(error) <= 500),
  constraint automation_runs_id_business_key unique (id, business_id)
);
create index automation_runs_business_idx on public.automation_runs (business_id, automation_key, started_at desc);

-- Everything an automation did (or failed to do), one row per record and action.
create table public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  run_id uuid,
  automation_key text not null,
  -- Present once the action succeeded or was deliberately skipped: it is then never done again.
  dedupe_key text check (char_length(dedupe_key) <= 200),
  target_type text not null check (target_type in ('invoice', 'product', 'customer', 'ticket', 'task', 'maintenance')),
  target_id uuid,
  target_label text check (char_length(target_label) <= 200),
  outcome text not null check (outcome in ('pending', 'notified', 'emailed', 'skipped', 'failed')),
  detail text check (char_length(detail) <= 500),
  created_at timestamptz not null default now(),
  constraint automation_actions_run_fkey foreign key (run_id, business_id)
    references public.automation_runs (id, business_id) on delete cascade
);
create unique index automation_actions_dedupe_uniq on public.automation_actions (business_id, dedupe_key)
  where dedupe_key is not null;
create index automation_actions_key_idx on public.automation_actions (business_id, automation_key, created_at desc);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_actions enable row level security;
revoke all on public.automations, public.automation_runs, public.automation_actions from anon;
revoke insert, update, delete, truncate on public.automations, public.automation_runs,
  public.automation_actions from authenticated;
grant update (enabled, settings) on public.automations to authenticated;
create policy automations_manager_select on public.automations for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
create policy automations_manager_update on public.automations for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy automation_runs_manager_select on public.automation_runs for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
create policy automation_actions_manager_select on public.automation_actions for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());

-- A whole number between lo and hi, as JSON.
create function public.json_int_between(p_value jsonb, p_lo numeric, p_hi numeric) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_value) = 'number'
    and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
    and (p_value #>> '{}')::numeric between p_lo and p_hi
$$;

-- The settings each automation takes, with their limits. Nothing else is accepted.
create function public.automation_settings_ok(p_key text, s jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(s) = 'object' and case p_key
    when 'overdue_invoices' then
      (s - 'days_overdue') = '{}' and public.json_int_between(s -> 'days_overdue', 0, 60)
    when 'task_reminders' then
      (s - 'days_before') = '{}' and public.json_int_between(s -> 'days_before', 0, 14)
    when 'maintenance_reminders' then
      (s - 'days_before') = '{}' and public.json_int_between(s -> 'days_before', 0, 14)
    when 'payment_reminder' then
      (s - 'days_before' - 'min_balance') = '{}'
      and public.json_int_between(s -> 'days_before', 1, 30)
      and public.json_int_between(s -> 'min_balance', 0, 10000000)
    when 'overdue_notice' then
      (s - 'days_overdue') = '{}' and public.json_int_between(s -> 'days_overdue', 1, 90)
    else s = '{}'
  end
$$;

create function public.check_automation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only a change of switch or settings is checked and stamped; recording a run's result is not an
  -- edit (and must never fail because of the settings).
  if tg_op = 'UPDATE' and new.settings = old.settings and new.enabled = old.enabled then
    return new;
  end if;
  -- coalesce: a missing setting makes the check null, which must count as invalid.
  if not coalesce(automation_settings_ok(new.key, new.settings), false) then
    raise exception 'automation_settings_invalid' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;
create trigger check_automation before insert or update on public.automations
  for each row execute function public.check_automation();

-- Every business starts with the full list. Team alerts are on; customer emails are off.
create function public.seed_automations(p_business_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into automations (business_id, key, enabled, settings) values
    (p_business_id, 'overdue_invoices', true, '{"days_overdue": 1}'),
    (p_business_id, 'low_stock', true, '{}'),
    (p_business_id, 'new_customer', true, '{}'),
    (p_business_id, 'urgent_ticket', true, '{}'),
    (p_business_id, 'task_reminders', true, '{"days_before": 1}'),
    (p_business_id, 'maintenance_reminders', true, '{"days_before": 1}'),
    (p_business_id, 'payment_reminder', false, '{"days_before": 3, "min_balance": 0}'),
    (p_business_id, 'overdue_notice', false, '{"days_overdue": 7}'),
    (p_business_id, 'ticket_status_email', false, '{}')
  on conflict (business_id, key) do nothing
$$;
select public.seed_automations(id) from public.businesses;

create function public.seed_business_automations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_automations(new.id);
  return null;
end;
$$;
create trigger seed_business_automations after insert on public.businesses
  for each row execute function public.seed_business_automations();

create function public.automation_on(p_business_id uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from automations where business_id = p_business_id and key = p_key), false)
$$;

-- Claims an action: returns its id the first time a dedupe key is used, null if already done.
create function public.automation_claim(
  p_business_id uuid, p_run uuid, p_key text, p_dedupe text, p_type text, p_target uuid, p_label text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into automation_actions (business_id, run_id, automation_key, dedupe_key, target_type,
    target_id, target_label, outcome)
  values (p_business_id, p_run, p_key, p_dedupe, p_type, p_target, left(p_label, 200), 'pending')
  on conflict (business_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create function public.automation_done(p_action uuid, p_outcome text, p_detail text) returns void
language sql security definer set search_path = public as $$
  update automation_actions set outcome = p_outcome, detail = left(p_detail, 500) where id = p_action
$$;

-- A failure is logged without a dedupe key, so the next run tries the same record again.
create function public.automation_failed(
  p_business_id uuid, p_run uuid, p_key text, p_type text, p_target uuid, p_label text, p_error text
) returns void
language sql security definer set search_path = public as $$
  insert into automation_actions (business_id, run_id, automation_key, target_type, target_id,
    target_label, outcome, detail)
  values (p_business_id, p_run, p_key, p_type, p_target, left(p_label, 200), 'failed', left(p_error, 500))
$$;

-- Records reached by an automation notification, or why nobody was.
create function public.reached(p_count integer) returns text
language sql immutable as $$
  select case when p_count = 0 then 'Nobody to notify (everyone has this switched off)'
              when p_count = 1 then 'Notified 1 person'
              else 'Notified ' || p_count || ' people' end
$$;

-- Scheduled automations ---------------------------------------------------------------------------
-- Each returns {checked, done, skipped, failed}. "Checked" counts records not handled before.
-- Records that became due while the automation was not running are caught up for 7 days.

create function public.auto_overdue_invoices(p_business_id uuid, p_run uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days integer := (p_settings ->> 'days_overdue')::integer;
  v_today date := business_today();
  r record;
  v_action uuid;
  v_n integer;
  c_checked integer := 0;
  c_done integer := 0;
  c_skipped integer := 0;
  c_failed integer := 0;
begin
  for r in
    select il.id, il.invoice_number, il.customer_name, il.balance, il.due_date, i.issued_by
    from invoice_list il join invoices i on i.id = il.id
    where il.business_id = p_business_id and il.status in ('sent', 'partially_paid') and il.balance > 0
      and il.due_date between v_today - v_days - 7 and v_today - v_days
      and not exists (select 1 from automation_actions a where a.business_id = p_business_id
                      and a.dedupe_key = 'overdue-invoice:' || il.id)
    order by il.due_date, il.invoice_number
  loop
    c_checked := c_checked + 1;
    begin
      v_action := automation_claim(p_business_id, p_run, 'overdue_invoices', 'overdue-invoice:' || r.id,
        'invoice', r.id, r.invoice_number || ' · ' || r.customer_name);
      if v_action is null then
        c_skipped := c_skipped + 1;
        continue;
      end if;
      v_n := notify_people(business_managers(p_business_id) || r.issued_by, p_business_id, 'invoices',
        'Invoice ' || r.invoice_number || ' is overdue',
        r.customer_name || ' owes ' || format_rand(r.balance) || ', due ' || format_sa_date(r.due_date) || '.',
        '/invoices/' || r.id, 'overdue-invoice:' || r.id, false);
      perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
      if v_n > 0 then c_done := c_done + 1; else c_skipped := c_skipped + 1; end if;
    exception when others then
      c_failed := c_failed + 1;
      perform automation_failed(p_business_id, p_run, 'overdue_invoices', 'invoice', r.id,
        r.invoice_number || ' · ' || r.customer_name, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('checked', c_checked, 'done', c_done, 'skipped', c_skipped, 'failed', c_failed);
end;
$$;

create function public.auto_task_reminders(p_business_id uuid, p_run uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days integer := (p_settings ->> 'days_before')::integer;
  v_today date := business_today();
  r record;
  v_key text;
  v_action uuid;
  v_n integer;
  c_checked integer := 0;
  c_done integer := 0;
  c_skipped integer := 0;
  c_failed integer := 0;
begin
  for r in
    select t.id, 'TSK-' || lpad(t.number::text, 5, '0') as reference, t.title, t.due_date,
      t.assigned_to, t.created_by, t.due_date < v_today as overdue
    from staff_tasks t
    where t.business_id = p_business_id and t.status in ('todo', 'in_progress')
      and t.assigned_to is not null
      and t.due_date between v_today - 7 and v_today + v_days
      and not exists (select 1 from automation_actions a where a.business_id = p_business_id
                      and a.dedupe_key = case when t.due_date < v_today then 'task-overdue:' else 'task-due:' end
                                         || t.id || ':' || t.due_date)
    order by t.due_date, t.number
  loop
    c_checked := c_checked + 1;
    v_key := case when r.overdue then 'task-overdue:' else 'task-due:' end || r.id || ':' || r.due_date;
    begin
      v_action := automation_claim(p_business_id, p_run, 'task_reminders', v_key, 'task', r.id,
        r.reference || ' · ' || r.title);
      if v_action is null then
        c_skipped := c_skipped + 1;
        continue;
      end if;
      if r.overdue then
        v_n := notify_people(array[r.assigned_to, r.created_by], p_business_id, 'tasks',
          r.reference || ' is overdue', r.title || ' was due ' || format_sa_date(r.due_date) || '.',
          '/tasks/' || r.id, v_key, false);
      else
        v_n := notify_people(array[r.assigned_to], p_business_id, 'tasks',
          r.reference || ' is due ' || case r.due_date - v_today when 0 then 'today' when 1 then 'tomorrow'
                                        else 'on ' || format_sa_date(r.due_date) end,
          r.title, '/tasks/' || r.id, v_key, false);
      end if;
      perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
      if v_n > 0 then c_done := c_done + 1; else c_skipped := c_skipped + 1; end if;
    exception when others then
      c_failed := c_failed + 1;
      perform automation_failed(p_business_id, p_run, 'task_reminders', 'task', r.id,
        r.reference || ' · ' || r.title, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('checked', c_checked, 'done', c_done, 'skipped', c_skipped, 'failed', c_failed);
end;
$$;

create function public.auto_maintenance_reminders(p_business_id uuid, p_run uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days integer := (p_settings ->> 'days_before')::integer;
  v_today date := business_today();
  r record;
  v_key text;
  v_action uuid;
  v_n integer;
  c_checked integer := 0;
  c_done integer := 0;
  c_skipped integer := 0;
  c_failed integer := 0;
begin
  for r in
    select mm.id, mm.kind, mm.scheduled_for, mm.assigned_to, mm.meter_id, m.serial_number
    from meter_maintenance mm join electricity_meters m on m.id = mm.meter_id
    where mm.business_id = p_business_id and mm.status in ('scheduled', 'pending')
      and mm.scheduled_for between v_today and v_today + v_days
      and not exists (select 1 from automation_actions a where a.business_id = p_business_id
                      and a.dedupe_key = 'maintenance-due:' || mm.id || ':' || mm.scheduled_for)
    order by mm.scheduled_for, mm.number
  loop
    c_checked := c_checked + 1;
    v_key := 'maintenance-due:' || r.id || ':' || r.scheduled_for;
    begin
      v_action := automation_claim(p_business_id, p_run, 'maintenance_reminders', v_key, 'maintenance',
        r.id, initcap(r.kind) || ' · ' || r.serial_number);
      if v_action is null then
        c_skipped := c_skipped + 1;
        continue;
      end if;
      -- The technician if one is assigned, otherwise the managers, who need to assign one.
      v_n := notify_people(
        case when r.assigned_to is not null then array[r.assigned_to] else business_managers(p_business_id) end,
        p_business_id, 'maintenance',
        initcap(r.kind) || ' due ' || case r.scheduled_for - v_today when 0 then 'today' when 1 then 'tomorrow'
                                       else 'on ' || format_sa_date(r.scheduled_for) end
          || ' on meter ' || r.serial_number,
        case when r.assigned_to is null then 'Nobody is assigned yet.' else 'You are assigned to this visit.' end,
        '/electricity-meters/' || r.meter_id, v_key, false);
      perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
      if v_n > 0 then c_done := c_done + 1; else c_skipped := c_skipped + 1; end if;
    exception when others then
      c_failed := c_failed + 1;
      perform automation_failed(p_business_id, p_run, 'maintenance_reminders', 'maintenance', r.id,
        initcap(r.kind) || ' · ' || r.serial_number, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('checked', c_checked, 'done', c_done, 'skipped', c_skipped, 'failed', c_failed);
end;
$$;

-- Customer email: payment reminder before the due date, and overdue notice after it.
create function public.auto_invoice_emails(
  p_business_id uuid, p_run uuid, p_key text, p_settings jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := business_today();
  v_overdue boolean := p_key = 'overdue_notice';
  v_days integer := coalesce((p_settings ->> 'days_overdue')::integer, (p_settings ->> 'days_before')::integer);
  v_min numeric := coalesce((p_settings ->> 'min_balance')::numeric, 0);
  r record;
  v_key text;
  v_action uuid;
  c_checked integer := 0;
  c_done integer := 0;
  c_skipped integer := 0;
  c_failed integer := 0;
begin
  for r in
    select il.id, il.invoice_number, il.customer_id, il.customer_name, il.total, il.balance, il.due_date
    from invoice_list il
    where il.business_id = p_business_id and il.status in ('sent', 'partially_paid') and il.balance > v_min
      and case when v_overdue then il.due_date between v_today - v_days - 7 and v_today - v_days
               else il.due_date between v_today and v_today + v_days end
      and not exists (select 1 from automation_actions a where a.business_id = p_business_id
                      and a.dedupe_key = case when v_overdue then 'overdue-notice:' || il.id
                                              else 'payment-reminder:' || il.id || ':' || il.due_date end)
    order by il.due_date, il.invoice_number
  loop
    c_checked := c_checked + 1;
    v_key := case when v_overdue then 'overdue-notice:' || r.id else 'payment-reminder:' || r.id || ':' || r.due_date end;
    begin
      v_action := automation_claim(p_business_id, p_run, p_key, v_key, 'invoice', r.id,
        r.invoice_number || ' · ' || r.customer_name);
      if v_action is null then
        c_skipped := c_skipped + 1;
        continue;
      end if;
      begin
        perform automation_queue_email(p_business_id, r.customer_id,
          case when v_overdue then 'invoice_overdue' else 'payment_reminder' end,
          jsonb_build_object('invoice_number', r.invoice_number, 'invoice_total', format_rand(r.total),
            'balance_due', format_rand(r.balance), 'due_date', format_sa_date(r.due_date)),
          r.id, null);
        perform automation_done(v_action, 'emailed', 'Email queued to the customer');
        c_done := c_done + 1;
      exception when sqlstate '23514' then
        -- The customer cannot be emailed (no address, opted out, bounced, or the template is off):
        -- recorded once, not retried every day.
        if sqlerrm not like 'message\_%' then
          raise;
        end if;
        perform automation_done(v_action, 'skipped', sqlerrm);
        c_skipped := c_skipped + 1;
      end;
    exception when others then
      c_failed := c_failed + 1;
      perform automation_failed(p_business_id, p_run, p_key, 'invoice', r.id,
        r.invoice_number || ' · ' || r.customer_name, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('checked', c_checked, 'done', c_done, 'skipped', c_skipped, 'failed', c_failed);
end;
$$;

-- Runs every switched-on scheduled automation, for one business or all. Safe to call twice at the
-- same moment: the second call finds the business busy and leaves it alone.
create function public.run_automations(
  p_business_id uuid default null, p_trigger text default 'schedule', p_started_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid;
  a automations;
  v_run uuid;
  v_res jsonb;
  v_status text;
  v_error text;
  v_results jsonb := '[]';
begin
  for b in select id from businesses where p_business_id is null or id = p_business_id order by id loop
    if not pg_try_advisory_xact_lock(hashtext('umbane-automations'), hashtext(b::text)) then
      v_results := v_results || jsonb_build_array(jsonb_build_object('business_id', b, 'status', 'busy'));
      continue;
    end if;
    for a in
      select * from automations
      where business_id = b and enabled
        and key in ('overdue_invoices', 'task_reminders', 'maintenance_reminders', 'payment_reminder',
                    'overdue_notice')
      order by key
    loop
      insert into automation_runs (business_id, automation_key, trigger, started_by)
      values (b, a.key, p_trigger, p_started_by)
      returning id into v_run;
      v_error := null;
      begin
        v_res := case a.key
          when 'overdue_invoices' then auto_overdue_invoices(b, v_run, a.settings)
          when 'task_reminders' then auto_task_reminders(b, v_run, a.settings)
          when 'maintenance_reminders' then auto_maintenance_reminders(b, v_run, a.settings)
          else auto_invoice_emails(b, v_run, a.key, a.settings)
        end;
      exception when others then
        v_res := '{"checked": 0, "done": 0, "skipped": 0, "failed": 0}';
        v_error := left(sqlerrm, 500);
      end;
      v_status := case
        when v_error is not null then 'failed'
        when (v_res ->> 'failed')::integer > 0 and (v_res ->> 'done')::integer > 0 then 'partial'
        when (v_res ->> 'failed')::integer > 0 then 'failed'
        when (v_res ->> 'done')::integer = 0 then 'nothing_to_do'
        else 'success'
      end;
      update automation_runs set finished_at = now(), status = v_status,
        checked = (v_res ->> 'checked')::integer, done = (v_res ->> 'done')::integer,
        skipped = (v_res ->> 'skipped')::integer, failed = (v_res ->> 'failed')::integer, error = v_error
      where id = v_run;
      update automations set last_run_at = now(), last_status = v_status,
        last_message = coalesce(v_error, (v_res ->> 'done') || ' done, ' || (v_res ->> 'skipped')
          || ' skipped, ' || (v_res ->> 'failed') || ' failed')
      where id = a.id;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('business_id', b, 'key', a.key, 'status', v_status) || v_res);
    end loop;
  end loop;
  return jsonb_build_object('runs', v_results);
end;
$$;

-- "Run now", for managers: the scheduled automations of their own business.
create function public.run_my_automations() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_manager_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return run_automations(current_business_id(), 'manual', auth.uid());
end;
$$;

-- Automations that react to changes -------------------------------------------------------------
-- They never stop the change itself: a failure is logged and the change goes ahead.

create function public.automation_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_out boolean := new.stock_on_hand <= 0;
  v_key text := 'low-stock:' || new.id || ':' || business_today() || ':'
                || case when new.stock_on_hand <= 0 then 'out' else 'low' end;
  v_action uuid;
  v_n integer;
begin
  -- Only when stock crosses the reorder level (or runs out), not on every sale below it.
  if not (new.is_active and new.track_stock and new.stock_on_hand <= new.low_stock_threshold
          and (old.stock_on_hand > old.low_stock_threshold or (v_out and old.stock_on_hand > 0)))
     or not automation_on(new.business_id, 'low_stock') then
    return null;
  end if;
  begin
    v_action := automation_claim(new.business_id, null, 'low_stock', v_key, 'product', new.id,
      new.sku || ' · ' || new.name);
    if v_action is not null then
      v_n := notify_people(business_managers(new.business_id), new.business_id, 'inventory',
        case when v_out then 'Out of stock: ' else 'Low stock: ' end || new.name,
        new.sku || ' has ' || new.stock_on_hand || ' left (reorder level ' || new.low_stock_threshold || ').',
        '/inventory/' || new.id, v_key, true);
      perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
    end if;
  exception when others then
    perform automation_failed(new.business_id, null, 'low_stock', 'product', new.id,
      new.sku || ' · ' || new.name, sqlerrm);
  end;
  return null;
end;
$$;
create trigger automation_low_stock after update of stock_on_hand on public.products
  for each row execute function public.automation_low_stock();

create function public.automation_new_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key text := 'new-customer:' || new.id;
  v_action uuid;
  v_n integer;
begin
  if not automation_on(new.business_id, 'new_customer') then
    return null;
  end if;
  begin
    v_action := automation_claim(new.business_id, null, 'new_customer', v_key, 'customer', new.id, new.name);
    if v_action is not null then
      v_n := notify_people(business_managers(new.business_id), new.business_id, 'customers',
        'New customer: ' || new.name,
        concat_ws(' · ', initcap(new.segment), new.province, new.email),
        '/customers/' || new.id, v_key, true);
      perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
    end if;
  exception when others then
    perform automation_failed(new.business_id, null, 'new_customer', 'customer', new.id, new.name, sqlerrm);
  end;
  return null;
end;
$$;
create trigger automation_new_customer after insert on public.customers
  for each row execute function public.automation_new_customer();

create function public.automation_ticket_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_action uuid;
  v_n integer;
  v_portal uuid;
  v_message text;
begin
  -- Urgent tickets: managers hear at once. A new unassigned ticket already alerts them (Phase 8),
  -- so this covers urgent tickets created already assigned, and tickets raised to urgent later.
  if new.priority = 'urgent'
     and ((tg_op = 'INSERT' and new.assigned_to is not null)
          or (tg_op = 'UPDATE' and old.priority <> 'urgent'))
     and automation_on(new.business_id, 'urgent_ticket') then
    v_key := 'urgent-ticket:' || new.id;
    begin
      v_action := automation_claim(new.business_id, null, 'urgent_ticket', v_key, 'ticket', new.id,
        new.reference || ' · ' || new.subject);
      if v_action is not null then
        v_n := notify_people(business_managers(new.business_id), new.business_id, 'tickets',
          'Urgent ticket ' || new.reference, new.subject, '/support-tickets/' || new.id, v_key, true);
        perform automation_done(v_action, case when v_n > 0 then 'notified' else 'skipped' end, reached(v_n));
      end if;
    exception when others then
      perform automation_failed(new.business_id, null, 'urgent_ticket', 'ticket', new.id,
        new.reference || ' · ' || new.subject, sqlerrm);
    end;
  end if;

  -- Status emails to customers. Customers who sign in already get these in the app (and by email if
  -- they choose), so this is for customers without a login. Only changes made by the team count.
  if tg_op = 'UPDATE' and new.status <> old.status and new.status in ('in_progress', 'resolved', 'closed')
     and auth.uid() is not null and is_staff_up()
     and automation_on(new.business_id, 'ticket_status_email') then
    select profile_id into v_portal from customers where id = new.customer_id;
    if v_portal is null then
      v_key := 'ticket-status:' || new.id || ':' || new.status || ':' || business_today();
      v_message := case new.status
        when 'in_progress' then 'We are working on your support ticket.'
        when 'resolved' then 'Your support ticket has been resolved.'
                             || coalesce(E'\n\n' || nullif(trim(new.resolution), ''), '')
        else 'Your support ticket has been closed.'
      end;
      begin
        v_action := automation_claim(new.business_id, null, 'ticket_status_email', v_key, 'ticket',
          new.id, new.reference || ' · ' || new.subject);
        if v_action is not null then
          begin
            perform automation_queue_email(new.business_id, new.customer_id, 'ticket_update',
              jsonb_build_object('ticket_reference', new.reference, 'ticket_subject', new.subject,
                'message', v_message),
              null, new.id);
            perform automation_done(v_action, 'emailed', 'Email queued to the customer');
          exception when sqlstate '23514' then
            if sqlerrm not like 'message\_%' then
              raise;
            end if;
            perform automation_done(v_action, 'skipped', sqlerrm);
          end;
        end if;
      exception when others then
        perform automation_failed(new.business_id, null, 'ticket_status_email', 'ticket', new.id,
          new.reference || ' · ' || new.subject, sqlerrm);
      end;
    end if;
  end if;
  return null;
end;
$$;
create trigger automation_ticket_changes after insert or update of priority, status on public.support_tickets
  for each row execute function public.automation_ticket_changes();

-- Access -----------------------------------------------------------------------------------------
revoke execute on function
  public.notify(uuid, uuid, text, text, text, text, text, boolean),
  public.notify_people(uuid[], uuid, text, text, text, text, text, boolean),
  public.business_managers(uuid),
  public.claim_notification_emails(integer, uuid),
  public.record_notification_email(uuid, boolean, text, boolean),
  public.due_messages_for(uuid, integer),
  public.automation_queue_email(uuid, uuid, text, jsonb, uuid, uuid),
  public.seed_automations(uuid), public.seed_business_automations(), public.check_automation(),
  public.automation_on(uuid, text),
  public.automation_claim(uuid, uuid, text, text, text, uuid, text),
  public.automation_done(uuid, text, text),
  public.automation_failed(uuid, uuid, text, text, uuid, text, text),
  public.auto_overdue_invoices(uuid, uuid, jsonb), public.auto_task_reminders(uuid, uuid, jsonb),
  public.auto_maintenance_reminders(uuid, uuid, jsonb),
  public.auto_invoice_emails(uuid, uuid, text, jsonb),
  public.run_automations(uuid, text, uuid),
  public.automation_low_stock(), public.automation_new_customer(), public.automation_ticket_changes()
from public, anon, authenticated;
grant execute on function
  public.claim_notification_emails(integer, uuid),
  public.record_notification_email(uuid, boolean, text, boolean),
  public.due_messages_for(uuid, integer),
  public.run_automations(uuid, text, uuid)
to service_role;
revoke execute on function public.run_my_automations() from public, anon;
grant execute on function public.run_my_automations() to authenticated;
