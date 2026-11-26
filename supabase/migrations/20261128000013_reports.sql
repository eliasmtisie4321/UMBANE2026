-- Phase 11: reports and analytics.
--
-- One function per report. Each returns everything its page shows (figures, monthly series,
-- breakdowns and detail rows) as JSON, so a report is one round trip and its numbers always come
-- from the same moment.
--
-- Rules:
-- * Managers and administrators only (report_check). The functions run as the caller
--   (security invoker), so Row Level Security still applies, and each also filters by the caller's
--   business.
-- * Periods are inclusive South African calendar dates (Africa/Johannesburg). Timestamps are
--   converted to a South African date before comparing, so a payment at 23:30 on the last day of a
--   month counts in that month.
-- * Money figures use issued invoices only (never drafts or cancelled invoices). "Collected" is
--   payments received in the period. "Outstanding" and stock levels are as they are now.
-- * Electricity used between two readings is spread evenly over the days between them (the same
--   rule as the meter pages), and only the days inside the period count.
-- * Monthly series cover every month the period touches, with zeros for empty months; the first
--   and last month only count the days inside the period, so the months add up to the total.

-- Helpers ---------------------------------------------------------------------------------------
create function public.sa_date(ts timestamptz) returns date
language sql stable set search_path = public as $$
  select (ts at time zone 'Africa/Johannesburg')::date
$$;

-- A category filter: null means everything; 'none' matches records with the category not filled in.
create function public.report_match(val text, filter text) returns boolean
language sql immutable as $$
  select filter is null or coalesce(val, 'none') = filter
$$;

create function public.report_check(p_from date, p_to date) returns void
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null or not is_manager_up() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'report_range_invalid' using errcode = '22023';
  end if;
  -- Five years of months is plenty for a chart and keeps a report quick.
  if p_to - p_from > 1830 then
    raise exception 'report_range_too_long' using errcode = '22023';
  end if;
end $$;

-- The months a period touches, with the part of each month inside the period.
create function public.report_months(p_from date, p_to date)
returns table (month date, first_day date, last_day date)
language sql immutable as $$
  select m::date, greatest(m::date, p_from), least((m + interval '1 month')::date - 1, p_to)
  from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp),
                       interval '1 month') m
$$;

-- kWh used by each meter between two dates (inclusive). An interval between readings covers the
-- days from the earlier reading up to the day before the later one.
create function public.report_consumption(p_from date, p_to date)
returns table (meter_id uuid, kwh numeric, estimated_kwh numeric)
language sql stable set search_path = public as $$
  select h.meter_id,
    sum(h.consumption * o.days / h.days),
    coalesce(sum(h.consumption * o.days / h.days) filter (where h.consumption_is_estimate), 0)
  from public.meter_reading_history h
  cross join lateral (
    select least(h.reading_date, p_to + 1) - greatest(h.previous_date, p_from) as days
  ) o
  where h.previous_date is not null and h.days > 0 and o.days > 0
    and h.business_id = public.current_business_id()
  group by h.meter_id
$$;

