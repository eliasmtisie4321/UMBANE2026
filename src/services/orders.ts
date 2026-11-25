import type { ListQuery, Page } from '@/types/customers'
import type {
  Order,
  OrderInput,
  OrderListItem,
  OrderSort,
  OrderStatus,
  PaymentMethod,
  ProductOption,
  SalesSummary,
} from '@/types/sales'
import type { RevenuePoint } from '@/types/dashboard'
import type { PropertyOption } from '@/types/meters'
import { fillMonths, monthRange } from '@/utils/format'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, one, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromListRow = (r: Row): OrderListItem => ({
  id: String(r.id),
  reference: String(r.reference),
  customerId: String(r.customer_id),
  customerName: String(r.customer_name),
  orderDate: String(r.order_date),
  status: String(r.status) as OrderStatus,
  total: num(r.total),
  itemCount: num(r.item_count),
  firstItem: str(r.first_item),
  assignedName: str(r.assigned_name),
})

export interface OrderFilters {
  status: OrderStatus | ''
  customerId: string
  /** Inclusive YYYY-MM-DD bounds; empty = no bound. */
  from: string
  to: string
}

export const listOrders = (query: ListQuery<OrderSort>, filters: OrderFilters, client?: DbClient) =>
  guarded<Page<OrderListItem>>('Orders', client, async (c) => {
    let q = c.from('order_list').select('*', { count: 'exact' })
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    if (filters.from) q = q.gte('order_date', filters.from)
    if (filters.to) q = q.lte('order_date', filters.to)
    const or = orIlike(['reference', 'customer_name', 'first_item', 'assigned_name'], query.search)
    if (or) q = q.or(or)

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Orders'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromListRow) })
  })

const latestFor = (column: 'lead_id' | 'customer_id', id: string, client?: DbClient) =>
  guarded<OrderListItem[]>('Orders', client, async (c) => {
    const { data, error } = await c
      .from('order_list')
      .select('*')
      .eq(column, id)
      .order('number', { ascending: false })
      .limit(20)
    if (error) return err(mapReadError(error, 'Orders'))
    return ok((data ?? []).map(fromListRow))
  })

export const getLeadOrders = (leadId: string, client?: DbClient) =>
  latestFor('lead_id', leadId, client)

export const getOrder = (id: string, client?: DbClient) =>
  guarded<Order>('Order', client, async (c) => {
    const [order, items] = await Promise.all([
      c.from('order_list').select('*').eq('id', id).maybeSingle(),
      c
        .from('order_items')
        .select('id, product_id, description, quantity, unit_price, products(sku)')
        .eq('order_id', id)
        .order('position')
        .order('id'),
    ])
    const error = order.error ?? items.error
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Order'))
    if (error || !order.data) {
      return err({ code: 'not_found', message: 'This order could not be found.' })
    }
    const r = order.data as Row
    return ok({
      ...fromListRow(r),
      propertyId: str(r.property_id),
      propertyName: str(r.property_name),
      leadId: str(r.lead_id),
      paymentMethod: str(r.payment_method) as PaymentMethod | null,
      discountPercent: num(r.discount_percent),
      vatRate: num(r.vat_rate),
      subtotal: num(r.subtotal),
      discount: num(r.discount),
      tax: num(r.tax),
      notes: str(r.notes),
      cancelReason: str(r.cancel_reason),
      assignedTo: str(r.assigned_to),
      createdAt: String(r.created_at),
      items: ((items.data ?? []) as Row[]).map((i) => ({
        id: String(i.id),
        productId: str(i.product_id),
        sku: str(one(i.products as Row | Row[] | null)?.sku),
        description: String(i.description),
        quantity: num(i.quantity),
        unitPrice: num(i.unit_price),
      })),
    })
  })

/** Creates (id null) or edits a pending order with its lines. Totals are the database's to set. */
export const saveOrder = (id: string | null, input: OrderInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'order',
    client,
    async (c) => {
      const { data, error } = await c.rpc('save_order', {
        p_order_id: id,
        p_customer_id: input.customerId,
        p_items: input.items.map((i) => ({
          product_id: i.productId,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unitPrice,
        })),
        p_property_id: input.propertyId,
        p_lead_id: input.leadId,
        p_assigned_to: input.assignedTo,
        p_order_date: input.orderDate,
        p_payment_method: input.paymentMethod,
        p_discount_percent: input.discountPercent,
        p_vat_rate: input.vatRate,
        p_notes: input.notes,
      })
      if (error) return err(mapWriteError(error, 'order'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

export const setOrderStatus = (
  id: string,
  status: OrderStatus,
  cancelReason: string | null,
  client?: DbClient,
) =>
  guarded<{ id: string }>(
    'order',
    client,
    async (c) => {
      const { data, error } = await c
        .from('orders')
        .update(status === 'cancelled' ? { status, cancel_reason: cancelReason } : { status })
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'order'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This order could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

export const getSalesSummary = (client?: DbClient) =>
  guarded<SalesSummary>('Sales totals', client, async (c) => {
    const { data, error } = await c.from('sales_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Sales totals'))
    const r = (data ?? {}) as Row
    return ok({
      pendingCount: num(r.pending_count),
      pendingValue: num(r.pending_value),
      confirmedCount: num(r.confirmed_count),
      confirmedValue: num(r.confirmed_value),
      fulfilledCount: num(r.fulfilled_count),
      cancelledCount: num(r.cancelled_count),
    })
  })

/** Sales per month for the last `months` months, oldest first. A month with no sales is zero. */
export const getMonthlySales = (months: number, client?: DbClient, now: Date = new Date()) =>
  guarded<RevenuePoint[]>('Sales', client, async (c) => {
    // The view groups by South African month (UTC+2), so count months from there too.
    const range = monthRange(months, new Date(now.getTime() + 2 * 3_600_000))
    const { data, error } = await c
      .from('monthly_sales')
      .select('month, total')
      .gte('month', range[0])
      .order('month')
    if (error) return err(mapReadError(error, 'Sales'))
    const values = fillMonths(
      (data ?? []).map((r: Row) => ({ month: String(r.month), total: num(r.total) })),
      range,
    )
    return ok(range.map((month, i) => ({ month, total: values[i] })))
  })

export const searchProducts = (search: string, client?: DbClient) =>
  guarded<ProductOption[]>('Products', client, async (c) => {
    let q = c
      .from('products')
      .select('id, sku, name, unit_price')
      .eq('is_active', true)
      .order('name')
      .limit(8)
    const or = orIlike(['name', 'sku'], search)
    if (or) q = q.or(or)
    const { data, error } = await q
    if (error) return err(mapReadError(error, 'Products'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        sku: String(r.sku),
        name: String(r.name),
        unitPrice: num(r.unit_price),
      })),
    )
  })

/** One customer's properties, for choosing where an order is for. */
export const getCustomerPropertyOptions = (customerId: string, client?: DbClient) =>
  guarded<PropertyOption[]>('Properties', client, async (c) => {
    const { data, error } = await c
      .from('properties')
      .select('id, name, reference, address')
      .eq('customer_id', customerId)
      .order('name')
      .limit(200)
    if (error) return err(mapReadError(error, 'Properties'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        name: str(r.name) ?? String(r.address),
        detail: [r.reference, r.address].filter(Boolean).join(' · '),
      })),
    )
  })
