-- Inventory and products (Phase 7). Needs migrations 0006 to 0008. Assumptions are in docs/INVENTORY.md.
-- Stock on hand is kept from an append-only ledger. Every change goes through one locked step.

-- Products ----------------------------------------------------------------------------------------
alter table public.products alter column business_id set default public.current_business_id();
alter table public.products
  add column category text check (char_length(category) <= 60),
  add column cost_price numeric(12, 2) check (cost_price >= 0 and cost_price <= 9999999.99),
  add column supplier text check (char_length(supplier) <= 120),
  -- Services (installation, call-outs) are sold but never stocked.
  add column track_stock boolean not null default true,
  -- Kept by the ledger trigger below; never written directly.
  add column stock_on_hand integer not null default 0,
  add constraint products_price_max check (unit_price <= 9999999.99),
  add constraint products_description_length check (char_length(description) <= 2000),
  add constraint products_sku_format check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$'),
  add constraint products_stock_not_negative check (stock_on_hand >= 0 or not track_stock);
create unique index products_business_sku_ci_uniq on public.products (business_id, lower(sku));

-- Ledger ----------------------------------------------------------------------------------------
alter table public.inventory_transactions alter column business_id set default public.current_business_id();
alter table public.inventory_transactions drop constraint inventory_transactions_product_id_fkey;
alter table public.inventory_transactions
  add constraint inventory_transactions_product_id_fkey foreign key (product_id, business_id)
    references public.products (id, business_id) on delete restrict,
  add column number bigint generated always as identity,
  add column order_id uuid,
  add column balance_after integer,
  add constraint inventory_order_fkey foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict,
  add constraint inventory_note_length check (char_length(note) <= 500),
  add constraint inventory_quantity_max check (abs(quantity) <= 1000000);

-- Fill in the running balances for movements recorded before this migration.
with running as (
  select id, sum(quantity) over (partition by product_id order by created_at, id) as bal
  from public.inventory_transactions
)
update public.inventory_transactions t set balance_after = r.bal from running r where r.id = t.id;
update public.products p set stock_on_hand = coalesce(
  (select sum(quantity) from public.inventory_transactions where product_id = p.id), 0);
update public.products set track_stock = true where stock_on_hand <> 0;
alter table public.inventory_transactions alter column balance_after set not null;

-- History is append-only: corrections are new adjustments, never edits or deletions.
drop policy inventory_transactions_manager_delete on public.inventory_transactions;

-- Rules -----------------------------------------------------------------------------------------
-- received and returned add stock; sold removes it and comes only from fulfilled orders;
-- adjusted is a counted correction either way and needs a reason. Stock never goes below zero.
create function public.check_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.products;
begin
  perform assert_sales_caller(new.business_id);
  -- The lock makes movements on one product take turns, so two at once cannot both spend the last unit.
  select * into p from products where id = new.product_id and business_id = new.business_id for update;
  if p.id is null then
    raise exception 'stock_product_not_found' using errcode = '23503';
  end if;
  if not p.track_stock then
    raise exception 'stock_not_tracked' using errcode = '23514';
  end if;
  if (new.transaction_type in ('received', 'returned') and new.quantity <= 0)
     or (new.transaction_type = 'sold' and new.quantity >= 0) then
    raise exception 'stock_quantity_sign' using errcode = '23514';
  end if;
  -- A person cannot record a sale: it would not be tied to an order and could be counted twice.
  if new.transaction_type = 'sold' and auth.uid() is not null and pg_trigger_depth() < 2 then
    raise exception 'stock_sold_by_order' using errcode = '23514';
  end if;
  if new.transaction_type = 'adjusted' and char_length(btrim(coalesce(new.note, ''))) < 3 then
    raise exception 'stock_reason_required' using errcode = '23514';
  end if;
  if p.stock_on_hand + new.quantity < 0 then
    raise exception 'stock_insufficient' using errcode = '23514',
      detail = p.sku || ': ' || p.stock_on_hand || ' on hand';
  end if;
  new.balance_after := p.stock_on_hand + new.quantity;
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;
  new.created_at := now();
  update products set stock_on_hand = new.balance_after where id = p.id;
  return new;
end;
$$;
create trigger check_stock_movement before insert on public.inventory_transactions
  for each row execute function public.check_stock_movement();

create function public.check_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform assert_sales_caller(new.business_id);
  if tg_op = 'INSERT' then
    new.stock_on_hand := 0;
    return new;
  end if;
  if new.business_id <> old.business_id then
    raise exception 'business_id cannot be changed';
  end if;
  -- Only the ledger trigger (one level down) may change the count.
  if new.stock_on_hand <> old.stock_on_hand and pg_trigger_depth() < 2 then
    raise exception 'stock_direct_edit' using errcode = '23514';
  end if;
  if old.track_stock and not new.track_stock and old.stock_on_hand <> 0 then
    raise exception 'stock_not_zero' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_product before insert or update on public.products
  for each row execute function public.check_product();