-- Overview (the reports hub) -----------------------------------------------------------------------
create function public.report_overview(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
  prev_from date := p_from - (p_to - p_from + 1);
  prev_to date := p_from - 1;
begin
  perform report_check(p_from, p_to);
  return (
    with issued as (
      select i.id, i.total, least(coalesce(pay.paid, 0), i.total) as paid
      from invoices i
      left join (select invoice_id, sum(amount) as paid from payments group by invoice_id) pay
        on pay.invoice_id = i.id
      where i.business_id = biz and i.status not in ('draft', 'cancelled')
        and i.issue_date between p_from and p_to
    ),
    months as (select * from report_months(p_from, p_to))
    select jsonb_build_object(
      'collected', (select coalesce(sum(amount), 0) from payments
                    where business_id = biz and sa_date(paid_at) between p_from and p_to),
      'collected_prior', (select coalesce(sum(amount), 0) from payments
                          where business_id = biz and sa_date(paid_at) between prev_from and prev_to),
      'invoiced', (select coalesce(sum(total), 0) from issued),
      'invoiced_paid', (select coalesce(sum(paid), 0) from issued),
      'kwh', (select coalesce(round(sum(kwh), 3), 0) from report_consumption(p_from, p_to)),
      'kwh_prior', (select coalesce(round(sum(kwh), 3), 0) from report_consumption(prev_from, prev_to)),
      'customers', (select count(*) from customers where business_id = biz and sa_date(created_at) <= p_to),
      'new_customers', (select count(*) from customers
                        where business_id = biz and sa_date(created_at) between p_from and p_to),
      'properties', (select count(*) from properties where business_id = biz and sa_date(created_at) <= p_to),
      'meters_in_service', (select count(*) from electricity_meters where business_id = biz and retired_on is null),
      'orders', (select count(*) from orders where business_id = biz and status <> 'cancelled'
                 and order_date between p_from and p_to),
      'order_value', (select coalesce(sum(total), 0) from orders where business_id = biz
                      and status <> 'cancelled' and order_date between p_from and p_to),
      'products', (select count(*) from products where business_id = biz and is_active),
      'stock_value', (select coalesce(sum(stock_value), 0) from product_list where business_id = biz),
      'tickets_opened', (select count(*) from support_tickets
                         where business_id = biz and sa_date(created_at) between p_from and p_to),
      'tickets_resolved', (select count(*) from support_tickets
                           where business_id = biz and sa_date(resolved_at) between p_from and p_to),
      'tasks_completed', (select count(*) from staff_tasks where business_id = biz and status = 'done'
                          and sa_date(completed_at) between p_from and p_to),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'collected', (select coalesce(sum(amount), 0) from payments
                        where business_id = biz and sa_date(paid_at) between m.first_day and m.last_day),
          'kwh', (select coalesce(round(sum(kwh), 3), 0) from report_consumption(m.first_day, m.last_day))
        ) order by m.month)
        from months m
      )
    )
  );
end $$;

-- Customers -------------------------------------------------------------------------------------
create function public.report_customers(
  p_from date, p_to date, p_segment text default null, p_province text default null
) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
begin
  perform report_check(p_from, p_to);
  return (
    with c as (
      select * from customers
      where business_id = biz and sa_date(created_at) <= p_to
        and report_match(segment, p_segment) and report_match(province, p_province)
    ),
    billed as (
      select i.customer_id, sum(i.total) as billed
      from invoices i
      where i.business_id = biz and i.status not in ('draft', 'cancelled')
        and i.issue_date between p_from and p_to
      group by i.customer_id
    ),
    paid as (
      select i.customer_id, sum(p.amount) as paid, max(sa_date(p.paid_at)) as last_paid
      from payments p join invoices i on i.id = p.invoice_id
      where p.business_id = biz and sa_date(p.paid_at) between p_from and p_to
      group by i.customer_id
    ),
    rows as (
      select c.id, c.name, c.customer_type, c.segment, c.province, c.status,
        sa_date(c.created_at) as created_on,
        (select count(*) from properties p where p.customer_id = c.id) as properties,
        (select count(*) from electricity_meters m join properties p on p.id = m.property_id
         where p.customer_id = c.id and m.retired_on is null) as meters,
        coalesce(b.billed, 0) as billed,
        coalesce(pd.paid, 0) as paid,
        (select coalesce(sum(balance), 0) from invoice_list il where il.customer_id = c.id) as balance,
        greatest(
          (select max(issue_date) from invoices i where i.customer_id = c.id and i.status <> 'draft'),
          (select max(sa_date(p.paid_at)) from payments p join invoices i on i.id = p.invoice_id
           where i.customer_id = c.id),
          (select max(sa_date(t.created_at)) from support_tickets t where t.customer_id = c.id)
        ) as last_activity
      from c
      left join billed b on b.customer_id = c.id
      left join paid pd on pd.customer_id = c.id
    )
    select jsonb_build_object(
      'total', (select count(*) from c),
      'new', (select count(*) from c where sa_date(created_at) between p_from and p_to),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
                     (select status, count(*) as n from c group by status) s),
      'by_segment', (select coalesce(jsonb_agg(jsonb_build_object('key', segment, 'count', n)
                       order by n desc, segment), '[]') from
                     (select segment, count(*) as n from c group by segment) s),
      'by_province', (select coalesce(jsonb_agg(jsonb_build_object('key', province, 'count', n)
                        order by n desc, province), '[]') from
                      (select province, count(*) as n from c group by province) s),
      'by_type', (select coalesce(jsonb_agg(jsonb_build_object('key', customer_type, 'count', n)
                    order by n desc, customer_type), '[]') from
                  (select customer_type, count(*) as n from c group by customer_type) s),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'new', (select count(*) from c where sa_date(created_at) between m.first_day and m.last_day),
          'total', (select count(*) from c where sa_date(created_at) <= m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'billed', (select coalesce(sum(billed), 0) from rows),
      'paid', (select coalesce(sum(paid), 0) from rows),
      'row_count', (select count(*) from rows),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.billed desc, r.name, r.id), '[]')
               from (select * from rows order by billed desc, name, id limit 5000) r)
    )
  );
