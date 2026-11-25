import { describe, expect, it } from 'vitest'
import {
  getInvoiceSummary,
  getLowStock,
  getRecentActivity,
  getRecentPayments,
  getRevenue,
  getTicketSummary,
  getTotals,
  type DashboardClient,
} from './dashboard'

interface Reply {
  data?: unknown
  count?: number | null
  error?: unknown
}

/**
 * Fake client: every query-builder method records itself and returns the builder, and awaiting
 * it yields the reply configured for the table. A reply can depend on the recorded calls.
 */
function fake(replies: Record<string, Reply | ((ops: string[]) => Reply)>) {
  const log: Array<{ table: string; ops: string[] }> = []
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as string[] }
      log.push(entry)
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              const r = replies[table]
              const reply = typeof r === 'function' ? r(entry.ops) : (r ?? {})
              const value = {
                data: reply.data ?? null,
                count: reply.count ?? null,
                error: reply.error ?? null,
              }
              return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve)
            }
            return (...args: unknown[]) => {
              entry.ops.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(',')})`)
              return builder
            }
          },
        },
      )
      return builder
    },
  } as unknown as DashboardClient
  return { client, log }
}

const NOW = new Date('2026-11-25T12:00:00Z')

describe('getTotals', () => {
  it('returns the three counts and filters meters to active', async () => {
    const { client, log } = fake({
      customers: { count: 12 },
      properties: { count: 7 },
      electricity_meters: { count: 5 },
    })
    const r = await getTotals(client)
    expect(r).toEqual({ ok: true, data: { customers: 12, properties: 7, activeMeters: 5 } })
    expect(log.find((l) => l.table === 'electricity_meters')?.ops.join()).toContain(
      'eq("status","active")',
    )
  })

  it('fails the card when any count fails, with a safe message', async () => {
    const { client } = fake({
      customers: { count: 1 },
      properties: { error: { code: 'XX', message: 'secret detail' } },
    })
    const r = await getTotals(client)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.message).toBe('Could not load Totals. Please try again.')
    expect(JSON.stringify(r)).not.toContain('secret detail')
  })

  it('maps a permission error to forbidden', async () => {
    const { client } = fake({ customers: { error: { code: '42501' } } })
    const r = await getTotals(client)
    expect(!r.ok && r.error.code).toBe('forbidden')
  })

  it('explains a missing view as a pending database update', async () => {
    const { client } = fake({ electricity_meters: { error: { code: 'PGRST205' } } })
    const r = await getTotals(client)
    expect(!r.ok && r.error.message).toMatch(/latest database update/)
  })
})

describe('getInvoiceSummary', () => {
  it('reads the aggregated row', async () => {
    const { client } = fake({
      invoice_summary: {
        data: { outstanding_amount: '550.00', outstanding_count: 2, overdue_count: 1 },
      },
    })
    expect(await getInvoiceSummary(client)).toEqual({
      ok: true,
      data: { outstandingAmount: 550, outstandingCount: 2, overdueCount: 1 },
    })
  })

  it('treats no row as zeros', async () => {
    const { client } = fake({ invoice_summary: { data: null } })
    expect(await getInvoiceSummary(client)).toEqual({
      ok: true,
      data: { outstandingAmount: 0, outstandingCount: 0, overdueCount: 0 },
    })
  })
})

describe('getTicketSummary', () => {
  it('runs open, high-priority and stale counts', async () => {
    const { client } = fake({
      support_tickets: (ops) => {
        const joined = ops.join()
        if (joined.includes('lt("created_at"')) return { count: 2 }
        if (joined.includes('"priority"')) return { count: 4 }
        return { count: 9 }
      },
    })
    const r = await getTicketSummary(client, NOW)
    expect(r).toEqual({ ok: true, data: { open: 9, highPriority: 4, openOverSevenDays: 2 } })
  })

  it('uses a seven-day cutoff', async () => {
    const { client, log } = fake({ support_tickets: { count: 0 } })
    await getTicketSummary(client, NOW)
    expect(log.map((l) => l.ops.join()).join('|')).toContain('2026-11-18T12:00:00.000Z')
  })
})

describe('getLowStock', () => {
  it('returns the total count and the worst few items', async () => {
    const { client } = fake({
      product_stock: (ops) =>
        ops.join().includes('head')
          ? { count: 3 }
          : {
              count: 3,
              data: [
                {
                  product_id: 'p1',
                  sku: 'S1',
                  name: 'Meter',
                  stock_on_hand: 3,
                  low_stock_threshold: 5,
                },
              ],
            },
    })
    const r = await getLowStock(client)
    expect(r.ok && r.data.count).toBe(3)
    expect(r.ok && r.data.items[0]).toEqual({
      productId: 'p1',
      sku: 'S1',
      name: 'Meter',
      stockOnHand: 3,
      threshold: 5,
    })
  })
})

describe('getRevenue', () => {
  it('fills missing months with zero and compares with the previous period', async () => {
    const { client } = fake({
      monthly_revenue: {
        data: [
          { month: '2026-06-01', total: 100 },
          { month: '2026-09-01', total: '300.00' },
          { month: '2026-11-01', total: 200 },
        ],
      },
    })
    const r = await getRevenue(3, client, NOW)
    expect(r.ok && r.data.points).toEqual([
      { month: '2026-09-01', total: 300 },
      { month: '2026-10-01', total: 0 },
      { month: '2026-11-01', total: 200 },
    ])
    expect(r.ok && r.data.total).toBe(500)
    expect(r.ok && r.data.previousTotal).toBe(100)
  })

  it('asks only for the two periods it needs', async () => {
    const { client, log } = fake({ monthly_revenue: { data: [] } })
    await getRevenue(6, client, NOW)
    expect(log[0].ops.join()).toContain('gte("month","2025-12-01")')
  })
})

describe('getRecentPayments', () => {
  it('flattens the joined invoice and customer', async () => {
    const { client } = fake({
      payments: {
        data: [
          {
            id: 'a',
            amount: '400.00',
            paid_at: '2026-10-12T10:00:00+00:00',
            reference: 'EFT-1',
            invoices: { invoice_number: 'INV-1', customers: { name: 'Cleo' } },
          },
          {
            id: 'b',
            amount: 50,
            paid_at: '2026-10-01T10:00:00+00:00',
            reference: null,
            invoices: [{ invoice_number: 'INV-2', customers: [{ name: 'Thabo' }] }],
          },
          {
            id: 'c',
            amount: 5,
            paid_at: '2026-09-01T10:00:00+00:00',
            reference: null,
            invoices: null,
          },
        ],
      },
    })
    const r = await getRecentPayments(6, client, NOW)
    expect(r.ok && r.data.map((p) => [p.amount, p.invoiceNumber, p.customerName])).toEqual([
      [400, 'INV-1', 'Cleo'],
      [50, 'INV-2', 'Thabo'],
      [5, null, null],
    ])
  })
})

describe('getRecentActivity', () => {
  it('maps the actor name and tolerates a missing actor', async () => {
    const { client } = fake({
      audit_logs: {
        data: [
          {
            id: '1',
            action: 'INSERT',
            table_name: 'payments',
            created_at: '2026-11-10T10:00:00Z',
            profiles: { full_name: 'Sam Staff' },
          },
          {
            id: '2',
            action: 'DELETE',
            table_name: 'customers',
            created_at: '2026-11-09T10:00:00Z',
            profiles: null,
          },
        ],
      },
    })
    const r = await getRecentActivity(client)
    expect(r.ok && r.data.map((a) => a.actorName)).toEqual(['Sam Staff', null])
  })

  it('surfaces a permission error for roles that cannot read the audit log', async () => {
    const { client } = fake({ audit_logs: { error: { code: '42501' } } })
    const r = await getRecentActivity(client)
    expect(!r.ok && r.error.code).toBe('forbidden')
  })
})
