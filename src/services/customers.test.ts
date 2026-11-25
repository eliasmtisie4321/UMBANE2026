import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { CustomerInput, ListQuery, CustomerSort } from '@/types/customers'
import {
  createCustomer,
  getCustomer,
  getCustomerInvoices,
  getCustomerProperties,
  getCustomerTickets,
  listCustomers,
  setCustomerStatus,
  updateCustomer,
} from './customers'

const base: ListQuery<CustomerSort> = {
  search: '',
  sort: 'name',
  ascending: true,
  page: 1,
  pageSize: 25,
}
const noFilters = { status: '' as const, segment: '' as const }

const input: CustomerInput = {
  name: 'Thabo Mokoena',
  email: 'thabo@example.co.za',
  phone: '+27824419082',
  altPhone: null,
  customerType: 'individual',
  segment: 'residential',
  idNumber: null,
  companyName: null,
  registrationNumber: null,
  streetAddress: '142 Rivonia Road',
  suburb: null,
  city: 'Sandton',
  province: 'Gauteng',
  postalCode: '2196',
  notes: null,
  status: 'active',
}

const ops = (log: Array<{ ops: string[] }>, i = 0) => log[i].ops.join(' | ')

describe('listCustomers', () => {
  it('requests a counted, ordered, ranged page', async () => {
    const { client, log } = fake({ customers: { data: [], count: 0 } })
    await listCustomers(base, noFilters, client)
    const q = ops(log)
    expect(q).toContain('"count":"exact"')
    expect(q).toContain('order("name",{"ascending":true})')
    expect(q).toContain('order("id")')
    expect(q).toContain('range(0,24)')
    expect(q).not.toContain('or(')
    expect(q).not.toContain('eq(')
  })

  it('pages by offset', async () => {
    const { client, log } = fake({ customers: { data: [], count: 100 } })
    await listCustomers({ ...base, page: 3, pageSize: 10 }, noFilters, client)
    expect(ops(log)).toContain('range(20,29)')
  })

  it('applies status and segment filters and sort direction', async () => {
    const { client, log } = fake({ customers: { data: [], count: 0 } })
    await listCustomers(
      { ...base, sort: 'created_at', ascending: false },
      { status: 'pending', segment: 'commercial' },
      client,
    )
    const q = ops(log)
    expect(q).toContain('eq("status","pending")')
    expect(q).toContain('eq("segment","commercial")')
    expect(q).toContain('order("created_at",{"ascending":false})')
  })

  it('searches name, email and company, and phone by its trailing digits', async () => {
    const { client, log } = fake({ customers: { data: [], count: 0 } })
    await listCustomers({ ...base, search: '082 441' }, noFilters, client)
    const or = log[0].ops.find((o) => o.startsWith('or('))!
    expect(or).toContain('phone.ilike.*82441*')
    expect(or).toContain('name.ilike.*082 441*')
  })

  it('cannot be made to add filter clauses through the search box', async () => {
    const { client, log } = fake({ customers: { data: [], count: 0 } })
    await listCustomers(
      { ...base, search: 'x),business_id.eq.other,(name.ilike.*' },
      noFilters,
      client,
    )
    const or = JSON.parse(log[0].ops.find((o) => o.startsWith('or('))!.slice(3, -1)) as string
    // Still exactly the three search clauses: injected text stays inside the search value and
    // adds no clause of its own (no commas, parentheses or wildcards survive in it).
    const clauses = or.split(',')
    expect(clauses).toHaveLength(3)
    for (const clause of clauses) {
      expect(clause).toMatch(/^(name|email|company_name)\.ilike\.\*[^,()*]*\*$/)
    }
  })

  it('maps rows and the embedded property count', async () => {
    const { client } = fake({
      customers: {
        count: 475,
        data: [
          {
            id: 'c1',
            name: 'Kagiso Logistics',
            email: null,
            phone: '+27114821900',
            customer_type: 'business',
            segment: 'commercial',
            company_name: 'Kagiso Logistics (Pty) Ltd',
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
            properties: [{ count: 3 }],
          },
        ],
      },
    })
    const r = await listCustomers(base, noFilters, client)
    expect(r.ok && r.data.total).toBe(475)
    expect(r.ok && r.data.rows[0]).toMatchObject({
      id: 'c1',
      customerType: 'business',
      propertyCount: 3,
      companyName: 'Kagiso Logistics (Pty) Ltd',
    })
  })

  it('reports a failed query without database text', async () => {
    const { client } = fake({ customers: { error: { code: 'XX', message: 'secret' } } })
    const r = await listCustomers(base, noFilters, client)
    expect(!r.ok && r.error.message).toBe('Could not load Customers. Please try again.')
  })
})