end $$;

-- Properties ------------------------------------------------------------------------------------
create function public.report_properties(
  p_from date, p_to date, p_type text default null, p_province text default null
) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
begin
  perform report_check(p_from, p_to);
  return (
    with p as (
      select * from properties
      where business_id = biz and sa_date(created_at) <= p_to
        and report_match(property_type, p_type) and report_match(province, p_province)
    ),
    usage as (
      select m.property_id, sum(u.kwh) as kwh
      from report_consumption(p_from, p_to) u join electricity_meters m on m.id = u.meter_id
      group by m.property_id
    ),
    rows as (
      select p.id, p.name, p.address, p.reference, p.property_type, p.province, p.city, p.status, p.units,
        sa_date(p.created_at) as created_on, c.name as customer_name,
        (select count(*) from electricity_meters m where m.property_id = p.id and m.retired_on is null)
          as meters,
        round(coalesce(u.kwh, 0), 3) as kwh
      from p
      join customers c on c.id = p.customer_id
      left join usage u on u.property_id = p.id
    )
    select jsonb_build_object(
      'total', (select count(*) from p),
      'new', (select count(*) from p where sa_date(created_at) between p_from and p_to),
      'units', (select coalesce(sum(units), 0) from p),
      'meters_in_service', (select coalesce(sum(meters), 0) from rows),
      'without_meter', (select count(*) from rows where meters = 0),
      'kwh', (select coalesce(sum(kwh), 0) from rows),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
                     (select status, count(*) as n from p group by status) s),
      'by_type', (select coalesce(jsonb_agg(jsonb_build_object('key', property_type, 'count', n)
                    order by n desc, property_type), '[]') from
                  (select property_type, count(*) as n from p group by property_type) s),
      'by_province', (select coalesce(jsonb_agg(jsonb_build_object('key', province, 'count', n)
                        order by n desc, province), '[]') from
                      (select province, count(*) as n from p group by province) s),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'new', (select count(*) from p where sa_date(created_at) between m.first_day and m.last_day),
          'total', (select count(*) from p where sa_date(created_at) <= m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'row_count', (select count(*) from rows),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.kwh desc, r.name, r.id), '[]')
               from (select * from rows order by kwh desc, name, id limit 5000) r)
    )
  );
end $$;

-- Electricity consumption -------------------------------------------------------------------------
create function public.report_electricity(
  p_from date, p_to date, p_property_id uuid default null, p_meter_type text default null
) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
  prev_from date := p_from - (p_to - p_from + 1);
  prev_to date := p_from - 1;
