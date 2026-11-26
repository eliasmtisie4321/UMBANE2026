import type { ListQuery, Page } from '@/types/customers'
import type {
  InventorySummary,
  Movement,
  MovementInput,
  MovementType,
  Product,
  ProductInput,
  ProductListItem,
  ProductOrderLine,
  ProductSort,
  StockStatus,
} from '@/types/inventory'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, one, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

const fromRow = (r: Row): Product => ({
  id: String(r.id),
  sku: String(r.sku),
  name: String(r.name),
  category: str(r.category),
  description: str(r.description),
  unitPrice: num(r.unit_price),
  costPrice: numOrNull(r.cost_price),
  supplier: str(r.supplier),
  stockOnHand: num(r.stock_on_hand),
  lowStockThreshold: num(r.low_stock_threshold),
  stockStatus: String(r.stock_status) as StockStatus,
  stockValue: numOrNull(r.stock_value),
  isActive: r.is_active !== false,
  trackStock: r.track_stock !== false,
  createdAt: String(r.created_at),
})

export interface ProductFilters {
  status: StockStatus | ''
  category: string
  /** Deactivated products are hidden unless asked for. */
  includeInactive: boolean
}

export const listProducts = (
  query: ListQuery<ProductSort>,
  filters: ProductFilters,
  client?: DbClient,
) =>
  guarded<Page<ProductListItem>>('Products', client, async (c) => {
    let q = c.from('product_list').select('*', { count: 'exact' })
    if (filters.status) q = q.eq('stock_status', filters.status)
    if (filters.category) q = q.eq('category', filters.category)
    if (!filters.includeInactive) q = q.eq('is_active', true)
    const or = orIlike(['name', 'sku', 'category', 'supplier'], query.search)
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('id')
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Products'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromRow) })
  })

/** Active stocked products at or below their threshold, emptiest first. */
export const getStockAlerts = (client?: DbClient) =>
  guarded<ProductListItem[]>('Stock alerts', client, async (c) => {
    const { data, error } = await c
      .from('product_list')
      .select('*')
      .eq('is_active', true)
      .in('stock_status', ['low', 'out'])
      .order('stock_on_hand')
      .order('name')
      .limit(10)
    if (error) return err(mapReadError(error, 'Stock alerts'))
    return ok((data ?? []).map(fromRow))
  })

/** The switched-on product categories (Settings → Categories), suggested when filling in a product. */
export const getCategories = (client?: DbClient) =>
  guarded<string[]>('Categories', client, async (c) => {
    const { data, error } = await c
      .from('product_categories')
      .select('name')
      .eq('is_active', true)
      .order('name')
      .limit(500)
    if (error) return err(mapReadError(error, 'Categories'))
    return ok((data ?? []).map((r: Row) => String(r.name)))
  })

export const getInventorySummary = (client?: DbClient) =>
  guarded<InventorySummary>('Inventory totals', client, async (c) => {
    const { data, error } = await c.from('inventory_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Inventory totals'))
    const r = (data ?? {}) as Row
    return ok({
      activeProducts: num(r.active_products),
      units: num(r.units),
      low: num(r.low),
      outOfStock: num(r.out_of_stock),
      stockValue: num(r.stock_value),
      unvalued: num(r.unvalued),
    })
  })

export const getProduct = (id: string, client?: DbClient) =>
  guarded<Product>('Product', client, async (c) => {
    const { data, error } = await c.from('product_list').select('*').eq('id', id).maybeSingle()
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Product'))
    if (!data) return err({ code: 'not_found', message: 'This product could not be found.' })
    return ok(fromRow(data as Row))
  })

