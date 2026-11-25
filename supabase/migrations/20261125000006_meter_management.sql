-- Electricity and meter management (Phase 4).
-- Reading rules are enforced here, not only in the app: readings feed billing, so an invalid one must
-- be impossible however it is sent. Calculation assumptions are in docs/METERS.md.

-- "Today" for the business. South Africa is UTC+2, so just after midnight the UTC date is yesterday.
create function public.business_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Africa/Johannesburg')::date
$$;
revoke execute on function public.business_today() from public, anon;
grant execute on function public.business_today() to authenticated;

-- Links stay inside one business --------------------------------------------------------------
-- Row policies check the new row's own business_id but not the row it points at. Including
-- business_id in the foreign key makes a cross-business link impossible. The old single-column keys
-- are replaced, not kept beside these: two keys between the same tables make API joins ambiguous.
alter table public.customers add constraint customers_id_business_key unique (id, business_id);
alter table public.properties add constraint properties_id_business_key unique (id, business_id);
alter table public.electricity_meters add constraint meters_id_business_key unique (id, business_id);
alter table public.profiles add constraint profiles_id_business_key unique (id, business_id);

alter table public.properties drop constraint properties_customer_id_fkey;
alter table public.properties add constraint properties_customer_id_fkey
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete restrict;
alter table public.electricity_meters drop constraint electricity_meters_property_id_fkey;
alter table public.electricity_meters add constraint electricity_meters_property_id_fkey
  foreign key (property_id, business_id) references public.properties (id, business_id) on delete restrict;
alter table public.meter_readings drop constraint meter_readings_meter_id_fkey;
alter table public.meter_readings add constraint meter_readings_meter_id_fkey
  foreign key (meter_id, business_id) references public.electricity_meters (id, business_id) on delete restrict;

-- Meters ----------------------------------------------------------------------------------------
alter table public.electricity_meters
  add column meter_type text
    check (meter_type in ('three_phase_ct', 'smart_prepaid', 'conventional', 'split_keypad')),
  add column category text
    check (category in ('commercial_bulk', 'residential_sub', 'industrial_hv', 'common_area')),
  add column location text check (char_length(location) <= 200),
  add column installer_name text check (char_length(installer_name) <= 120),
  add column notes text check (char_length(notes) <= 1000),
  add column retired_on date,
  add column retired_reason text check (char_length(retired_reason) <= 500),
  add column replaced_by_id uuid references public.electricity_meters (id) on delete set null;

alter table public.electricity_meters alter column business_id set default public.current_business_id();

update public.electricity_meters set retired_on = greatest(public.business_today(), installed_on)
  where status in ('replaced', 'decommissioned');

alter table public.electricity_meters drop constraint electricity_meters_status_check;
alter table public.electricity_meters
  add constraint electricity_meters_status_check check (
    status in ('active', 'maintenance', 'faulty', 'inactive', 'replaced', 'decommissioned')),
  add constraint meters_retired_has_date check (
    (status in ('replaced', 'decommissioned')) = (retired_on is not null)),
  add constraint meters_retired_after_install check (
    retired_on is null or installed_on is null or retired_on >= installed_on);

-- The same serial typed in a different case is the same meter.
create unique index meters_business_serial_ci_uniq
  on public.electricity_meters (business_id, lower(btrim(serial_number)));

create function public.check_meter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.installed_on > business_today() then
    raise exception 'meter_installed_in_future' using errcode = '23514';
  end if;
  if new.retired_on > business_today() then
    raise exception 'meter_retired_in_future' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id then
      raise exception 'business_id cannot be changed';
    end if;
    if exists (select 1 from meter_readings where meter_id = new.id and reading_date < new.installed_on) then
      raise exception 'meter_installed_after_reading' using errcode = '23514';
    end if;
    if exists (select 1 from meter_readings where meter_id = new.id and reading_date > new.retired_on) then
      raise exception 'meter_retired_before_reading' using errcode = '23514';
    end if;
    -- Putting a retired meter back into service rewrites history, so it needs a manager.
    if old.retired_on is not null and new.retired_on is null
       and auth.uid() is not null and not is_manager_up() then
      raise exception 'meter_retired' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_meter() from public, anon, authenticated;