begin
  perform report_check(p_from, p_to);
  return (
    with meters as (
      select m.id, m.serial_number, m.meter_type, m.retired_on, m.property_id,
        coalesce(p.name, p.address) as property_name
      from electricity_meters m join properties p on p.id = m.property_id
      where m.business_id = biz
        and (p_property_id is null or m.property_id = p_property_id)
        and report_match(m.meter_type, p_meter_type)
    ),
    usage as (
      select m.*, u.kwh, u.estimated_kwh
      from report_consumption(p_from, p_to) u join meters m on m.id = u.meter_id
    ),
    by_property as (
      select property_id, property_name, sum(kwh) as kwh, count(*) as meters
      from usage group by property_id, property_name
    ),
    readings as (
      select h.id, h.reading_date, h.meter_id, m.serial_number, m.property_name, h.previous_date,
        h.previous_value, h.reading_value, h.consumption, h.consumption_is_estimate as is_estimate, h.flag
      from meter_reading_history h join meters m on m.id = h.meter_id
      where h.reading_date between p_from and p_to
    )
    select jsonb_build_object(
      'kwh', (select coalesce(round(sum(kwh), 3), 0) from usage),
      'estimated_kwh', (select coalesce(round(sum(estimated_kwh), 3), 0) from usage),
      'kwh_prior', (select coalesce(round(sum(u.kwh), 3), 0)
                    from report_consumption(prev_from, prev_to) u join meters m on m.id = u.meter_id),
      'kwh_last_year', (select coalesce(round(sum(u.kwh), 3), 0)
                        from report_consumption((p_from - interval '1 year')::date,
                                                (p_to - interval '1 year')::date) u
                        join meters m on m.id = u.meter_id),
      'days', p_to - p_from + 1,
      'meters', (select count(*) from meters where retired_on is null),
      'meters_reporting', (select count(*) from usage where kwh > 0),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', mo.month,
          'kwh', (select coalesce(round(sum(u.kwh), 3), 0)
                  from report_consumption(mo.first_day, mo.last_day) u join meters m on m.id = u.meter_id)
        ) order by mo.month)
        from report_months(p_from, p_to) mo
      ),
      'by_property', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', property_id, 'name', property_name, 'kwh', round(kwh, 3), 'meters', meters)
                        order by kwh desc, property_name), '[]')
                      from (select * from by_property order by kwh desc, property_name limit 50) s),
      'by_meter_type', (select coalesce(jsonb_agg(jsonb_build_object(
                          'key', meter_type, 'kwh', round(kwh, 3), 'meters', n)
                          order by kwh desc, meter_type), '[]')
                        from (select meter_type, sum(kwh) as kwh, count(*) as n from usage
                              group by meter_type) s),
      'by_meter', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', id, 'serial_number', serial_number, 'property_name', property_name,
                     'meter_type', meter_type, 'kwh', round(kwh, 3), 'estimated_kwh', round(estimated_kwh, 3))
                     order by kwh desc, serial_number), '[]')
                   from (select * from usage order by kwh desc, serial_number limit 50) s),
      'properties', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(name, address))
                       order by coalesce(name, address)), '[]')
                     from properties pr where pr.business_id = biz
                       and exists (select 1 from electricity_meters m where m.property_id = pr.id)),
      'row_count', (select count(*) from readings),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.reading_date desc, r.serial_number), '[]')
               from (select * from readings order by reading_date desc, serial_number limit 5000) r)
    )
  );
end $$;

