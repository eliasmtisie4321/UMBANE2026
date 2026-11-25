import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { ListQuery } from '@/types/customers'
import type { LeadInput, LeadSort, OrderInput, OrderSort } from '@/types/sales'
import {
  convertLead,
  createLead,
  getLead,
  getLeadMatches,
  listLeads,
  loseLead,
  updateLead,
} from './leads'
import {
  getMonthlySales,
  getOrder,
  getSalesSummary,
  listOrders,
  saveOrder,
  searchProducts,
  setOrderStatus,
} from './orders'
import {
  createActivity,
  getActivities,
  getOpenActivities,
  getTimeline,
  updateActivity,
} from './salesActivities'

const leadQuery: ListQuery<LeadSort> = {
  search: '',
  sort: 'created_at',
  ascending: false,
  page: 1,
  pageSize: 25,
}
const orderQuery: ListQuery<OrderSort> = { ...leadQuery, sort: 'order_date' }
const lead: LeadInput = {
  name: 'Gavin',
  companyName: null,
  email: 'g@m.test',
  phone: null,
  source: 'web',
  serviceInterest: null,
  estimatedValue: 1,
  expectedClose: null,
  followUpOn: null,
  assignedTo: null,
  notes: null,
  stage: 'new',
}
const order: OrderInput = {
  customerId: 'c1',
  propertyId: null,
  leadId: 'l1',
  assignedTo: null,
  orderDate: '2026-11-25',
  paymentMethod: null,
  discountPercent: 5,
  vatRate: 15,
  notes: null,
  items: [{ productId: null, description: 'CT meter', quantity: 2, unitPrice: 120000 }],
}

describe('leads', () => {
  it('lists open leads by default and applies filters and phone search', async () => {
    const { client, log } = fake({ lead_list: { data: [], count: 0 } })
    await listLeads(
      { ...leadQuery, search: '011 684' },
      { status: 'open', source: 'web', assignedTo: 'u1' },
      client,
    )
    expect(log[0].ops).toContain('eq("is_open",true)')
    expect(log[0].ops).toContain('eq("source","web")')
    expect(log[0].ops).toContain('eq("assigned_to","u1")')
    expect(log[0].ops.join()).toContain('phone.ilike.*11684*')
  })

  it('keeps search text from adding filter clauses', async () => {
    const { client, log } = fake({ lead_list: { data: [], count: 0 } })
    await listLeads(
      { ...leadQuery, search: 'x),status.eq.(lost' },
      { status: 'all', source: '', assignedTo: '' },
      client,
    )
    const or = log[0].ops.find((o) => o.startsWith('or('))!
    expect(or.slice(4, -2)).not.toMatch(/[()]/)
    expect(log[0].ops.some((o) => o.startsWith('eq('))).toBe(false)
  })

  it('treats a missing lead and a malformed id as not found', async () => {
    for (const reply of [{ data: null }, { error: { code: '22P02' } }]) {
      const r = await getLead('x', fake({ lead_list: reply }).client)
      expect(r.ok ? null : r.error.code).toBe('not_found')
    }
  })

  it('never sends the business or a conversion, and leaves a closed stage alone', async () => {
    const { client, log } = fake({ leads: { data: { id: 'l1' } } })
    await createLead(lead, client)
    expect(log[0].ops[0]).toContain('"status":"new"')
    expect(log[0].ops[0]).not.toMatch(/business|converted/)
    const second = fake({ leads: { data: [{ id: 'l1' }] } })
    await updateLead('l1', { ...lead, stage: null }, second.client)
    expect(second.log[0].ops[0]).not.toContain('"status"')
  })

  it('reports an update the database silently refused', async () => {
    const r = await loseLead('l1', 'No budget', fake({ leads: { data: [] } }).client)
    expect(r.ok).toBe(false)
  })

  it('converts through one database call, and explains refusals', async () => {
    const { client, log } = fake({ 'rpc:convert_lead': { data: 'c9' } })
    const r = await convertLead('l1', null, true, client)
    expect(r.ok && r.data.customerId).toBe('c9')
    expect(log[0].ops[0]).toBe('{"p_lead_id":"l1","p_customer_id":null,"p_create_anyway":true}')
    for (const [message, text] of [
      ['lead_customer_exists', /already exists/],
      ['lead_not_approved', /Qualified/],
      ['lead_converted', /already been converted/],
    ] as const) {
      const bad = await convertLead(
        'l1',
        null,
        false,
        fake({ 'rpc:convert_lead': { error: { code: '23514', message } } }).client,
      )
      expect(bad.ok ? '' : bad.error.message).toMatch(text)
    }
  })

  it('maps matching customers', async () => {
    const { client } = fake({
      'rpc:lead_matches': {
        data: [{ id: 'c1', name: 'Cleo', email: null, phone: null, matched_on: 'phone' }],
      },
    })
    const r = await getLeadMatches('l1', client)
    expect(r.ok && r.data[0]).toMatchObject({ id: 'c1', matchedOn: 'phone', companyName: null })
  })
})

