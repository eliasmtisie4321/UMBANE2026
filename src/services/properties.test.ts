import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { ListQuery } from '@/types/customers'
import type { PropertyInput, PropertySort } from '@/types/properties'
import {
  createProperty,
  getCustomerOption,
  getProperty,
  getPropertyMeters,
  getPropertyReadings,
  listProperties,
  searchCustomerOptions,
  updateProperty,
} from './properties'

const base: ListQuery<PropertySort> = {
  search: '',
  sort: 'name',
  ascending: true,
  page: 1,
  pageSize: 25,
}
const noFilters = { type: '' as const, status: '' as const, customerId: '' }

const input: PropertyInput = {
  customerId: 'c1',
  reference: 'PROP-4015',
  name: 'Sandown Hub',
  address: '173 Oxford Road',
  suburb: 'Rosebank',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2196',
  propertyType: 'commercial',
  units: 24,
  status: 'active',
}

describe('listProperties', () => {
  it('filters by type and status and searches the address fields', async () => {
    const { client, log } = fake({ properties: { data: [], count: 0 } })
    await listProperties(
      { ...base, search: 'oxford' },
      { type: 'commercial', status: 'maintenance', customerId: 'c1' },
      client,
    )
    const q = log[0].ops.join(' | ')
    expect(q).toContain('eq("property_type","commercial")')
    expect(q).toContain('eq("status","maintenance")')
    expect(q).toContain('eq("customer_id","c1")')
    expect(q).toContain('address.ilike.*oxford*')
    expect(q).toContain('reference.ilike.*oxford*')
    expect(q).toContain('range(0,24)')
  })

  it('maps owner and meter count', async () => {
    const { client } = fake({
      properties: {
        count: 614,
        data: [
          {
            id: 'p1',
            reference: 'PROP-1',
            name: 'Hub',
            address: '1 Main',
            suburb: null,
            city: 'Sandton',
            property_type: 'commercial',
            units: 12,
            status: 'active',
            created_at: 'x',
            customers: { name: 'Kagiso' },
            electricity_meters: [{ count: 5 }],
          },
        ],
      },
    })
    const r = await listProperties(base, noFilters, client)
    expect(r.ok && r.data.total).toBe(614)
    expect(r.ok && r.data.rows[0]).toMatchObject({
      ownerName: 'Kagiso',
      meterCount: 5,
      units: 12,
      propertyType: 'commercial',
    })
  })

  it('tolerates a property with no owner row visible', async () => {
    const { client } = fake({
      properties: {
        count: 1,
        data: [
          {
            id: 'p1',
            address: '1 Main',
            status: 'active',
            created_at: 'x',
            customers: null,
            electricity_meters: [],
          },
        ],
      },
    })
    const r = await listProperties(base, noFilters, client)
    expect(r.ok && r.data.rows[0]).toMatchObject({ ownerName: null, meterCount: 0, units: null })
  })
})

describe('getProperty', () => {
  it('maps the owner from the joined customer', async () => {
    const { client } = fake({
      properties: {
        data: {
          id: 'p1',
          customer_id: 'c1',
          customers: [{ name: 'Kagiso' }],
          reference: null,
          name: null,
          address: '1 Main',
          suburb: null,
          city: null,
          province: null,
          postal_code: null,
          property_type: null,
          units: null,
          status: 'offline',
          created_at: 'x',
        },
      },
    })
    const r = await getProperty('p1', client)
    expect(r.ok && r.data).toMatchObject({ ownerName: 'Kagiso', status: 'offline', units: null })
  })
  it('returns not_found when missing', async () => {
    const { client } = fake({ properties: { data: null } })
    const r = await getProperty('x', client)
    expect(!r.ok && r.error.code).toBe('not_found')
  })
})

describe('createProperty and updateProperty', () => {
  it('inserts the owner id and never a business id', async () => {
    const { client, log } = fake({ properties: { data: { id: 'p9' } } })
    const r = await createProperty(input, client)
    expect(r).toEqual({ ok: true, data: { id: 'p9' } })
    const row = JSON.parse(log[0].ops.find((o) => o.startsWith('insert('))!.slice(7, -1))
    expect(row).toMatchObject({
      customer_id: 'c1',
      postal_code: '2196',
      property_type: 'commercial',
      units: 24,
    })
    expect(row).not.toHaveProperty('business_id')
  })
  it('explains a duplicate address', async () => {
    const { client } = fake({
      properties: {
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "properties_customer_address_uniq"',
        },
      },
    })
    const r = await createProperty(input, client)
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        field: 'address',
        message: 'This customer already has a property at this address.',
      },
    })
  })
  it('explains a duplicate reference on update', async () => {
    const { client } = fake({
      properties: {
        error: {
          code: '23505',
          message: 'violates unique constraint "properties_business_reference_uniq"',
        },
      },
    })
    const r = await updateProperty('p1', input, client)
    expect(!r.ok && r.error.field).toBe('reference')
  })
  it('treats zero updated rows as not found or not permitted', async () => {
    const { client } = fake({ properties: { data: [] } })
    const r = await updateProperty('p1', input, client)
    expect(!r.ok && r.error.code).toBe('not_found')
  })
})

describe('meters and readings', () => {
  it('lists a property’s meters', async () => {
    const { client, log } = fake({
      electricity_meters: {
        data: [
          { id: 'm1', serial_number: 'MTR-0001', status: 'active', installed_on: '2025-01-15' },
        ],
      },
    })
    const r = await getPropertyMeters('p1', client)
    expect(r.ok && r.data[0]).toEqual({
      id: 'm1',
      serialNumber: 'MTR-0001',
      status: 'active',
      installedOn: '2025-01-15',
    })
    expect(log[0].ops.join()).toContain('eq("property_id","p1")')
  })
  it('lists the latest readings across the property’s meters via an inner join', async () => {
    const { client, log } = fake({
      meter_readings: {
        data: [
          {
            id: 'r1',
            reading_date: '2026-10-01',
            reading_value: '1385.250',
            is_estimate: false,
            electricity_meters: { serial_number: 'MTR-0001' },
          },
        ],
      },
    })
    const r = await getPropertyReadings('p1', client)
    expect(r.ok && r.data[0]).toEqual({
      id: 'r1',
      serialNumber: 'MTR-0001',
      readingDate: '2026-10-01',
      readingValue: 1385.25,
      isEstimate: false,
    })
    const q = log[0].ops.join(' | ')
    expect(q).toContain('electricity_meters!inner')
    expect(q).toContain('eq("electricity_meters.property_id","p1")')
    expect(q).toContain('limit(10)')
  })
})

describe('owner picker', () => {
  it('excludes inactive customers and caps results', async () => {
    const { client, log } = fake({
      customers: {
        data: [{ id: 'c1', name: 'Kagiso', company_name: 'Kagiso (Pty) Ltd', email: null }],
      },
    })
    const r = await searchCustomerOptions('kag', client)
    expect(r.ok && r.data[0]).toEqual({
      id: 'c1',
      name: 'Kagiso',
      companyName: 'Kagiso (Pty) Ltd',
      email: null,
    })
    const q = log[0].ops.join(' | ')
    expect(q).toContain('neq("status","inactive")')
    expect(q).toContain('limit(8)')
    expect(q).toContain('name.ilike.*kag*')
  })
  it('loads one customer by id', async () => {
    const { client } = fake({
      customers: { data: { id: 'c1', name: 'Kagiso', company_name: null, email: 'k@x.co' } },
    })
    const r = await getCustomerOption('c1', client)
    expect(r.ok && r.data.name).toBe('Kagiso')
  })
})
