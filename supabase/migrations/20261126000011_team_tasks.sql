-- Phase 9: team and task management. The rules are explained in docs/TEAM.md.
--
-- Team: employment details live on profiles and only administrators change them. Administrators add
-- people by invitation: the browser has no server key, so the profile is created by the database
-- when the invited email confirms its account (Supabase -> Authentication -> Users -> Invite user).
--
-- Tasks: managers and administrators create and assign them; the assignee moves their own task
-- along, posts progress updates and uploads proof-of-work photos. History and notifications are
-- written here, by the database.

-- Employee details -------------------------------------------------------------------------------
alter table public.profiles
  add column employee_number integer,
  add column department text check (department in (
    'field_operations', 'customer_support', 'sales_billing', 'administration', 'marketing')),
  add column job_title text check (char_length(job_title) <= 80),
  add column employment_status text not null default 'active'
    check (employment_status in ('active', 'on_leave', 'training')),
  add column start_date date,
  add column reports_to uuid,
  add constraint profiles_reports_to_fkey foreign key (reports_to, business_id)
    references public.profiles (id, business_id) on delete set null (reports_to),
  add constraint profiles_not_own_manager check (reports_to is null or reports_to <> id);
create unique index profiles_employee_number_uniq on public.profiles (business_id, employee_number)
  where employee_number is not null;

-- Number the existing team in the order they joined: EMP-001, EMP-002, ...
with n as (
  select id, row_number() over (partition by business_id order by created_at, id) as rn
  from public.profiles where role <> 'client'
)
update public.profiles p set employee_number = n.rn from n where n.id = p.id;

create function public.number_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'client' and new.employee_number is null then
    perform pg_advisory_xact_lock(hashtext('employee_number:' || new.business_id));
    select coalesce(max(employee_number), 0) + 1 into new.employee_number
    from profiles where business_id = new.business_id;
  end if;
  return new;
end;
$$;
create trigger number_employee before insert or update of role on public.profiles
  for each row execute function public.number_employee();

-- Same rules as before, plus: employment details are the administrator's, the employee number never
-- changes, and nobody can deactivate or demote themselves (so a business never locks itself out).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id <> old.business_id then
    raise exception 'business_id cannot be changed';
  end if;
  if auth.uid() is not null and not public.is_admin()
     and (new.role <> old.role or new.is_active <> old.is_active) then
    raise exception 'only administrators can change role or active state';
  end if;
  if auth.uid() is not null and not public.is_admin() and (
       new.department is distinct from old.department
       or new.job_title is distinct from old.job_title
       or new.employment_status is distinct from old.employment_status
       or new.start_date is distinct from old.start_date
       or new.reports_to is distinct from old.reports_to) then
    raise exception 'staff_admin_only' using errcode = '42501';
  end if;
  if old.employee_number is not null and new.employee_number is distinct from old.employee_number then
    raise exception 'staff_fixed_fields' using errcode = '23514';
  end if;
  if auth.uid() is not null and new.id = auth.uid()
     and ((old.is_active and not new.is_active) or new.role <> old.role) then
    raise exception 'staff_self_lockout' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Invitations ------------------------------------------------------------------------------------
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  role public.user_role not null check (role <> 'client'),
  phone text check (phone ~ '^\+27[0-9]{9}$'),
  department text check (department in (
    'field_operations', 'customer_support', 'sales_billing', 'administration', 'marketing')),
  job_title text check (char_length(job_title) <= 80),
  start_date date,
  reports_to uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  invited_by uuid references public.profiles (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_invitations_reports_to_fkey foreign key (reports_to, business_id)
    references public.profiles (id, business_id) on delete set null (reports_to)
);
-- One open invitation per email, across businesses, so an account can only ever join one.
create unique index staff_invitations_pending_email on public.staff_invitations (email)
  where status = 'pending';
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon;
create policy staff_invitations_admin_select on public.staff_invitations for select to authenticated
  using (business_id = public.current_business_id() and public.is_admin());
create policy staff_invitations_admin_update on public.staff_invitations for update to authenticated
  using (business_id = public.current_business_id() and public.is_admin())
  with check (business_id = public.current_business_id() and public.is_admin());