create trigger audit_row_change after insert or update or delete on public.products
  for each row execute function public.audit_row_change();

-- Fulfilling an order takes its stocked products out, all or nothing.
create function public.take_order_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'fulfilled' and old.status <> 'fulfilled' then
    insert into inventory_transactions (business_id, product_id, transaction_type, quantity, note, order_id)
    select new.business_id, i.product_id, 'sold', -sum(i.quantity),
      'Order ORD-' || lpad(new.number::text, 5, '0'), new.id
    from order_items i
    join products p on p.id = i.product_id and p.track_stock
    where i.order_id = new.id
    group by i.product_id
    order by i.product_id;  -- a fixed order, so two fulfilments cannot lock products crosswise
  end if;
  return new;
end;
$$;
create trigger take_order_stock after update on public.orders
  for each row execute function public.take_order_stock();

revoke execute on function
  public.check_stock_movement(), public.check_product(), public.take_order_stock()
from public, anon, authenticated;

-- A product and its opening stock together.
create function public.create_product(
  p_sku text, p_name text, p_unit_price numeric, p_opening_stock integer default 0,
  p_category text default null, p_description text default null, p_cost_price numeric default null,
  p_supplier text default null, p_low_stock_threshold integer default 0, p_track_stock boolean default true
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  pid uuid;
begin
  if p_opening_stock < 0 or (p_opening_stock > 0 and not p_track_stock) then
    raise exception 'stock_quantity_sign' using errcode = '23514';
  end if;
  insert into products (sku, name, unit_price, category, description, cost_price, supplier,
    low_stock_threshold, track_stock)
  values (btrim(p_sku), btrim(p_name), p_unit_price, p_category, p_description, p_cost_price, p_supplier,
    p_low_stock_threshold, p_track_stock)
  returning id into pid;
  if p_opening_stock > 0 then
    insert into inventory_transactions (product_id, transaction_type, quantity, note)
    values (pid, 'received', p_opening_stock, 'Opening stock');
  end if;
  return pid;
end;
$$;
revoke execute on function
  public.create_product(text, text, numeric, integer, text, text, numeric, text, integer, boolean)
from public, anon;
grant execute on function
  public.create_product(text, text, numeric, integer, text, text, numeric, text, integer, boolean)
to authenticated;

-- Read models (security_invoker) ---------------------------------------------------------------
-- Same columns as before for the dashboard; now read from the kept count.
create or replace view public.product_stock with (security_invoker = true) as
select
  p.id as product_id, p.business_id, p.sku, p.name, p.is_active, p.low_stock_threshold,
  p.stock_on_hand,
  (p.is_active and p.track_stock and p.stock_on_hand <= p.low_stock_threshold) as is_low
from public.products p;

create view public.product_list with (security_invoker = true) as
select
  p.id, p.business_id, p.sku, p.name, p.category, p.description, p.unit_price, p.cost_price,
  p.supplier, p.low_stock_threshold, p.is_active, p.track_stock, p.stock_on_hand, p.created_at,
  case
    when not p.track_stock then 'service'
    when p.stock_on_hand = 0 then 'out'
    when p.stock_on_hand <= p.low_stock_threshold then 'low'
    else 'in'
  end as stock_status,
  case when p.track_stock then (p.stock_on_hand * coalesce(p.cost_price, 0))::numeric(16, 2) end
    as stock_value
from public.products p;

create view public.inventory_summary with (security_invoker = true) as
select
  business_id,
  (count(*) filter (where is_active))::integer as active_products,
  coalesce(sum(stock_on_hand) filter (where is_active and track_stock), 0)::integer as units,
  (count(*) filter (where is_active and stock_status = 'low'))::integer as low,
  (count(*) filter (where is_active and stock_status = 'out'))::integer as out_of_stock,
  coalesce(sum(stock_value), 0)::numeric(16, 2) as stock_value,
  (count(*) filter (where is_active and track_stock and cost_price is null and stock_on_hand > 0))::integer
    as unvalued
from public.product_list
group by business_id;

create view public.inventory_history with (security_invoker = true) as
select
  t.id, t.business_id, 'MOV-' || lpad(t.number::text, 5, '0') as reference, t.number,
  t.product_id, p.sku, p.name as product_name, t.transaction_type, t.quantity,
  t.balance_after - t.quantity as balance_before, t.balance_after, t.note,
  t.order_id, 'ORD-' || lpad(o.number::text, 5, '0') as order_reference,
  r.full_name as recorded_by_name, t.created_at,
  (t.created_at at time zone 'Africa/Johannesburg')::date as moved_on
from public.inventory_transactions t
join public.products p on p.id = t.product_id
left join public.orders o on o.id = t.order_id
left join public.profiles r on r.id = t.recorded_by;

revoke all on public.product_list, public.inventory_summary, public.inventory_history from anon;
grant select on public.product_list, public.inventory_summary, public.inventory_history to authenticated;
