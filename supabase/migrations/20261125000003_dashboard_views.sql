-- Dashboard read models (Phase 2).
-- All views are security_invoker: they run with the CALLER's privileges, so the Row Level Security
-- policies on invoices, payments, products and inventory_transactions keep applying. A user can
-- never see through a view what they could not read from the underlying tables.

-- Invoice balances ------------------------------------------------------------------------------
-- balance = total minus payments received. Overdue = unpaid balance past its due date.
create view public.invoice_balances with (security_invoker = true) as
select
  i.id,
  i.business_id,
  i.customer_id,
  i.invoice_number,
  i.status,
  i.total,
  coalesce(p.paid, 0)::numeric(12, 2) as paid,
  greatest(i.total - coalesce(p.paid, 0), 0)::numeric(12, 2) as balance,
  i.due_date,
  (
    i.status in ('sent', 'partially_paid', 'overdue')
    and i.total - coalesce(p.paid, 0) > 0
    and i.due_date is not null
    and i.due_date < current_date
  ) as is_overdue
from public.invoices i
left join (
  select invoice_id, sum(amount) as paid from public.payments group by invoice_id
) p on p.invoice_id = i.id;

-- Outstanding totals, aggregated in the database (PostgREST caps responses at 1000 rows, so the
-- browser must never sum rows itself). One row per business visible to the caller; no row = zeros.
create view public.invoice_summary with (security_invoker = true) as
select
  business_id,
  coalesce(sum(balance) filter (where status in ('sent', 'partially_paid', 'overdue')), 0)::numeric(14, 2)
    as outstanding_amount,
  (count(*) filter (where status in ('sent', 'partially_paid', 'overdue') and balance > 0))::integer
    as outstanding_count,
  (count(*) filter (where is_overdue))::integer as overdue_count
from public.invoice_balances
group by business_id;

-- Revenue per calendar month (UTC), from payments actually received --------------------------
create view public.monthly_revenue with (security_invoker = true) as
select
  business_id,
  date_trunc('month', paid_at)::date as month,
  sum(amount)::numeric(14, 2) as total,
  count(*)::integer as payment_count
from public.payments
group by business_id, date_trunc('month', paid_at);

-- Stock on hand ---------------------------------------------------------------------------------
-- Convention: inventory_transactions.quantity is SIGNED. Positive adds stock (received, returned),
-- negative removes it (sold). Phase 7 (inventory) must follow this convention.
create view public.product_stock with (security_invoker = true) as
select
  p.id as product_id,
  p.business_id,
  p.sku,
  p.name,
  p.is_active,
  p.low_stock_threshold,
  coalesce(sum(t.quantity), 0)::integer as stock_on_hand,
  (p.is_active and coalesce(sum(t.quantity), 0) <= p.low_stock_threshold) as is_low
from public.products p
left join public.inventory_transactions t on t.product_id = p.id
group by p.id;

-- New objects get Supabase's default grants, so lock them down explicitly -----------------------
revoke all on public.invoice_balances, public.invoice_summary, public.monthly_revenue, public.product_stock from anon;
grant select on public.invoice_balances, public.invoice_summary, public.monthly_revenue, public.product_stock to authenticated;