-- Only a pending invitation can change, and only to be cancelled.
create function public.check_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() < 2 and auth.uid() is not null
     and (old.status <> 'pending' or new.status <> 'cancelled'
          or (new.email, new.role, new.business_id) is distinct from (old.email, old.role, old.business_id)) then
    raise exception 'invitation_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_staff_invitation before update on public.staff_invitations
  for each row execute function public.check_staff_invitation();

-- Adds someone to the team. If they already have a confirmed account with no profile, the profile is
-- created now ('linked'); otherwise it waits for them to confirm an invited account ('invited').
create function public.invite_staff(
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
revoke execute on function public.invite_staff(text, text, public.user_role, text, text, text, date, uuid)
  from public, anon;
grant execute on function public.invite_staff(text, text, public.user_role, text, text, text, date, uuid)
  to authenticated;

-- When an invited email confirms its account, its profile is created. Never blocks signing in: if
-- the profile cannot be made, the invitation stays pending and the administrator can try again.
create function public.link_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv staff_invitations;
begin
  if new.email_confirmed_at is null or exists (select 1 from profiles where id = new.id) then
    return new;
  end if;
  select * into inv from staff_invitations
  where status = 'pending' and email = lower(new.email) for update;
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
revoke execute on function public.link_staff_invitation() from public, anon, authenticated;
create trigger link_staff_invitation after insert or update of email_confirmed_at on auth.users
  for each row execute function public.link_staff_invitation();

-- Tasks: links include the business ------------------------------------------------------------
alter table public.staff_tasks add constraint tasks_id_business_key unique (id, business_id);
alter table public.staff_tasks drop constraint staff_tasks_assigned_to_fkey;
alter table public.staff_tasks drop constraint staff_tasks_created_by_fkey;
alter table public.staff_tasks drop constraint staff_tasks_customer_id_fkey;
alter table public.staff_tasks drop constraint staff_tasks_property_id_fkey;
alter table public.staff_tasks drop constraint staff_tasks_ticket_id_fkey;
alter table public.staff_tasks
  add constraint tasks_assignee_fkey foreign key (assigned_to, business_id)
    references public.profiles (id, business_id) on delete set null (assigned_to),
  add constraint tasks_created_by_fkey foreign key (created_by, business_id)
    references public.profiles (id, business_id) on delete set null (created_by),
  add constraint tasks_customer_fkey foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete set null (customer_id),
  add constraint tasks_property_fkey foreign key (property_id, business_id)
    references public.properties (id, business_id) on delete set null (property_id),
  add constraint tasks_ticket_fkey foreign key (ticket_id, business_id)
    references public.support_tickets (id, business_id) on delete set null (ticket_id);
alter table public.staff_tasks alter column business_id set default public.current_business_id();

alter table public.staff_tasks
  add column number bigint generated always as identity,
  add column category text not null default 'other' check (category in (
    'field_maintenance', 'meter_installation', 'billing_audit', 'customer_support', 'sales_follow_up',
    'other')),
  add column start_date date,
  add column proof_required boolean not null default false,
  add column started_at timestamptz,
  add column completed_by uuid,
  add column cancel_reason text check (char_length(cancel_reason) <= 500),
  add column last_activity_at timestamptz not null default now(),
  add constraint tasks_completed_by_fkey foreign key (completed_by, business_id)
    references public.profiles (id, business_id) on delete set null (completed_by),
  add constraint tasks_title_length check (char_length(title) <= 150),
  add constraint tasks_description_length check (char_length(description) <= 5000),
  add constraint tasks_dates check (due_date is null or start_date is null or due_date >= start_date);
create index tasks_status_idx on public.staff_tasks (business_id, status);

-- Progress updates, proof-of-work files and history ----------------------------------------------
create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete restrict,
  task_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  author_name text,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint task_updates_task_fkey foreign key (task_id, business_id)
    references public.staff_tasks (id, business_id) on delete cascade
);
create index task_updates_task_idx on public.task_updates (task_id, created_at);

