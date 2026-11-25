import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { ListQuery } from '@/types/customers'
import type { MaintenanceInput, MaintenanceSort, MeterSort, NewMeterInput } from '@/types/meters'
import {
  createMaintenance,
  listMaintenance,
  listStaffOptions,
  updateMaintenance,
} from './maintenance'
import {
  deleteReading,
  getMeter,
  getMeterConsumption,
  getMeterSummary,
  getReadingsAround,
  listMeters,
  recordReading,
  registerMeter,
  retireMeter,
  searchMeterOptions,
  updateMeter,
} from './meters'

const base: ListQuery<MeterSort> = {
  search: '',
  sort: 'serial_number',
  ascending: true,
  page: 2,
  pageSize: 25,
}
const none = { type: '' as const, status: '' as const, propertyId: '' }
const input: NewMeterInput = {
  propertyId: 'p1',
  serialNumber: 'MTR-9',
  meterType: 'smart_prepaid',
  category: 'residential_sub',
  installedOn: '2026-11-01',
  location: null,
  installerName: null,
  notes: null,
  initialReading: 12.5,
}

describe('listMeters', () => {
  it('applies filters, sanitised search, sort and paging', async () => {
    const { client, log } = fake({ meter_directory: { data: [], count: 0 } })
    await listMeters(
      { ...base, search: 'MTR-1),id.eq.(x' },
      { type: 'conventional', status: 'faulty', propertyId: 'p1' },
      client,
    )
    const q = log[0].ops.join(' | ')
    expect(q).toContain('eq("meter_type","conventional")')
    expect(q).toContain('eq("status","faulty")')
    expect(q).toContain('eq("property_id","p1")')
    expect(q).toContain('range(25,49)')
    const or = log[0].ops.find((o) => o.startsWith('or('))!
    expect(or.slice(4, -2)).not.toMatch(/[()]/)
    expect(or.split(',')).toHaveLength(5) // one clause per column: the search added none
  })

  it('keeps unknown values as null rather than zero', async () => {
    const { client } = fake({
      meter_directory: {
        count: 1,
        data: [
          {
            id: 'm1',
            serial_number: 'S',
            status: 'active',
            property_id: 'p',
            property_name: null,
            property_address: '1 Main',
            latest_value: null,
            estimated_monthly: null,
          },
        ],
      },
    })
    const r = await listMeters(base, none, client)
    expect(r.ok && r.data.rows[0]).toMatchObject({
      propertyName: '1 Main',
      latestValue: null,
      estimatedMonthly: null,
      latestIsEstimate: false,
    })
  })

  it('shows zeros, not an error, before any meter exists', async () => {
    const { client } = fake({ meter_summary: { data: null } })
    const r = await getMeterSummary(client)
    expect(r.ok && r.data.inService).toBe(0)
  })
})

describe('getMeter', () => {
  it('maps the property and customer', async () => {
    const { client } = fake({
      electricity_meters: {
        data: {
          id: 'm1',
          serial_number: 'S',
          status: 'active',
          property_id: 'p1',
          properties: {
            name: 'Hub',
            address: '1 Main',
            city: 'Sandton',
            customer_id: 'c1',
            customers: { name: 'Kagiso' },
          },
        },
      },
    })
    const r = await getMeter('m1', client)
    expect(r.ok && r.data).toMatchObject({
      propertyName: 'Hub',
      propertyAddress: '1 Main, Sandton',
      customerName: 'Kagiso',
    })
  })

  it('treats a missing meter and a malformed id as not found', async () => {
    const missing = await getMeter('m1', fake({ electricity_meters: { data: null } }).client)
    const bad = await getMeter(
      'nope',
      fake({ electricity_meters: { error: { code: '22P02', message: 'invalid uuid' } } }).client,
    )
    for (const r of [missing, bad]) expect(r.ok ? null : r.error.code).toBe('not_found')
  })
})