-- Sales and invoices ------------------------------------------------------------------------------
create function public.report_sales(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
  prev_from date := p_from - (p_to - p_from + 1);
  prev_to date := p_from - 1;
begin
  perform report_check(p_from, p_to);
  return (
    with o as (
      select * from orders where business_id = biz and order_date between p_from and p_to
    ),
    inv as (
      select il.*,
        (select max(sa_date(p.paid_at)) from payments p where p.invoice_id = il.id) as last_paid_on,
        (select p.method from payments p where p.invoice_id = il.id order by p.paid_at desc, p.id limit 1)
          as last_method
      from invoice_list il
      where il.business_id = biz and il.status not in ('draft', 'cancelled')
        and il.issue_date between p_from and p_to
    )
    select jsonb_build_object(
      'orders', (select count(*) from o where status <> 'cancelled'),
      'order_value', (select coalesce(sum(total), 0) from o where status <> 'cancelled'),
      'order_value_prior', (select coalesce(sum(total), 0) from orders where business_id = biz
                            and status <> 'cancelled' and order_date between prev_from and prev_to),
      'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n, 'value', v)
                             order by n desc, status), '[]')
                           from (select status, count(*) as n, sum(total) as v from o group by status) s),
      'top_items', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', q, 'value', v)
                      order by v desc, name), '[]')
                    from (select coalesce(pr.name, it.description) as name, sum(it.quantity) as q,
                            sum(it.quantity * it.unit_price) as v
                          from order_items it join o on o.id = it.order_id
                          left join products pr on pr.id = it.product_id
                          where o.status <> 'cancelled'
                          group by coalesce(pr.name, it.description)
                          order by v desc, name limit 10) s),
      'invoices', (select count(*) from inv),
      'invoiced', (select coalesce(sum(total), 0) from inv),
      'paid_count', (select count(*) from inv where display_status = 'paid'),
      'paid_amount', (select coalesce(sum(total), 0) from inv where display_status = 'paid'),
      'unpaid_count', (select count(*) from inv where display_status in ('sent', 'partially_paid')),
      'unpaid_balance', (select coalesce(sum(balance), 0) from inv where display_status in ('sent', 'partially_paid')),
      'overdue_count', (select count(*) from inv where display_status = 'overdue'),
      'overdue_balance', (select coalesce(sum(balance), 0) from inv where display_status = 'overdue'),
      'outstanding', (select coalesce(sum(balance), 0) from inv),
      'avg_settlement_days', (select round(avg(last_paid_on - issue_date), 1) from inv
                              where display_status = 'paid' and last_paid_on is not null),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'order_value', (select coalesce(sum(total), 0) from o
                          where status <> 'cancelled' and order_date between m.first_day and m.last_day),
          'orders', (select count(*) from o
                     where status <> 'cancelled' and order_date between m.first_day and m.last_day),
          'invoiced', (select coalesce(sum(total), 0) from inv where issue_date between m.first_day and m.last_day),
          'collected', (select coalesce(sum(amount), 0) from payments
                        where business_id = biz and sa_date(paid_at) between m.first_day and m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'row_count', (select count(*) from inv),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'invoice_number', invoice_number, 'order_reference', order_reference,
                 'customer_name', customer_name, 'issue_date', issue_date, 'due_date', due_date,
                 'total', total, 'paid', paid, 'balance', balance, 'status', display_status,
                 'last_paid_on', last_paid_on, 'method', last_method)
                 order by issue_date desc, invoice_number desc), '[]')
               from (select * from inv order by issue_date desc, invoice_number desc limit 5000) r)
    )
  );
end $$;

-- Revenue (payments received) -------------------------------------------------------------------
create function public.report_revenue(p_from date, p_to date, p_method text default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
  prev_from date := p_from - (p_to - p_from + 1);
  prev_to date := p_from - 1;
  year_start date := date_trunc('year', p_to::timestamp)::date;
begin
  perform report_check(p_from, p_to);
  return (
    with pay as (
      select pl.*, c.segment
      from payment_list pl join customers c on c.id = pl.customer_id
      where pl.business_id = biz and pl.paid_on between p_from and p_to
        and report_match(pl.method, p_method)
    )
    select jsonb_build_object(
      'collected', (select coalesce(sum(amount), 0) from pay),
      'payments', (select count(*) from pay),
      'collected_prior', (select coalesce(sum(amount), 0) from payment_list where business_id = biz
                          and paid_on between prev_from and prev_to and report_match(method, p_method)),
      'collected_year', (select coalesce(sum(amount), 0) from payment_list where business_id = biz
                         and paid_on between year_start and p_to and report_match(method, p_method)),
      'invoiced', (select coalesce(sum(total), 0) from invoices where business_id = biz
                   and status not in ('draft', 'cancelled') and issue_date between p_from and p_to),
      'outstanding', (select coalesce(sum(balance), 0) from invoice_list where business_id = biz),
      'outstanding_count', (select count(*) from invoice_list where business_id = biz and balance > 0),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'collected', (select coalesce(sum(amount), 0) from pay where paid_on between m.first_day and m.last_day),
          'invoiced', (select coalesce(sum(total), 0) from invoices where business_id = biz
                       and status not in ('draft', 'cancelled') and issue_date between m.first_day and m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'by_method', (select coalesce(jsonb_agg(jsonb_build_object('key', method, 'amount', a, 'count', n)
                      order by a desc, method), '[]')
                    from (select method, sum(amount) as a, count(*) as n from pay group by method) s),
      'by_segment', (select coalesce(jsonb_agg(jsonb_build_object('key', segment, 'amount', a, 'count', n)
                       order by a desc, segment), '[]')
                     from (select segment, sum(amount) as a, count(*) as n from pay group by segment) s),
      'top_customers', (select coalesce(jsonb_agg(jsonb_build_object('id', customer_id, 'name', customer_name,
                          'amount', a) order by a desc, customer_name), '[]')
                        from (select customer_id, customer_name, sum(amount) as a from pay
                              group by customer_id, customer_name order by a desc, customer_name limit 10) s),
      'row_count', (select count(*) from pay),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'reference_number', reference_number, 'paid_on', paid_on,
                 'customer_name', customer_name, 'invoice_number', invoice_number, 'invoice_id', invoice_id,
                 'method', method, 'amount', amount, 'reference', reference,
                 'recorded_by_name', recorded_by_name)
                 order by paid_on desc, number desc), '[]')
               from (select * from pay order by paid_on desc, number desc limit 5000) r)
    )
  );