-- Files live in the private "task-attachments" bucket at <business id>/<task id>/<file>.
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete restrict,
  task_id uuid not null,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploader_name text,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  constraint task_attachments_task_fkey foreign key (task_id, business_id)
    references public.staff_tasks (id, business_id) on delete cascade
);
create index task_attachments_task_idx on public.task_attachments (task_id);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  task_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'assigned', 'priority', 'due', 'attachment')),
  from_value text,
  to_value text,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint task_events_task_fkey foreign key (task_id, business_id)
    references public.staff_tasks (id, business_id) on delete cascade
);
create index task_events_task_idx on public.task_events (task_id, created_at);

-- Managers see everything about tasks; staff see what belongs to tasks assigned to them.
create function public.can_see_task(p_task_id uuid, p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_business_id = current_business_id() and (
    is_manager_up()
    or (is_staff_up() and exists (
      select 1 from staff_tasks where id = p_task_id and assigned_to = auth.uid())))
$$;
revoke execute on function public.can_see_task(uuid, uuid) from public, anon;
grant execute on function public.can_see_task(uuid, uuid) to authenticated;

alter table public.task_updates enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_events enable row level security;
revoke all on public.task_updates, public.task_attachments, public.task_events from anon;
revoke insert, update, delete, truncate on public.task_events from authenticated;
create policy task_updates_select on public.task_updates for select to authenticated
  using (public.can_see_task(task_id, business_id));
create policy task_updates_insert on public.task_updates for insert to authenticated
  with check (public.can_see_task(task_id, business_id));
create policy task_updates_manager_delete on public.task_updates for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (public.can_see_task(task_id, business_id));
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id, business_id));
create policy task_attachments_manager_delete on public.task_attachments for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
create policy task_events_select on public.task_events for select to authenticated
  using (public.can_see_task(task_id, business_id));