create trigger check_meter before insert or update on public.electricity_meters
  for each row execute function public.check_meter();

-- Readings --------------------------------------------------------------------------------------
alter table public.meter_readings
  add column method text not null default 'manual'
    check (method in ('manual', 'handheld', 'customer', 'remote')),
  add column notes text check (char_length(notes) <= 500),
  -- Set by the trigger below; null = nothing unusual.
  add column flag text check (flag in ('high', 'low'));

alter table public.meter_readings alter column business_id set default public.current_business_id();

-- Rules: not in the future, within the meter's service life, never below the reading before it or
-- above the one after it. Unusual (allowed, but flagged): daily use over 3x, or under a fifth of, the
-- meter's average over up to its six previous intervals, once there are at least two of them.
create function public.check_meter_reading() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.electricity_meters;
  prev record;
  nxt record;
  base record;
  daily numeric;
  baseline numeric;
begin
  -- This runs before the row policies and with owner rights, so check the caller first: otherwise
  -- the error messages below would reveal another business's readings.
  if auth.uid() is not null
     and (not is_staff_up() or new.business_id is distinct from current_business_id()) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- The lock makes two people submitting at once take turns, so each sees the other's reading.
  select * into m from electricity_meters
    where id = new.meter_id and business_id = new.business_id for update;
  if m.id is null then
    raise exception 'reading_meter_not_found' using errcode = '23503';
  end if;
  if new.reading_date > business_today() then
    raise exception 'reading_in_future' using errcode = '23514';
  end if;
  if new.reading_date < m.installed_on then
    raise exception 'reading_before_install' using errcode = '23514';
  end if;
  if new.reading_date > m.retired_on then
    raise exception 'reading_after_retirement' using errcode = '23514';
  end if;

  select reading_date, reading_value into prev from meter_readings
    where meter_id = new.meter_id and reading_date < new.reading_date
    order by reading_date desc limit 1;
  select reading_date, reading_value into nxt from meter_readings
    where meter_id = new.meter_id and reading_date > new.reading_date
    order by reading_date limit 1;
  if prev.reading_value is not null and new.reading_value < prev.reading_value then
    raise exception 'reading_below_previous' using errcode = '23514';
  end if;
  if nxt.reading_value is not null and new.reading_value > nxt.reading_value then
    raise exception 'reading_above_next' using errcode = '23514';
  end if;

  -- The caller cannot choose the flag or who recorded the reading.
  new.flag := null;
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;

  select count(*) as n, max(reading_date) - min(reading_date) as days,
         max(reading_value) - min(reading_value) as used
    into base
    from (
      select reading_date, reading_value from meter_readings
      where meter_id = new.meter_id and reading_date < new.reading_date
      order by reading_date desc limit 7
    ) recent;
  if base.n >= 3 and base.used > 0 then
    baseline := base.used / base.days;
    daily := (new.reading_value - prev.reading_value) / (new.reading_date - prev.reading_date);
    if daily > baseline * 3 then
      new.flag := 'high';
    elsif daily < baseline / 5 then
      new.flag := 'low';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_meter_reading() from public, anon, authenticated;
create trigger check_meter_reading before insert on public.meter_readings
  for each row execute function public.check_meter_reading();

-- Readings are corrected by a manager deleting and re-recording, so the audit keeps the values.
create function public.audit_meter_reading() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec public.meter_readings := case when tg_op = 'DELETE' then old else new end;
begin
  insert into audit_logs (business_id, actor_id, action, table_name, record_id, details)
  values (rec.business_id, auth.uid(), tg_op, tg_table_name, rec.id, jsonb_build_object(
    'meter_id', rec.meter_id, 'reading_date', rec.reading_date,
    'reading_value', rec.reading_value, 'is_estimate', rec.is_estimate));
  return rec;
end;
$$;
revoke execute on function public.audit_meter_reading() from public, anon, authenticated;
create trigger audit_meter_reading after insert or delete on public.meter_readings
  for each row execute function public.audit_meter_reading();