end $$;

-- Inventory -------------------------------------------------------------------------------------
create function public.report_inventory(p_from date, p_to date, p_category text default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
begin
  perform report_check(p_from, p_to);
  return (
    with p as (
      select * from product_list where business_id = biz and report_match(category, p_category)
    ),
    mv as (
      select t.product_id, t.transaction_type, t.quantity, sa_date(t.created_at) as moved_on
      from inventory_transactions t join p on p.id = t.product_id
      where t.business_id = biz and sa_date(t.created_at) between p_from and p_to
    ),
    flow as (
      select product_id,
        sum(quantity) filter (where quantity > 0) as inbound,
        -sum(quantity) filter (where quantity < 0) as outbound
      from mv group by product_id
    ),
    rows as (
      select p.id, p.sku, p.name, p.category, p.is_active, p.track_stock, p.stock_on_hand, p.cost_price,
        p.unit_price, p.stock_value, p.stock_status, p.low_stock_threshold,
        coalesce(f.inbound, 0) as inbound, coalesce(f.outbound, 0) as outbound,
        (select max(sa_date(t.created_at)) from inventory_transactions t
         where t.product_id = p.id and t.quantity < 0) as last_out
      from p left join flow f on f.product_id = p.id
    )
    select jsonb_build_object(
      'products', (select count(*) from p where is_active),
      'units', (select coalesce(sum(stock_on_hand), 0) from p where is_active and track_stock),
      'stock_value', (select coalesce(sum(stock_value), 0) from p),
      'low', (select count(*) from p where is_active and stock_status = 'low'),
      'out', (select count(*) from p where is_active and stock_status = 'out'),
      'unvalued', (select count(*) from p where is_active and track_stock and cost_price is null
                   and stock_on_hand > 0),
      'inbound', (select coalesce(sum(quantity), 0) from mv where quantity > 0),
      'outbound', (select coalesce(-sum(quantity), 0) from mv where quantity < 0),
      'by_type', (select coalesce(jsonb_agg(jsonb_build_object('key', transaction_type, 'units', u, 'count', n)
                    order by transaction_type), '[]')
                  from (select transaction_type, sum(quantity) as u, count(*) as n from mv
                        group by transaction_type) s),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'inbound', (select coalesce(sum(quantity), 0) from mv
                      where quantity > 0 and moved_on between m.first_day and m.last_day),
          'outbound', (select coalesce(-sum(quantity), 0) from mv
                       where quantity < 0 and moved_on between m.first_day and m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('key', category, 'products', n,
                        'units', u, 'value', v) order by v desc, category), '[]')
                      from (select category, count(*) as n,
                              coalesce(sum(stock_on_hand) filter (where track_stock), 0) as u,
                              coalesce(sum(stock_value), 0) as v
                            from p where is_active group by category) s),
      'fast', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'name', name,
                 'outbound', outbound, 'stock_on_hand', stock_on_hand) order by outbound desc, name), '[]')
               from (select * from rows where outbound > 0 order by outbound desc, name limit 5) s),
      'slow', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'name', name,
                 'outbound', outbound, 'stock_on_hand', stock_on_hand, 'last_out', last_out)
                 order by outbound, last_out nulls first, name), '[]')
               from (select * from rows where is_active and track_stock and stock_on_hand > 0
                     order by outbound, last_out nulls first, name limit 5) s),
      'row_count', (select count(*) from rows),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.stock_value desc nulls last, r.name), '[]')
               from (select * from rows order by stock_value desc nulls last, name limit 5000) r)
    )
  );
