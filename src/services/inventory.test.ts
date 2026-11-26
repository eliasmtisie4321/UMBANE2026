import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { ListQuery } from '@/types/customers'
import type { ProductInput, ProductSort } from '@/types/inventory'
import {
  createProduct,
  getCategories,
  getInventorySummary,
  getProduct,
  getProductOrders,
  getStockAlerts,
  listMovements,
  listProducts,
  recordMovement,
  updateProduct,
} from './inventory'

const query: ListQuery<ProductSort> = {
  search: '',
  sort: 'name',
  ascending: true,
  page: 1,
  pageSize: 25,
}
const input: ProductInput = {
  sku: 'CT-400',
  name: 'CT set',
  category: null,
  description: null,
  unitPrice: 4950,
  costPrice: 3420,
  supplier: null,
  lowStockThreshold: 5,
  trackStock: true,
}

describe('products', () => {
  it('hides inactive products unless asked, and filters by stock and category', async () => {
    const { client, log } = fake({ product_list: { data: [], count: 0 } })
    await listProducts(query, { status: 'low', category: 'CT', includeInactive: false }, client)
    expect(log[0].ops).toContain('eq("stock_status","low")')
    expect(log[0].ops).toContain('eq("category","CT")')
    expect(log[0].ops).toContain('eq("is_active",true)')
    const all = fake({ product_list: { data: [], count: 0 } })
    await listProducts(query, { status: '', category: '', includeInactive: true }, all.client)
    expect(all.log[0].ops.join()).not.toContain('is_active')
  })

  it('maps numbers, and an unknown cost or value as null rather than zero', async () => {
    const { client } = fake({
      product_list: {
        data: {
          id: 'p1',
          sku: 'S',
          name: 'N',
          unit_price: '10.50',
          cost_price: null,
          stock_on_hand: 3,
          low_stock_threshold: 5,
          stock_status: 'low',
          stock_value: null,
          is_active: true,
          track_stock: true,
          created_at: 'x',
        },
      },
    })
    const r = await getProduct('p1', client)
    expect(r.ok && r.data).toMatchObject({ unitPrice: 10.5, costPrice: null, stockValue: null })
  })

  it('creates with the opening stock in one call', async () => {
    const { client, log } = fake({ 'rpc:create_product': { data: 'p1' } })
    expect((await createProduct(input, 12, client)).ok).toBe(true)
    expect(log[0].ops[0]).toContain('"p_opening_stock":12')
    expect(log[0].ops[0]).not.toContain('business')
  })

  it('never sends the stock count when editing', async () => {
    const { client, log } = fake({ products: { data: [{ id: 'p1' }] } })
    await updateProduct('p1', input, client)
    expect(log[0].ops[0]).not.toContain('stock_on_hand')
  })

  it.each([
    [
      { code: '23505', message: 'violates "products_business_sku_ci_uniq"' },
      'sku',
      /already exists/,
    ],
    [{ code: '23514', message: 'products_sku_format' }, 'sku', /letters, numbers/],
    [{ code: '23514', message: 'stock_not_zero' }, 'trackStock', /zero/],
  ])('explains %j on its field', async (error, field, text) => {
    const r = await updateProduct('p1', input, fake({ products: { error } }).client)
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('lists stock alerts emptiest first, and the switched-on categories', async () => {
    const a = fake({ product_list: { data: [] } })
    await getStockAlerts(a.client)
    expect(a.log[0].ops).toContain('in("stock_status",["low","out"])')
    expect(a.log[0].ops).toContain('order("stock_on_hand")')
    const c = fake({
      product_categories: { data: [{ name: 'A' }, { name: 'B' }] },
    })
    const r = await getCategories(c.client)
    expect(r.ok && r.data).toEqual(['A', 'B'])
  })

  it('shows zeros before any product exists', async () => {
    const r = await getInventorySummary(fake({ inventory_summary: { data: null } }).client)
    expect(r.ok && r.data).toMatchObject({ units: 0, stockValue: 0 })
  })
})

describe('movements', () => {
  it('records only what a person chooses; the database sets balance, time and author', async () => {
    const { client, log } = fake({
      inventory_transactions: { data: { id: 'm1', balance_after: 7 } },
    })
    const r = await recordMovement(
      { productId: 'p1', type: 'adjusted', quantity: -2, note: 'Damaged' },
      client,
    )
    expect(r.ok && r.data.balanceAfter).toBe(7)
    expect(log[0].ops[0]).toBe(
      'insert({"product_id":"p1","transaction_type":"adjusted","quantity":-2,"note":"Damaged"})',
    )
  })

  it.each([
    ['stock_insufficient', 'quantity', /not enough stock/],
    ['stock_reason_required', 'note', /why/],
    ['stock_not_tracked', undefined, /service/],
  ])('explains %s', async (message, field, text) => {
    const r = await recordMovement(
      { productId: 'p1', type: 'received', quantity: 1, note: null },
      fake({ inventory_transactions: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('filters history by product, type and South African date, newest first', async () => {
    const { client, log } = fake({ inventory_history: { data: [], count: 0 } })
    await listMovements(
      { search: '', sort: 'created_at', ascending: false, page: 1, pageSize: 25 },
      { type: 'sold', productId: 'p1', from: '2026-11-01', to: '2026-11-30' },
      client,
    )
    for (const op of [
      'eq("transaction_type","sold")',
      'eq("product_id","p1")',
      'gte("moved_on","2026-11-01")',
      'order("number",{"ascending":false})',
    ])
      expect(log[0].ops).toContain(op)
  })

  it('maps the orders that include a product', async () => {
    const { client } = fake({
      order_items: {
        data: [
          {
            quantity: 4,
            orders: {
              id: 'o1',
              number: 42,
              order_date: '2026-11-20',
              status: 'fulfilled',
              customers: { name: 'Cleo' },
            },
          },
        ],
      },
    })
    const r = await getProductOrders('p1', client)
    expect(r.ok && r.data[0]).toEqual({
      orderId: 'o1',
      reference: 'ORD-00042',
      customerName: 'Cleo',
      orderDate: '2026-11-20',
      status: 'fulfilled',
      quantity: 4,
    })
  })
})
