import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import {
  camelize,
  getCustomerReport,
  getElectricityReport,
  getRevenueReport,
  getSalesReport,
  listProductCategories,
} from './reports'

const range = { from: '2024-03-01', to: '2024-03-31' }

describe('camelize', () => {
  it('converts keys at every level but keeps stored values used as keys', () => {
    expect(
      camelize({
        row_count: 2,
        by_status: { in_progress: 1, on_leave: 2 },
        rows: [{ customer_name: 'A', last_activity: null }],
        by_employment: { on_leave: 1 },
      }),
    ).toEqual({
      rowCount: 2,
      byStatus: { in_progress: 1, on_leave: 2 },
      rows: [{ customerName: 'A', lastActivity: null }],
      byEmployment: { on_leave: 1 },
    })
  })
})

describe('reports', () => {
  it('calls the report function with the period and maps the result', async () => {
    const { client, log } = fake({
      'rpc:report_sales': { data: { order_value: 1150, avg_settlement_days: 26, rows: [] } },
    })
    const r = await getSalesReport(range, client)
    expect(r).toEqual({ ok: true, data: { orderValue: 1150, avgSettlementDays: 26, rows: [] } })
    expect(log[0]).toMatchObject({
      table: 'rpc:report_sales',
      ops: ['{"p_from":"2024-03-01","p_to":"2024-03-31"}'],
    })
  })

  it('sends empty filters as null, meaning everything', async () => {
    const { client, log } = fake({ 'rpc:report_customers': { data: { total: 0 } } })
    await getCustomerReport(range, { segment: '', province: 'Gauteng' }, client)
    expect(JSON.parse(log[0].ops[0])).toEqual({
      p_from: '2024-03-01',
      p_to: '2024-03-31',
      p_segment: null,
      p_province: 'Gauteng',
    })
    const e = fake({ 'rpc:report_electricity': { data: {} } })
    await getElectricityReport(range, { property: 'p1', meterType: 'none' }, e.client)
    expect(JSON.parse(e.log[0].ops[0])).toMatchObject({ p_property_id: 'p1', p_meter_type: 'none' })
  })

  it('explains a refused period and a refused role in words', async () => {
    const invalid = await getRevenueReport(
      range,
      {},
      fake({ 'rpc:report_revenue': { error: { code: '22023', message: 'report_range_too_long' } } })
        .client,
    )
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Choose a period of five years or less.' },
    })
    const forbidden = await getRevenueReport(
      range,
      {},
      fake({ 'rpc:report_revenue': { error: { code: '42501', message: 'permission denied' } } })
        .client,
    )
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('treats an empty answer as a failure rather than showing zeros', async () => {
    const r = await getSalesReport(range, fake({ 'rpc:report_sales': { data: null } }).client)
    expect(r.ok).toBe(false)
  })

  it('lists product categories once each, in order', async () => {
    const { client } = fake({
      products: { data: [{ category: 'Meters' }, { category: 'Cables' }, { category: 'Meters' }] },
    })
    expect(await listProductCategories(client)).toEqual({ ok: true, data: ['Cables', 'Meters'] })
  })
})