end $$;

-- Support tickets -------------------------------------------------------------------------------
create function public.report_support(
  p_from date, p_to date, p_category text default null, p_priority text default null
) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
begin
  perform report_check(p_from, p_to);
  return (
    with scope as (
      select * from ticket_list
      where report_match(category, p_category) and report_match(priority, p_priority)
        and id in (select id from support_tickets where business_id = biz)
    ),
    t as (select * from scope where sa_date(created_at) between p_from and p_to)
    select jsonb_build_object(
      'opened', (select count(*) from t),
      'resolved', (select count(*) from scope where sa_date(resolved_at) between p_from and p_to),
      'open_now', (select count(*) from scope where is_open),
      'urgent_open', (select count(*) from scope where is_open and priority = 'urgent'),
      'unassigned_open', (select count(*) from scope where is_open and assigned_to is null),
      'avg_first_response_hours', (select round(extract(epoch from avg(first_response_at - created_at)) / 3600, 1)
                                   from t where first_response_at is not null),
      'avg_resolution_hours', (select round(extract(epoch from avg(resolved_at - created_at)) / 3600, 1)
                               from t where resolved_at is not null),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
                     (select status, count(*) as n from t group by status) s),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('key', category, 'count', n)
                        order by n desc, category), '[]')
                      from (select category, count(*) as n from t group by category) s),
      'by_priority', (select coalesce(jsonb_agg(jsonb_build_object('key', priority, 'count', n)
                        order by array_position(array['urgent', 'high', 'normal', 'low'], priority)), '[]')
                      from (select priority, count(*) as n from t group by priority) s),
      'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('id', assigned_to, 'name', assignee_name,
                        'tickets', n, 'resolved', r, 'avg_resolution_hours', h)
                        order by n desc, assignee_name nulls last), '[]')
                      from (select assigned_to, assignee_name, count(*) as n,
                              count(*) filter (where resolved_at is not null) as r,
                              round(extract(epoch from avg(resolved_at - created_at)) / 3600, 1) as h
                            from t group by assigned_to, assignee_name) s),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'opened', (select count(*) from scope where sa_date(created_at) between m.first_day and m.last_day),
          'resolved', (select count(*) from scope where sa_date(resolved_at) between m.first_day and m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'row_count', (select count(*) from t),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', id, 'reference', reference, 'subject', subject, 'customer_name', customer_name,
                 'category', category, 'priority', priority, 'status', status, 'assignee_name', assignee_name,
                 'created_at', created_at, 'first_response_at', first_response_at, 'resolved_at', resolved_at)
                 order by created_at desc, reference desc), '[]')
               from (select * from t order by created_at desc, reference desc limit 5000) r)
    )
  );
end $$;

