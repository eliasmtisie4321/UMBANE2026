import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { supplierFixture } from '@/test/fixtures'
import type { ListQuery } from '@/types/customers'
import type { InvoiceInput, InvoiceSort } from '@/types/invoices'
import {
  cancelInvoice,
  getBillingProfile,
  getInvoice,
  getInvoiceSummary,
  invoiceOrder,
  issueInvoice,
  listInvoices,
  listPayments,
  recordPayment,
  removePayment,
  saveInvoice,
  updateBillingProfile,
} from './invoices'

const query: ListQuery<InvoiceSort> = {
  search: '',
  sort: 'created_at',
  ascending: false,
  page: 1,
  pageSize: 25,
}
const none = { status: '' as const, customerId: '', from: '', to: '' }
const input: InvoiceInput = {
  customerId: 'c1',
  propertyId: null,
  orderId: null,
  paymentTerms: 'net30',
  dueDate: null,
  discountPercent: 0,
  vatRate: 15,
  notes: null,
  items: [{ productId: null, description: 'CT meter', quantity: 1, unitPrice: 10 }],
}

describe('listInvoices', () => {
  it.each([
    ['overdue', 'eq("is_overdue",true)'],
    ['sent', 'eq("display_status","sent")'],
    ['partially_paid', 'eq("display_status","partially_paid")'],
    ['paid', 'eq("status","paid")'],
    ['draft', 'eq("status","draft")'],
  ] as const)('filters %s the way people mean it', async (status, op) => {
    const { client, log } = fake({ invoice_list: { data: [], count: 0 } })
    await listInvoices(query, { ...none, status }, client)
    expect(log[0].ops).toContain(op)
  })

  it('filters by customer and issue date, and searches safely', async () => {
    const { client, log } = fake({ invoice_list: { data: [], count: 0 } })
    await listInvoices(
      { ...query, search: 'INV),status.eq.(paid' },
      { status: '', customerId: 'c1', from: '2026-11-01', to: '2026-11-30' },
      client,
    )
    expect(log[0].ops).toContain('gte("issue_date","2026-11-01")')
    expect(log[0].ops).toContain('eq("customer_id","c1")')
    const or = log[0].ops.find((o) => o.startsWith('or('))!
    expect(or.slice(4, -2)).not.toMatch(/[()]/)
  })
})

describe('getInvoice', () => {
  it('combines the invoice, its lines and the customer address', async () => {
    const { client } = fake({
      invoice_list: {
        data: {
          id: 'i1',
          reference: 'INV-2026-00001',
          invoice_number: 'INV-2026-00001',
          customer_id: 'c1',
          customer_name: 'Cleo',
          status: 'sent',
          display_status: 'overdue',
          total: '115.00',
          paid: '15',
          balance: '100',
          payment_terms: 'net30',
        },
      },
      invoice_items: { data: [{ id: 'l1', description: 'X', quantity: 1, unit_price: '100.00' }] },
      customers: {
        data: {
          name: 'Cleo',
          street_address: '12 Long St',
          city: 'Cape Town',
          postal_code: '8001',
        },
      },
    })
    const r = await getInvoice('i1', client)
    expect(r.ok && r.data).toMatchObject({
      displayStatus: 'overdue',
      balance: 100,
      items: [{ unitPrice: 100 }],
      billTo: { address: ['12 Long St', 'Cape Town 8001'] },
    })
  })

  it('fails rather than showing an invoice without its lines', async () => {
    const r = await getInvoice(
      'i1',
      fake({
        invoice_list: { data: { id: 'i1', customer_id: 'c1' } },
        invoice_items: { error: { code: '42501' } },
      }).client,
    )
    expect(r.ok).toBe(false)
  })

  it('treats a missing invoice and a malformed id as not found', async () => {
    for (const reply of [{ data: null }, { error: { code: '22P02' } }]) {
      const r = await getInvoice('x', fake({ invoice_list: reply }).client)
      expect(r.ok ? null : r.error.code).toBe('not_found')
    }
  })
})

describe('writing invoices', () => {
  it('saves a draft in one call without totals or numbers', async () => {
    const { client, log } = fake({ 'rpc:save_invoice': { data: 'i1' } })
    expect((await saveInvoice(null, input, client)).ok).toBe(true)
    expect(log[0].ops[0]).not.toMatch(/total|tax|invoice_number|business/)
  })

  it('issues by asking for the status only, with the date', async () => {
    const { client, log } = fake({ invoices: { data: [{ id: 'i1' }] } })
    await issueInvoice('i1', '2026-11-26', client)
    expect(log[0].ops[0]).toBe('update({"status":"sent","issue_date":"2026-11-26"})')
  })

  it.each([
    ['invoice_locked', /cannot be changed/],
    ['invoice_has_payments', /remove them/],
    ['invoice_cancel_manager', /manager/],
    ['invoice_vat_not_registered', /not VAT registered/],
  ])('explains %s', async (message, text) => {
    const r = await cancelInvoice(
      'i1',
      'x',
      fake({ invoices: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('explains an order that cannot be invoiced', async () => {
    const r = await invoiceOrder(
      'o1',
      fake({ 'rpc:invoice_order': { error: { code: '23514', message: 'order_already_invoiced' } } })
        .client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(/already has an invoice/)
  })
})

describe('payments', () => {
  const pay = {
    invoiceId: 'i1',
    amount: 100,
    paidOn: '2026-11-26',
    method: 'eft' as const,
    reference: null,
    notes: null,
  }
  it('records the date at midday in South Africa and never sends who recorded it', async () => {
    const { client, log } = fake({ payments: { data: { id: 'p1' } } })
    await recordPayment(pay, client)
    expect(log[0].ops[0]).toContain('"paid_at":"2026-11-26T12:00:00+02:00"')
    expect(log[0].ops[0]).not.toMatch(/recorded_by|business/)
  })

  it.each([
    ['payment_exceeds_balance', 'amount'],
    ['payment_in_future', 'paidOn'],
    ['payment_before_issue', 'paidOn'],
  ])('puts %s on the %s field', async (message, field) => {
    const r = await recordPayment(
      pay,
      fake({ payments: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
  })

  it('treats removing nothing as not permitted', async () => {
    const r = await removePayment('p1', fake({ payments: { data: [] } }).client)
    expect(r.ok ? null : r.error.code).toBe('forbidden')
  })

  it('filters payments by method and date', async () => {
    const { client, log } = fake({ payment_list: { data: [], count: 0 } })
    await listPayments(
      { ...query, sort: 'paid_at' },
      { method: 'cash', from: '2026-11-01', to: '' },
      client,
    )
    expect(log[0].ops).toContain('eq("method","cash")')
    expect(log[0].ops).toContain('gte("paid_on","2026-11-01")')
  })
})

describe('summary and billing details', () => {
  it('shows zeros before any invoice exists', async () => {
    const r = await getInvoiceSummary(fake({ invoice_status_summary: { data: null } }).client)
    expect(r.ok && r.data.outstanding).toBe(0)
  })

  it('reads the supplier details through the database function', async () => {
    const { client, log } = fake({
      'rpc:billing_profile': {
        data: { name: 'Umbane', vat_registered: false, default_payment_terms: 'net7' },
      },
    })
    const r = await getBillingProfile(client)
    expect(r.ok && r.data).toMatchObject({ vatRegistered: false, defaultPaymentTerms: 'net7' })
    expect(log[0].ops).toContain('maybeSingle()')
  })

  it('reports a refused update as administrators only', async () => {
    const r = await updateBillingProfile(
      'b1',
      supplierFixture(),
      fake({ businesses: { data: [] } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(/administrator/)
  })
})