create trigger audit_row_change after insert or update or delete on public.electricity_meters
  for each row execute function public.audit_row_change();

-- Maintenance -----------------------------------------------------------------------------------
create table public.meter_maintenance (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  business_id uuid not null default public.current_business_id()
    references public.businesses (id) on delete restrict,
  meter_id uuid not null,
  kind text not null default 'repair'
    check (kind in ('inspection', 'repair', 'calibration', 'replacement', 'decommission')),
  issue text not null check (char_length(btrim(issue)) between 3 and 500),
  priority text not null default 'routine' check (priority in ('urgent', 'high', 'medium', 'routine')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'pending', 'in_progress', 'completed', 'cancelled')),
  scheduled_for date,
  assigned_to uuid,
  outcome text check (char_length(outcome) <= 1000),
  completed_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_meter_fkey foreign key (meter_id, business_id)
    references public.electricity_meters (id, business_id) on delete restrict,
  constraint maintenance_assignee_fkey foreign key (assigned_to, business_id)
    references public.profiles (id, business_id) on delete set null (assigned_to),
  constraint maintenance_scheduled_has_date check (status <> 'scheduled' or scheduled_for is not null),
  constraint maintenance_completed_has_outcome check (
    status <> 'completed' or char_length(btrim(coalesce(outcome, ''))) >= 3)
);
create index maintenance_business_status_idx on public.meter_maintenance (business_id, status, scheduled_for);
create index maintenance_meter_idx on public.meter_maintenance (meter_id, created_at desc);

create function public.check_meter_maintenance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (not is_staff_up() or new.business_id is distinct from current_business_id()) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from profiles
    where id = new.assigned_to and business_id = new.business_id and role <> 'client'
  ) then
    raise exception 'maintenance_assignee_not_staff' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  -- The completion date follows the status, so the two can never disagree.
  if new.status = 'completed' then
    new.completed_on := least(coalesce(new.completed_on, business_today()), business_today());
  else
    new.completed_on := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_meter_maintenance() from public, anon, authenticated;
create trigger check_meter_maintenance before insert or update on public.meter_maintenance
  for each row execute function public.check_meter_maintenance();
create trigger set_updated_at before update on public.meter_maintenance
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.meter_maintenance
  for each row execute function public.audit_row_change();

-- Staff only: work notes and technician names are internal, so clients have no policy here.
alter table public.meter_maintenance enable row level security;
create policy maintenance_staff_select on public.meter_maintenance for select to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up());
create policy maintenance_staff_insert on public.meter_maintenance for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_staff_up());
create policy maintenance_staff_update on public.meter_maintenance for update to authenticated
  using (business_id = public.current_business_id() and public.is_staff_up())
  with check (business_id = public.current_business_id() and public.is_staff_up());
create policy maintenance_manager_delete on public.meter_maintenance for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
revoke all on public.meter_maintenance from anon;