describe('writing meters', () => {
  it('registers through one database call and never sends business_id', async () => {
    const { client, log } = fake({ 'rpc:register_meter': { data: 'm9' } })
    const r = await registerMeter(input, client)
    expect(r.ok && r.data.id).toBe('m9')
    expect(log).toHaveLength(1)
    expect(log[0].ops[0]).toContain('"p_initial_reading":12.5')
    expect(log[0].ops[0]).not.toContain('business')
  })

  it.each([
    [
      { code: '23505', message: 'violates "meters_business_serial_ci_uniq"' },
      'serialNumber',
      /already exists/,
    ],
    [{ code: '23514', message: 'meter_installed_in_future' }, 'installedOn', /future/],
    [{ code: '23514', message: 'meter_installed_after_reading' }, 'installedOn', /readings before/],
    [{ code: '23514', message: 'meter_retired_before_reading' }, 'retiredOn', /reading after/],
    [{ code: '23514', message: 'meter_retired' }, undefined, /already been taken out of service/],
    [{ code: '42501', message: 'meter_not_found' }, undefined, /permission/],
  ])('explains %j', async (error, field, message) => {
    const r = await registerMeter(input, fake({ 'rpc:register_meter': { error } }).client)
    expect(r.ok ? undefined : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(message)
  })

  it('leaves the status alone when it is null', async () => {
    const { client, log } = fake({ electricity_meters: { data: [{ id: 'm1' }] } })
    await updateMeter('m1', { ...input, status: null }, client)
    expect(log[0].ops[0]).not.toContain('"status"')
  })

  it('reports an update the database silently refused', async () => {
    const r = await updateMeter(
      'm1',
      { ...input, status: 'active' },
      fake({ electricity_meters: { data: [] } }).client,
    )
    expect(r.ok).toBe(false)
  })

  it('replaces or decommissions depending on the new serial', async () => {
    const { client, log } = fake({ 'rpc:retire_meter': { data: null } })
    const r = await retireMeter(
      'm1',
      {
        retiredOn: '2026-11-22',
        reason: 'Gone',
        finalReading: 0,
        newSerialNumber: '',
        newInitialReading: 0,
      },
      client,
    )
    expect(r.ok && r.data.newMeterId).toBeNull()
    expect(log[0].ops[0]).toContain('"p_new_serial_number":null')
    expect(log[0].ops[0]).toContain('"p_final_reading":0')
  })
})

describe('readings', () => {
  const reading = {
    meterId: 'm1',
    readingDate: '2026-11-20',
    readingValue: 10,
    isEstimate: true,
    method: 'manual' as const,
    notes: null,
  }
  it('records and returns the flag the database set, sending neither flag nor author', async () => {
    const { client, log } = fake({ meter_readings: { data: { id: 'r1', flag: 'high' } } })
    const r = await recordReading(reading, client)
    expect(r.ok && r.data.flag).toBe('high')
    expect(log[0].ops[0]).toContain('"is_estimate":true')
    expect(log[0].ops[0]).not.toMatch(/flag|recorded_by|business/)
  })

  it.each([
    ['reading_below_previous', 'readingValue'],
    ['reading_above_next', 'readingValue'],
    ['reading_in_future', 'readingDate'],
    ['reading_before_install', 'readingDate'],
    ['reading_after_retirement', 'readingDate'],
  ])('puts %s on the %s field', async (message, field) => {
    const r = await recordReading(
      reading,
      fake({ meter_readings: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).not.toContain('_')
  })

  it('explains a second reading on one day', async () => {
    const r = await recordReading(
      reading,
      fake({
        meter_readings: {
          error: { code: '23505', message: 'key "meter_readings_meter_id_reading_date_key"' },
        },
      }).client,
    )
    expect(r.ok ? null : r.error).toMatchObject({ code: 'conflict', field: 'readingDate' })
  })

  it('treats deleting nothing as not permitted', async () => {
    const r = await deleteReading('r1', fake({ meter_readings: { data: [] } }).client)
    expect(r.ok ? null : r.error.code).toBe('forbidden')
  })

  it('fetches seven before, the day itself and the next, as numbers', async () => {
    const { client, log } = fake({
      meter_readings: (ops) =>
        ops.some((o) => o.startsWith('lt('))
          ? { data: [{ reading_date: '2026-10-01', reading_value: '10.500' }] }
          : { data: [{ reading_date: '2026-12-01', reading_value: '20' }] },
    })
    const r = await getReadingsAround('m1', '2026-11-01', client)
    expect(r.ok && r.data.map((p) => p.readingValue)).toEqual([10.5, 20])
    expect(log[0].ops).toContain('limit(7)')
    expect(log[1].ops.some((o) => o.startsWith('gte('))).toBe(true)
  })

  it('returns consumption oldest first', async () => {
    const { client } = fake({
      meter_monthly_consumption: {
        data: [
          { month: '2026-11-01', kwh: '90', days_covered: 9, has_estimate: true },
          { month: '2026-10-01', kwh: '310', days_covered: 31, has_estimate: false },
        ],
      },
    })
    const r = await getMeterConsumption('m1', 12, client)
    expect(r.ok && r.data.map((m) => m.kwh)).toEqual([310, 90])
  })

  it('offers only meters still in service', async () => {
    const { client, log } = fake({ meter_directory: { data: [] } })
    await searchMeterOptions('', client)
    expect(log[0].ops).toContain('not("status","in","(replaced,decommissioned)")')
  })
})

describe('maintenance', () => {
  const query: ListQuery<MaintenanceSort> = { ...base, sort: 'priority_rank', page: 1 }
  const work: MaintenanceInput = {
    kind: 'repair',
    issue: 'Blank',
    priority: 'urgent',
    status: 'scheduled',
    scheduledFor: '2026-12-01',
    assignedTo: null,
    outcome: null,
  }
  it.each([
    ['open', 'eq("is_open",true)'],
    ['completed', 'eq("status","completed")'],
  ] as const)('filters by %s', async (status, op) => {
    const { client, log } = fake({ maintenance_list: { data: [], count: 0 } })
    await listMaintenance(query, { priority: 'urgent', status }, client)
    expect(log[0].ops).toContain(op)
    expect(log[0].ops).toContain('eq("priority","urgent")')
  })

  it('"all" adds no status filter', async () => {
    const { client, log } = fake({ maintenance_list: { data: [], count: 0 } })
    await listMaintenance(query, { priority: '', status: 'all' }, client)
    expect(log[0].ops.some((o) => o.startsWith('eq('))).toBe(false)
  })

  it('creates without choosing business, author or completion date', async () => {
    const { client, log } = fake({ meter_maintenance: { data: { id: 'w1' } } })
    expect((await createMaintenance('m1', work, client)).ok).toBe(true)
    expect(log[0].ops[0]).not.toMatch(/business|created_by|completed_on/)
  })

  it('explains an unsuitable technician, and an update that changed nothing', async () => {
    const bad = await createMaintenance(
      'm1',
      work,
      fake({
        meter_maintenance: { error: { code: '23514', message: 'maintenance_assignee_not_staff' } },
      }).client,
    )
    expect(bad.ok ? null : bad.error.field).toBe('assignedTo')
    const gone = await updateMaintenance(
      'w1',
      work,
      fake({ meter_maintenance: { data: [] } }).client,
    )
    expect(gone.ok).toBe(false)
  })

  it('offers active team members, never clients', async () => {
    const { client, log } = fake({
      profiles: { data: [{ id: 'u1', full_name: '', email: 'a@b.test' }] },
    })
    const r = await listStaffOptions(client)
    expect(r.ok && r.data).toEqual([{ id: 'u1', name: 'a@b.test' }])
    expect(log[0].ops).toContain('neq("role","client")')
    expect(log[0].ops).toContain('eq("is_active",true)')
  })
})