describe('orders', () => {
  it('filters by status, customer and date range', async () => {
    const { client, log } = fake({ order_list: { data: [], count: 0 } })
    await listOrders(
      orderQuery,
      { status: 'pending', customerId: 'c1', from: '2026-11-01', to: '2026-11-30' },
      client,
    )
    for (const op of [
      'eq("status","pending")',
      'eq("customer_id","c1")',
      'gte("order_date","2026-11-01")',
      'lte("order_date","2026-11-30")',
    ])
      expect(log[0].ops).toContain(op)
  })

  it('saves the order and its lines in one call, sending no totals', async () => {
    const { client, log } = fake({ 'rpc:save_order': { data: 'o1' } })
    const r = await saveOrder(null, order, client)
    expect(r.ok && r.data.id).toBe('o1')
    expect(log).toHaveLength(1)
    expect(log[0].ops[0]).toContain('"quantity":2')
    expect(log[0].ops[0]).not.toMatch(/total|subtotal|tax|business/)
  })

  it.each([
    ['order_locked', undefined, /pending order/],
    ['order_date_future', 'orderDate', /future/],
    ['order_property_mismatch', undefined, /does not belong/],
    ['assignee_not_staff', 'assignedTo', /team member/],
    ['order_empty', undefined, /at least one/],
  ])('explains %s', async (message, field, text) => {
    const r = await saveOrder(
      null,
      order,
      fake({ 'rpc:save_order': { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('treats an amount too large to store as a validation problem', async () => {
    const r = await saveOrder(
      null,
      order,
      fake({ 'rpc:save_order': { error: { code: '22003', message: 'overflow' } } }).client,
    )
    expect(r.ok ? null : r.error.code).toBe('validation')
  })

  it('sends a reason only when cancelling', async () => {
    const a = fake({ orders: { data: [{ id: 'o1' }] } })
    await setOrderStatus('o1', 'cancelled', 'Changed mind', a.client)
    expect(a.log[0].ops[0]).toContain('"cancel_reason":"Changed mind"')
    const b = fake({ orders: { data: [{ id: 'o1' }] } })
    await setOrderStatus('o1', 'confirmed', null, b.client)
    expect(b.log[0].ops[0]).toBe('update({"status":"confirmed"})')
    const refused = await setOrderStatus(
      'o1',
      'confirmed',
      null,
      fake({ orders: { data: [] } }).client,
    )
    expect(refused.ok).toBe(false)
  })

  it('loads an order with its lines as numbers', async () => {
    const { client } = fake({
      order_list: { data: { id: 'o1', reference: 'ORD-00001', status: 'pending', total: '10.50' } },
      order_items: {
        data: [
          {
            id: 'i1',
            product_id: 'p1',
            description: 'X',
            quantity: 2,
            unit_price: '5.25',
            products: { sku: 'S' },
          },
          {
            id: 'i2',
            product_id: null,
            description: 'Y',
            quantity: 1,
            unit_price: '0',
            products: null,
          },
        ],
      },
    })
    const r = await getOrder('o1', client)
    expect(r.ok && r.data.total).toBe(10.5)
    expect(r.ok && r.data.items.map((i) => [i.sku, i.unitPrice])).toEqual([
      ['S', 5.25],
      [null, 0],
    ])
  })

  it('does not show an order whose lines failed to load', async () => {
    const r = await getOrder(
      'o1',
      fake({ order_list: { data: { id: 'o1' } }, order_items: { error: { code: '42501' } } })
        .client,
    )
    expect(r.ok).toBe(false)
  })

  it('shows zeros before any order exists', async () => {
    const r = await getSalesSummary(fake({ sales_summary: { data: null } }).client)
    expect(r.ok && r.data.pendingCount).toBe(0)
  })

  it('fills missing months with zero, counting months from South African time', async () => {
    const { client, log } = fake({
      monthly_sales: { data: [{ month: '2026-12-01', total: '50' }] },
    })
    // 30 Nov 22:30 UTC is already 1 December in South Africa.
    const r = await getMonthlySales(3, client, new Date('2026-11-30T22:30:00Z'))
    expect(r.ok && r.data).toEqual([
      { month: '2026-10-01', total: 0 },
      { month: '2026-11-01', total: 0 },
      { month: '2026-12-01', total: 50 },
    ])
    expect(log[0].ops).toContain('gte("month","2026-10-01")')
  })

  it('offers active products only', async () => {
    const { client, log } = fake({ products: { data: [] } })
    await searchProducts('meter', client)
    expect(log[0].ops).toContain('eq("is_active",true)')
  })
})

describe('activities', () => {
  const input = {
    kind: 'call' as const,
    subject: 'Call',
    dueOn: null,
    assignedTo: null,
    outcome: null,
    done: false,
  }
  it('links to the lead or the order', async () => {
    const { client, log } = fake({ sales_activities: { data: { id: 'a1' } } })
    await createActivity({ orderId: 'o1' }, input, client)
    expect(log[0].ops[0]).toContain('"order_id":"o1"')
    expect(log[0].ops[0]).not.toMatch(/lead_id|created_by|business/)
    const read = fake({ sales_activity_list: { data: [] } })
    await getActivities({ leadId: 'l1' }, read.client)
    expect(read.log[0].ops).toContain('eq("lead_id","l1")')
  })

  it('lists one person’s open activities, or everyone’s', async () => {
    const { client, log } = fake({ sales_activity_list: { data: [] } })
    await getOpenActivities('u1', client)
    await getOpenActivities('', client)
    expect(log[0].ops).toContain('eq("assigned_to","u1")')
    expect(log[1].ops.join()).not.toContain('assigned_to')
  })

  it('reopens by clearing the completion, and reports a refused update', async () => {
    const { client, log } = fake({ sales_activities: { data: [{ id: 'a1' }] } })
    await updateActivity('a1', input, client)
    expect(log[0].ops[0]).toContain('"completed_at":null')
    const r = await updateActivity('a1', input, fake({ sales_activities: { data: [] } }).client)
    expect(r.ok).toBe(false)
  })

  it('maps history', async () => {
    const { client } = fake({
      sales_timeline: {
        data: [
          { id: 'e1', from_status: null, to_status: 'new', actor_name: null, created_at: 'x' },
        ],
      },
    })
    const r = await getTimeline({ leadId: 'l1' }, client)
    expect(r.ok && r.data[0]).toMatchObject({ fromStatus: null, toStatus: 'new', actorName: null })
  })
})