-- Multi-step actions: all or nothing -----------------------------------------------------------
-- Both run with the caller's rights, so every policy and rule above still applies.
create function public.register_meter(
  p_property_id uuid, p_serial_number text, p_meter_type text, p_category text,
  p_installed_on date, p_initial_reading numeric,
  p_location text default null, p_installer_name text default null, p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  new_id uuid;
begin
  insert into electricity_meters
    (property_id, serial_number, meter_type, category, installed_on, location, installer_name, notes)
  values
    (p_property_id, btrim(p_serial_number), p_meter_type, p_category, p_installed_on,
     p_location, p_installer_name, p_notes)
  returning id into new_id;
  insert into meter_readings (meter_id, reading_date, reading_value, notes)
  values (new_id, p_installed_on, p_initial_reading, 'Initial reading at installation');
  return new_id;
end;
$$;

-- With a new serial number the meter is replaced; without one it is decommissioned.
create function public.retire_meter(
  p_meter_id uuid, p_retired_on date, p_reason text, p_final_reading numeric default null,
  p_new_serial_number text default null, p_new_initial_reading numeric default 0
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  m electricity_meters;
  new_id uuid;
  replacing boolean := nullif(btrim(coalesce(p_new_serial_number, '')), '') is not null;
begin
  select * into m from electricity_meters where id = p_meter_id for update;
  if m.id is null then
    raise exception 'meter_not_found' using errcode = '42501';
  end if;
  if m.retired_on is not null then
    raise exception 'meter_retired' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'meter_reason_required' using errcode = '23514';
  end if;

  if p_final_reading is not null then
    insert into meter_readings (meter_id, reading_date, reading_value, notes)
    values (m.id, p_retired_on, p_final_reading, 'Final reading');
  end if;

  if replacing then
    insert into electricity_meters (property_id, serial_number, meter_type, category, installed_on, location)
    values (m.property_id, btrim(p_new_serial_number), m.meter_type, m.category, p_retired_on, m.location)
    returning id into new_id;
    insert into meter_readings (meter_id, reading_date, reading_value, notes)
    values (new_id, p_retired_on, p_new_initial_reading, 'Initial reading at installation');
  end if;

  update electricity_meters set
    status = case when replacing then 'replaced' else 'decommissioned' end,
    retired_on = p_retired_on, retired_reason = btrim(p_reason), replaced_by_id = new_id
  where id = m.id;

  -- Work orders for a meter that is no longer there can never be done.
  update meter_maintenance set status = 'cancelled', outcome = 'Cancelled: the meter was taken out of service.'
  where meter_id = m.id and status in ('scheduled', 'pending', 'in_progress');

  insert into meter_maintenance (meter_id, kind, issue, status, scheduled_for, outcome, completed_on)
  values (
    m.id, case when replacing then 'replacement' else 'decommission' end, btrim(p_reason), 'completed',
    p_retired_on,
    case when replacing then 'Replaced by ' || btrim(p_new_serial_number) else 'Decommissioned' end,
    p_retired_on);
  return new_id;
end;
$$;

revoke execute on function
  public.register_meter(uuid, text, text, text, date, numeric, text, text, text),
  public.retire_meter(uuid, date, text, numeric, text, numeric)
from public, anon;
grant execute on function
  public.register_meter(uuid, text, text, text, date, numeric, text, text, text),
  public.retire_meter(uuid, date, text, numeric, text, numeric)
to authenticated;

-- Read models (security_invoker: the caller's row policies keep applying) ----------------------
-- Each reading with the consumption since the one before it. An interval is an estimate when either
-- of its ends is.
create view public.meter_reading_history with (security_invoker = true) as
select
  r.id, r.business_id, r.meter_id, r.reading_date, r.reading_value, r.is_estimate, r.method,
  r.notes, r.flag, r.created_at,
  p.full_name as recorded_by_name,
  lag(r.reading_date) over w as previous_date,
  lag(r.reading_value) over w as previous_value,
  r.reading_value - lag(r.reading_value) over w as consumption,
  r.reading_date - lag(r.reading_date) over w as days,
  (r.is_estimate or coalesce(lag(r.is_estimate) over w, false)) as consumption_is_estimate
from public.meter_readings r
left join public.profiles p on p.id = r.recorded_by
window w as (partition by r.meter_id order by r.reading_date);

-- Consumption per calendar month: each interval is spread evenly over its days.
create view public.meter_monthly_consumption with (security_invoker = true) as
select
  h.business_id,
  h.meter_id,
  mth::date as month,
  sum(h.consumption * o.days / h.days)::numeric(16, 3) as kwh,
  sum(o.days)::integer as days_covered,
  bool_or(h.consumption_is_estimate) as has_estimate
from public.meter_reading_history h
cross join lateral generate_series(
  date_trunc('month', h.previous_date::timestamp),
  date_trunc('month', (h.reading_date - 1)::timestamp),
  interval '1 month') as mth
cross join lateral (
  select least(h.reading_date, (mth + interval '1 month')::date)
       - greatest(h.previous_date, mth::date) as days
) o
where h.previous_date is not null
group by h.business_id, h.meter_id, mth;

create view public.monthly_consumption with (security_invoker = true) as
select business_id, month, sum(kwh)::numeric(18, 3) as kwh,
  count(*)::integer as meter_count, bool_or(has_estimate) as has_estimate
from public.meter_monthly_consumption
group by business_id, month;

-- The meter list. Estimated monthly use = average daily use over the last three intervals x 30.
create view public.meter_directory with (security_invoker = true) as
select
  m.id, m.business_id, m.property_id, m.serial_number, m.meter_type, m.category, m.status,
  m.installed_on, m.created_at,
  p.name as property_name, p.address as property_address, p.reference as property_reference,
  p.customer_id, c.name as customer_name,
  l.latest_date, l.latest_value, l.latest_is_estimate, l.latest_flag,
  case when m.retired_on is null and l.days > 0
    then round(l.used / l.days * 30, 3) end as estimated_monthly
from public.electricity_meters m
join public.properties p on p.id = m.property_id
left join public.customers c on c.id = p.customer_id
left join lateral (
  select
    max(r.reading_date) as latest_date,
    max(r.reading_value) as latest_value,
    (array_agg(r.is_estimate order by r.reading_date desc))[1] as latest_is_estimate,
    (array_agg(r.flag order by r.reading_date desc))[1] as latest_flag,
    max(r.reading_date) - min(r.reading_date) as days,
    max(r.reading_value) - min(r.reading_value) as used
  from (
    select reading_date, reading_value, is_estimate, flag from public.meter_readings
    where meter_id = m.id order by reading_date desc limit 4
  ) r
) l on true;

create view public.meter_summary with (security_invoker = true) as
select
  business_id,
  (count(*) filter (where retired_on is null))::integer as in_service,
  (count(*) filter (where status = 'active'))::integer as active,
  (count(*) filter (where status = 'inactive'))::integer as inactive,
  (count(*) filter (where status = 'faulty'))::integer as faulty,
  (count(*) filter (where status = 'maintenance'))::integer as maintenance,
  (count(*) filter (where retired_on is not null))::integer as retired
from public.electricity_meters
group by business_id;

create view public.maintenance_list with (security_invoker = true) as
select
  w.id, w.business_id, w.number, 'MNT-' || lpad(w.number::text, 5, '0') as reference,
  w.meter_id, w.kind, w.issue, w.priority,
  -- Sorting by the word would put "urgent" last.
  case w.priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end as priority_rank,
  w.status, w.scheduled_for, w.assigned_to, w.outcome, w.completed_on, w.created_at,
  (w.status in ('scheduled', 'pending', 'in_progress')) as is_open,
  (w.status in ('scheduled', 'pending', 'in_progress')
    and w.scheduled_for < public.business_today()) as is_overdue,
  m.serial_number, m.property_id, p.name as property_name, p.address as property_address,
  c.name as customer_name, a.full_name as assigned_name
from public.meter_maintenance w
join public.electricity_meters m on m.id = w.meter_id
join public.properties p on p.id = m.property_id
left join public.customers c on c.id = p.customer_id
left join public.profiles a on a.id = w.assigned_to;

create view public.maintenance_summary with (security_invoker = true) as
select
  business_id,
  (count(*) filter (where status = 'scheduled'))::integer as scheduled,
  (count(*) filter (where status = 'pending'))::integer as pending,
  (count(*) filter (where status = 'in_progress'))::integer as in_progress,
  (count(*) filter (where status = 'completed'))::integer as completed,
  (count(*) filter (where is_open and priority = 'urgent'))::integer as urgent,
  (count(*) filter (where is_overdue))::integer as overdue
from public.maintenance_list
group by business_id;

revoke all on
  public.meter_reading_history, public.meter_monthly_consumption, public.monthly_consumption,
  public.meter_directory, public.meter_summary, public.maintenance_list, public.maintenance_summary
from anon;
grant select on
  public.meter_reading_history, public.meter_monthly_consumption, public.monthly_consumption,
  public.meter_directory, public.meter_summary, public.maintenance_list, public.maintenance_summary
to authenticated;