export const createProduct = (input: ProductInput, openingStock: number, client?: DbClient) =>
  guarded<{ id: string }>(
    'product',
    client,
    async (c) => {
      const { data, error } = await c.rpc('create_product', {
        p_sku: input.sku,
        p_name: input.name,
        p_unit_price: input.unitPrice,
        p_opening_stock: openingStock,
        p_category: input.category,
        p_description: input.description,
        p_cost_price: input.costPrice,
        p_supplier: input.supplier,
        p_low_stock_threshold: input.lowStockThreshold,
        p_track_stock: input.trackStock,
      })
      if (error) return err(mapWriteError(error, 'product'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

const patchProduct = (id: string, patch: Row, client?: DbClient) =>
  guarded<{ id: string }>(
    'product',
    client,
    async (c) => {
      const { data, error } = await c.from('products').update(patch).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'product'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This product could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

/** Never sends the stock count: that only changes through movements. */
export const updateProduct = (id: string, input: ProductInput, client?: DbClient) =>
  patchProduct(
    id,
    {
      sku: input.sku,
      name: input.name,
      category: input.category,
      description: input.description,
      unit_price: input.unitPrice,
      cost_price: input.costPrice,
      supplier: input.supplier,
      low_stock_threshold: input.lowStockThreshold,
      track_stock: input.trackStock,
    },
    client,
  )

export const setProductActive = (id: string, active: boolean, client?: DbClient) =>
  patchProduct(id, { is_active: active }, client)

// Movements --------------------------------------------------------------------------------------
const fromMovement = (r: Row): Movement => ({
  id: String(r.id),
  reference: String(r.reference),
  productId: String(r.product_id),
  sku: String(r.sku),
  productName: String(r.product_name),
  type: String(r.transaction_type) as MovementType,
  quantity: num(r.quantity),
  balanceBefore: num(r.balance_before),
  balanceAfter: num(r.balance_after),
  note: str(r.note),
  orderId: str(r.order_id),
  orderReference: str(r.order_reference),
  recordedByName: str(r.recorded_by_name),
  createdAt: String(r.created_at),
})

export interface MovementFilters {
  type: MovementType | ''
  productId: string
  /** Inclusive South African dates; empty = no bound. */
  from: string
  to: string
}

/** Newest first. */
export const listMovements = (
  query: ListQuery<'created_at'>,
  filters: MovementFilters,
  client?: DbClient,
) =>
  guarded<Page<Movement>>('Stock movements', client, async (c) => {
    let q = c.from('inventory_history').select('*', { count: 'exact' })
    if (filters.type) q = q.eq('transaction_type', filters.type)
    if (filters.productId) q = q.eq('product_id', filters.productId)
    if (filters.from) q = q.gte('moved_on', filters.from)
    if (filters.to) q = q.lte('moved_on', filters.to)
    const or = orIlike(
      ['reference', 'sku', 'product_name', 'note', 'order_reference'],
      query.search,
    )
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Stock movements'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromMovement) })
  })

/** Never sends the balance, time or author: the database sets them. */
export const recordMovement = (input: MovementInput, client?: DbClient) =>
  guarded<{ id: string; balanceAfter: number }>(
    'stock movement',
    client,
    async (c) => {
      const { data, error } = await c
        .from('inventory_transactions')
        .insert({
          product_id: input.productId,
          transaction_type: input.type,
          quantity: input.quantity,
          note: input.note,
        })
        .select('id, balance_after')
        .single()
      if (error) return err(mapWriteError(error, 'stock movement'))
      const r = data as Row
      return ok({ id: String(r.id), balanceAfter: num(r.balance_after) })
    },
    mapWriteError,
  )

/** Recent orders that include this product. */
export const getProductOrders = (productId: string, client?: DbClient) =>
  guarded<ProductOrderLine[]>('Orders', client, async (c) => {
    const { data, error } = await c
      .from('order_items')
      .select('quantity, orders!inner(id, number, order_date, status, customers(name))')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Orders'))
    return ok(
      (data ?? []).map((r: Row) => {
        const o = one(r.orders as Row | Row[] | null) ?? {}
        return {
          orderId: String(o.id),
          reference: `ORD-${String(o.number).padStart(5, '0')}`,
          customerName: str(one(o.customers as Row | Row[] | null)?.name),
          orderDate: String(o.order_date),
          status: String(o.status),
          quantity: num(r.quantity),
        }
      }),
    )
  })