-- Task rules -------------------------------------------------------------------------------------
create function public.assert_task_caller(p_task staff_tasks) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and (
       p_task.business_id is distinct from current_business_id()
       or not (is_manager_up() or (is_staff_up() and p_task.assigned_to = auth.uid()))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.assert_task_caller(staff_tasks) from public, anon, authenticated;

create function public.check_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null
       and not (is_manager_up() and new.business_id = current_business_id()) then
      raise exception 'permission denied' using errcode = '42501';
    end if;
    if new.status not in ('todo', 'in_progress') then
      raise exception 'task_transition' using errcode = '23514';
    end if;
    perform assert_ticket_assignee(new.assigned_to, new.business_id);
    if new.status = 'in_progress' and new.assigned_to is null then
      raise exception 'task_needs_assignee' using errcode = '23514';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    new.started_at := case when new.status = 'in_progress' then now() end;
    new.completed_at := null;
    new.completed_by := null;
    new.cancel_reason := null;
    new.last_activity_at := now();
  else
    if pg_trigger_depth() < 2 and auth.uid() is not null then
      if old.business_id is distinct from current_business_id() or not is_staff_up() then
        raise exception 'permission denied' using errcode = '42501';
      end if;
      if not is_manager_up() then
        -- The assignee only moves their own open task along.
        if old.assigned_to is distinct from auth.uid() then
          raise exception 'permission denied' using errcode = '42501';
        end if;
        if (new.title, new.description, new.category, new.priority, new.start_date, new.due_date,
            new.assigned_to, new.customer_id, new.property_id, new.ticket_id, new.proof_required,
            new.cancel_reason)
           is distinct from
           (old.title, old.description, old.category, old.priority, old.start_date, old.due_date,
            old.assigned_to, old.customer_id, old.property_id, old.ticket_id, old.proof_required,
            old.cancel_reason)
           or new.status = 'cancelled' or old.status in ('done', 'cancelled') then
          raise exception 'task_manager_only' using errcode = '23514';
        end if;
      end if;
      if old.status in ('done', 'cancelled') and new.status = old.status then
        raise exception 'task_closed' using errcode = '23514';
      end if;
    end if;
    if new.business_id <> old.business_id or new.number <> old.number
       or new.created_at <> old.created_at
       or (new.created_by is distinct from old.created_by and new.created_by is not null) then
      raise exception 'task_fixed_fields' using errcode = '23514';
    end if;

    -- Timestamps are the database's.
    new.started_at := old.started_at;
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
    new.last_activity_at := now();

    if new.assigned_to is distinct from old.assigned_to then
      perform assert_ticket_assignee(new.assigned_to, new.business_id);
      if new.assigned_to is null and new.status = 'in_progress' and old.status = 'in_progress' then
        new.status := 'todo';
      end if;
    end if;

    if new.status <> old.status then
      if new.status in ('in_progress', 'done') and new.assigned_to is null then
        raise exception 'task_needs_assignee' using errcode = '23514';
      end if;
      if new.status = 'cancelled'
         and nullif(trim(coalesce(new.cancel_reason, '')), '') is null then
        raise exception 'task_cancel_reason' using errcode = '23514';
      end if;
      if new.status = 'done' then
        if new.proof_required and not exists (
          select 1 from task_attachments where task_id = new.id and content_type like 'image/%') then
          raise exception 'task_proof_required' using errcode = '23514';
        end if;
        new.completed_at := now();
        new.completed_by := coalesce(auth.uid(), new.assigned_to);
      else
        new.completed_at := null;
        new.completed_by := null;
      end if;
      if new.status <> 'cancelled' then
        new.cancel_reason := null;
      end if;
      if new.status = 'in_progress' and new.started_at is null then
        new.started_at := now();
      end if;
    end if;

    if new.ticket_id is not distinct from old.ticket_id
       and new.property_id is not distinct from old.property_id
       and new.customer_id is not distinct from old.customer_id then
      return new;
    end if;
  end if;

  -- A ticket or property fills in the customer, and must agree with the one chosen.
  if new.ticket_id is not null then
    select customer_id into owner_id from support_tickets
    where id = new.ticket_id and business_id = new.business_id;
    if new.customer_id is null then
      new.customer_id := owner_id;
    elsif owner_id is distinct from new.customer_id then
      raise exception 'task_ticket_mismatch' using errcode = '23514';
    end if;
  end if;
  if new.property_id is not null then
    select customer_id into owner_id from properties
    where id = new.property_id and business_id = new.business_id;
    if new.customer_id is null then
      new.customer_id := owner_id;
    elsif owner_id is distinct from new.customer_id then
      raise exception 'task_property_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger check_task before insert or update on public.staff_tasks
  for each row execute function public.check_task();

create function public.after_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_name text := (select full_name from profiles where id = auth.uid());
  ref text := 'TSK-' || lpad(new.number::text, 5, '0');
  summary text := ref || ': ' || new.title;
  link text := '/tasks/' || new.id;
begin
  if tg_op = 'INSERT' then
    insert into task_events (business_id, task_id, kind, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'created', new.status, auth.uid(), actor_name);
    perform notify_user(new.assigned_to, new.business_id, 'Task assigned to you', summary, link);
    return null;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into task_events (business_id, task_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'assigned',
      (select full_name from profiles where id = old.assigned_to),
      (select full_name from profiles where id = new.assigned_to), auth.uid(), actor_name);
    perform notify_user(new.assigned_to, new.business_id, 'Task assigned to you', summary, link);
  end if;
  if new.status <> old.status then
    insert into task_events (business_id, task_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'status', old.status, new.status, auth.uid(), actor_name);
    if new.status = 'done' then
      perform notify_user(new.created_by, new.business_id, 'Task completed', summary, link);
    elsif new.status = 'cancelled' then
      perform notify_user(new.assigned_to, new.business_id, 'Task cancelled', summary, link);
    end if;
  end if;
  if new.priority <> old.priority then
    insert into task_events (business_id, task_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'priority', old.priority, new.priority, auth.uid(), actor_name);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into task_events (business_id, task_id, kind, from_value, to_value, actor_id, actor_name)
    values (new.business_id, new.id, 'due', old.due_date::text, new.due_date::text, auth.uid(),
      actor_name);
  end if;
  return null;
end;
$$;
create trigger after_task_change after insert or update on public.staff_tasks
  for each row execute function public.after_task_change();

create function public.check_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t staff_tasks;
begin
  select * into t from staff_tasks where id = new.task_id for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform assert_task_caller(t);
  new.business_id := t.business_id;
  if auth.uid() is not null then
    new.author_id := auth.uid();
    new.created_at := now();
  end if;
  new.author_name := (select full_name from profiles where id = new.author_id);
  if t.status in ('done', 'cancelled') then
    raise exception 'task_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_task_update before insert on public.task_updates
  for each row execute function public.check_task_update();

create function public.after_task_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t staff_tasks;
  preview text := left(new.body, 140);
begin
  update staff_tasks set last_activity_at = now() where id = new.task_id returning * into t;
  perform notify_user(t.created_by, t.business_id,
    'Update on TSK-' || lpad(t.number::text, 5, '0'), preview, '/tasks/' || t.id);
  if t.assigned_to is distinct from t.created_by then
    perform notify_user(t.assigned_to, t.business_id,
      'Update on TSK-' || lpad(t.number::text, 5, '0'), preview, '/tasks/' || t.id);
  end if;
  return null;
end;
$$;
create trigger after_task_update after insert on public.task_updates
  for each row execute function public.after_task_update();

create function public.check_task_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t staff_tasks;
  stored jsonb;
  prefix text;
begin
  select * into t from staff_tasks where id = new.task_id for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform assert_task_caller(t);
  new.business_id := t.business_id;
  if auth.uid() is not null then
    new.uploaded_by := auth.uid();
    new.created_at := now();
  end if;
  new.uploader_name := (select full_name from profiles where id = new.uploaded_by);
  if t.status in ('done', 'cancelled') then
    raise exception 'task_closed' using errcode = '23514';
  end if;
  if (select count(*) from task_attachments where task_id = t.id) >= 20 then
    raise exception 'task_attachment_limit' using errcode = '23514';
  end if;
  prefix := t.business_id || '/' || t.id || '/';
  if left(new.storage_path, length(prefix)) <> prefix
     or length(new.storage_path) = length(prefix)
     or position('/' in substr(new.storage_path, length(prefix) + 1)) > 0 then
    raise exception 'attachment_path_mismatch' using errcode = '23514';
  end if;
  select metadata into stored from storage.objects
  where bucket_id = 'task-attachments' and name = new.storage_path;
  if not found then
    raise exception 'attachment_not_uploaded' using errcode = '23514';
  end if;
  new.size_bytes := coalesce((stored ->> 'size')::integer, new.size_bytes);
  new.content_type := coalesce(stored ->> 'mimetype', new.content_type);
  return new;
end;
$$;
create trigger check_task_attachment before insert on public.task_attachments
  for each row execute function public.check_task_attachment();

create function public.after_task_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into task_events (business_id, task_id, kind, to_value, actor_id, actor_name)
  values (new.business_id, new.task_id, 'attachment', new.file_name, new.uploaded_by, new.uploader_name);
  update staff_tasks set last_activity_at = now() where id = new.task_id;
  return null;
end;
$$;
create trigger after_task_attachment after insert on public.task_attachments
  for each row execute function public.after_task_attachment();

revoke execute on function
  public.number_employee(), public.check_staff_invitation(), public.check_task(),
  public.after_task_change(), public.check_task_update(), public.after_task_update(),
  public.check_task_attachment(), public.after_task_attachment()
from public, anon, authenticated;

-- Removing a task, update or file is for managers; keep a record of who did it.
create trigger audit_row_change after delete on public.staff_tasks
  for each row execute function public.audit_row_change();
create trigger audit_row_change after delete on public.task_updates
  for each row execute function public.audit_row_change();
create trigger audit_row_change after delete on public.task_attachments
  for each row execute function public.audit_row_change();

-- Storage: proof-of-work photos and documents, private, following task access -------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.task_file_access(p_name text, p_write boolean) returns boolean
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
    select 1 from staff_tasks t
    where t.id = parts[2]::uuid and t.business_id = parts[1]::uuid
      and t.business_id = current_business_id()
      and (is_manager_up() or (is_staff_up() and t.assigned_to = auth.uid()))
      and (not p_write or t.status in ('todo', 'in_progress')));