describe('getCustomer', () => {
  it('maps a stored row', async () => {
    const { client } = fake({
      customers: {
        data: {
          id: 'c1',
          name: 'Cleo',
          email: 'c@x.co',
          phone: null,
          alt_phone: null,
          customer_type: 'individual',
          segment: null,
          id_number: '8805145028084',
          company_name: null,
          registration_number: null,
          street_address: null,
          suburb: null,
          city: 'Paarl',
          province: 'Western Cape',
          postal_code: '7646',
          notes: null,
          status: 'active',
          created_at: 'a',
          updated_at: 'b',
        },
      },
    })
    const r = await getCustomer('c1', client)
    expect(r.ok && r.data).toMatchObject({
      id: 'c1',
      idNumber: '8805145028084',
      city: 'Paarl',
      postalCode: '7646',
      segment: null,
    })
  })
  it('returns not_found when the row is missing or hidden by permissions', async () => {
    const { client } = fake({ customers: { data: null } })
    const r = await getCustomer('nope', client)
    expect(!r.ok && r.error.code).toBe('not_found')
  })
})

describe('createCustomer', () => {
  it('inserts snake_case columns and never sends business_id', async () => {
    const { client, log } = fake({ customers: { data: { id: 'new1' } } })
    const r = await createCustomer(input, client)
    expect(r).toEqual({ ok: true, data: { id: 'new1' } })
    const insert = log[0].ops.find((o) => o.startsWith('insert('))!
    const row = JSON.parse(insert.slice(7, -1))
    expect(row).toMatchObject({
      name: 'Thabo Mokoena',
      customer_type: 'individual',
      postal_code: '2196',
      alt_phone: null,
    })
    expect(row).not.toHaveProperty('business_id')
  })

  it('reports a duplicate email against the email field', async () => {
    const { client } = fake({
      customers: {
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "customers_business_email_uniq"',
        },
      },
    })
    const r = await createCustomer(input, client)
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        field: 'email',
        message: 'A customer with this email address already exists.',
      },
    })
  })

  it('reports a permission refusal', async () => {
    const { client } = fake({
      customers: {
        error: { code: '42501', message: 'new row violates row-level security policy' },
      },
    })
    const r = await createCustomer(input, client)
    expect(!r.ok && r.error.code).toBe('forbidden')
  })
})

describe('updateCustomer and setCustomerStatus', () => {
  it('updates by id', async () => {
    const { client, log } = fake({ customers: { data: [{ id: 'c1' }] } })
    expect((await updateCustomer('c1', input, client)).ok).toBe(true)
    expect(ops(log)).toContain('eq("id","c1")')
  })
  it('treats zero updated rows as not found or not permitted', async () => {
    const { client } = fake({ customers: { data: [] } })
    const r = await updateCustomer('c1', input, client)
    expect(!r.ok && r.error.message).toMatch(
      /may have been removed, or you may not have permission/,
    )
  })
  it('changes only the status when deactivating', async () => {
    const { client, log } = fake({ customers: { data: [{ id: 'c1' }] } })
    await setCustomerStatus('c1', 'inactive', client)
    expect(log[0].ops).toContain('update({"status":"inactive"})')
  })
  it('surfaces a duplicate on update too', async () => {
    const { client } = fake({
      customers: {
        error: {
          code: '23505',
          message: 'violates unique constraint "customers_business_id_number_uniq"',
        },
      },
    })
    const r = await updateCustomer('c1', input, client)
    expect(!r.ok && r.error.field).toBe('idNumber')
  })
})

describe('related records', () => {
  it('lists a customer’s properties with meter counts', async () => {
    const { client, log } = fake({
      properties: {
        data: [
          {
            id: 'p1',
            reference: 'PROP-1',
            name: 'Hub',
            address: '1 Main',
            city: 'Cape Town',
            status: 'active',
            electricity_meters: [{ count: 2 }],
          },
        ],
      },
    })
    const r = await getCustomerProperties('c1', client)
    expect(r.ok && r.data[0]).toMatchObject({ id: 'p1', meterCount: 2, reference: 'PROP-1' })
    expect(ops(log)).toContain('eq("customer_id","c1")')
  })
  it('lists invoices from the balances view, and tickets', async () => {
    const { client, log } = fake({
      invoice_balances: {
        data: [
          {
            id: 'i1',
            invoice_number: 'INV-1',
            status: 'sent',
            total: '100.00',
            balance: '40.00',
            due_date: '2026-12-01',
            is_overdue: false,
          },
        ],
      },
      support_tickets: {
        data: [
          {
            id: 't1',
            reference: 'TKT-1',
            subject: 'Blank display',
            status: 'open',
            priority: 'high',
            created_at: '2026-11-01T00:00:00Z',
          },
        ],
      },
    })
    const inv = await getCustomerInvoices('c1', client)
    const tix = await getCustomerTickets('c1', client)
    expect(inv.ok && inv.data[0]).toMatchObject({ invoiceNumber: 'INV-1', total: 100, balance: 40 })
    expect(tix.ok && tix.data[0]).toMatchObject({ reference: 'TKT-1', priority: 'high' })
    expect(log.map((l) => l.table)).toEqual(['invoice_balances', 'support_tickets'])
  })
})