-- Team performance ------------------------------------------------------------------------------
create function public.report_team(p_from date, p_to date, p_department text default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  biz uuid := current_business_id();
  today date := business_today();
begin
  perform report_check(p_from, p_to);
  return (
    with people as (
      select * from profiles
      where business_id = biz and role <> 'client' and report_match(department, p_department)
    ),
    tasks as (
      select t.* from staff_tasks t join people p on p.id = t.assigned_to where t.business_id = biz
    ),
    rows as (
      select p.id, p.full_name, p.job_title, p.department, p.employment_status, p.is_active, p.role,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status <> 'cancelled'
           and sa_date(t.created_at) between p_from and p_to) as assigned,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status = 'done'
           and sa_date(t.created_at) between p_from and p_to) as assigned_done,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status = 'done'
           and sa_date(t.completed_at) between p_from and p_to) as completed,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status = 'done'
           and sa_date(t.completed_at) between p_from and p_to and t.due_date is not null) as with_due,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status = 'done'
           and sa_date(t.completed_at) between p_from and p_to and t.due_date is not null
           and sa_date(t.completed_at) <= t.due_date) as on_time,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status in ('todo', 'in_progress'))
          as pending,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status in ('todo', 'in_progress')
           and t.due_date < today) as overdue,
        (select count(*) from tasks t where t.assigned_to = p.id and t.status in ('todo', 'in_progress')
           and t.category in ('field_maintenance', 'meter_installation')) as field_open,
        (select count(*) from support_tickets s where s.assigned_to = p.id
           and sa_date(s.resolved_at) between p_from and p_to) as tickets_resolved
      from people p
    )
    select jsonb_build_object(
      'employees', (select count(*) from people where is_active),
      'by_employment', (select coalesce(jsonb_object_agg(employment_status, n), '{}') from
                         (select employment_status, count(*) as n from people where is_active
                          group by employment_status) s),
      'assigned', (select coalesce(sum(assigned), 0) from rows),
      'assigned_done', (select coalesce(sum(assigned_done), 0) from rows),
      'completed', (select coalesce(sum(completed), 0) from rows),
      'with_due', (select coalesce(sum(with_due), 0) from rows),
      'on_time', (select coalesce(sum(on_time), 0) from rows),
      'pending', (select coalesce(sum(pending), 0) from rows),
      'overdue', (select coalesce(sum(overdue), 0) from rows),
      'tickets_resolved', (select coalesce(sum(tickets_resolved), 0) from rows),
      'unassigned_open', (select count(*) from staff_tasks where business_id = biz and assigned_to is null
                          and status in ('todo', 'in_progress')),
      'by_department', (select coalesce(jsonb_agg(jsonb_build_object('key', department, 'people', n,
                          'completed', c, 'with_due', w, 'on_time', o, 'pending', pe, 'overdue', ov)
                          order by c desc, department), '[]')
                        from (select department, count(*) filter (where is_active) as n,
                                sum(completed) as c, sum(with_due) as w, sum(on_time) as o,
                                sum(pending) as pe, sum(overdue) as ov
                              from rows group by department) s),
      'months', (
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'created', (select count(*) from tasks t where t.status <> 'cancelled'
                      and sa_date(t.created_at) between m.first_day and m.last_day),
          'completed', (select count(*) from tasks t where t.status = 'done'
                        and sa_date(t.completed_at) between m.first_day and m.last_day)
        ) order by m.month)
        from report_months(p_from, p_to) m
      ),
      'row_count', (select count(*) from rows where is_active or assigned + completed + pending > 0),
      'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.completed desc, r.full_name), '[]')
               from (select * from rows where is_active or assigned + completed + pending > 0
                     order by completed desc, full_name limit 5000) r)
    )
  );
end $$;

-- Access ----------------------------------------------------------------------------------------
revoke execute on function
  public.sa_date(timestamptz), public.report_match(text, text), public.report_check(date, date),
  public.report_months(date, date), public.report_consumption(date, date),
  public.report_overview(date, date), public.report_customers(date, date, text, text),
  public.report_properties(date, date, text, text), public.report_electricity(date, date, uuid, text),
  public.report_sales(date, date), public.report_revenue(date, date, text),
  public.report_inventory(date, date, text), public.report_support(date, date, text, text),
  public.report_team(date, date, text)
from public, anon;
grant execute on function
  public.sa_date(timestamptz), public.report_match(text, text), public.report_check(date, date),
  public.report_months(date, date), public.report_consumption(date, date),
  public.report_overview(date, date), public.report_customers(date, date, text, text),
  public.report_properties(date, date, text, text), public.report_electricity(date, date, uuid, text),
  public.report_sales(date, date), public.report_revenue(date, date, text),
  public.report_inventory(date, date, text), public.report_support(date, date, text, text),
  public.report_team(date, date, text)
to authenticated;