end;
$$;
revoke execute on function public.task_file_access(text, boolean) from public, anon;
grant execute on function public.task_file_access(text, boolean) to authenticated;

create policy umbane_task_files_select on storage.objects for select to authenticated
  using (bucket_id = 'task-attachments' and public.task_file_access(name, false));
create policy umbane_task_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-attachments' and public.task_file_access(name, true));
create policy umbane_task_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-attachments' and public.is_manager_up()
         and public.task_file_access(name, false));

-- Views (they obey the caller's row security) ---------------------------------------------------
create view public.task_list with (security_invoker = true) as
select
  t.id, t.number, 'TSK-' || lpad(t.number::text, 5, '0') as reference,
  t.title, t.description, t.category, t.status, t.priority, t.start_date, t.due_date,
  t.proof_required, t.assigned_to, a.full_name as assignee_name,
  t.created_by, cb.full_name as created_by_name,
  t.customer_id, c.name as customer_name,
  t.property_id, coalesce(p.name, p.address) as property_name,
  t.ticket_id, tk.reference as ticket_reference,
  t.started_at, t.completed_at, t.completed_by, cp.full_name as completed_by_name,
  t.cancel_reason, t.created_at, t.last_activity_at,
  t.status in ('todo', 'in_progress') and t.due_date < public.business_today() as is_overdue,
  case when t.status in ('todo', 'in_progress') and t.due_date < public.business_today()
       then 'overdue' else t.status end as display_status,
  (select count(*) from task_updates u where u.task_id = t.id)::integer as update_count,
  (select count(*) from task_attachments f where f.task_id = t.id)::integer as attachment_count,
  (select count(*) from task_attachments f where f.task_id = t.id and f.content_type like 'image/%')::integer
    as photo_count
from public.staff_tasks t
left join public.profiles a on a.id = t.assigned_to
left join public.profiles cb on cb.id = t.created_by
left join public.profiles cp on cp.id = t.completed_by
left join public.customers c on c.id = t.customer_id
left join public.properties p on p.id = t.property_id
left join public.support_tickets tk on tk.id = t.ticket_id;

create view public.task_summary with (security_invoker = true) as
select
  count(*) filter (where status = 'todo')::integer as pending,
  count(*) filter (where status = 'in_progress')::integer as in_progress,
  count(*) filter (where status in ('todo', 'in_progress')
                   and due_date < public.business_today())::integer as overdue,
  count(*) filter (where status = 'done' and date_trunc('month', completed_at at time zone 'Africa/Johannesburg')
                   = date_trunc('month', public.business_today()::timestamp))::integer as completed_this_month,
  count(*) filter (where status = 'done')::integer as completed,
  count(*) filter (where status = 'cancelled')::integer as cancelled
from public.staff_tasks;

-- The team with each person's workload. Staff only count their own tasks; the page is for managers.
create view public.team_list with (security_invoker = true) as
select
  p.id, p.employee_number, 'EMP-' || lpad(p.employee_number::text, 3, '0') as employee_code,
  p.full_name, p.email, p.phone, p.role, p.department, p.job_title, p.employment_status,
  p.is_active, p.start_date, p.reports_to, r.full_name as reports_to_name, p.created_at,
  coalesce(w.active_tasks, 0) as active_tasks,
  coalesce(w.overdue_tasks, 0) as overdue_tasks,
  coalesce(w.completed_this_month, 0) as completed_this_month,
  coalesce(w.completed_tasks, 0) as completed_tasks,
  coalesce(w.completed_with_due, 0) as completed_with_due,
  coalesce(w.completed_on_time, 0) as completed_on_time
from public.profiles p
left join public.profiles r on r.id = p.reports_to
left join lateral (
  select
    count(*) filter (where t.status in ('todo', 'in_progress'))::integer as active_tasks,
    count(*) filter (where t.status in ('todo', 'in_progress')
                     and t.due_date < public.business_today())::integer as overdue_tasks,
    count(*) filter (where t.status = 'done' and date_trunc('month', t.completed_at at time zone 'Africa/Johannesburg')
                     = date_trunc('month', public.business_today()::timestamp))::integer as completed_this_month,
    count(*) filter (where t.status = 'done')::integer as completed_tasks,
    count(*) filter (where t.status = 'done' and t.due_date is not null)::integer as completed_with_due,
    count(*) filter (where t.status = 'done' and t.due_date is not null
                     and (t.completed_at at time zone 'Africa/Johannesburg')::date <= t.due_date)::integer
      as completed_on_time
  from public.staff_tasks t where t.assigned_to = p.id
) w on true
where p.role <> 'client';

revoke all on public.task_list, public.task_summary, public.team_list from anon;
grant select on public.task_list, public.task_summary, public.team_list to authenticated;
