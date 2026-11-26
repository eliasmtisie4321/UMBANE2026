import { describe, expect, it } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { auditDetails, auditLink, describeAudit } from '@/utils/auditText'
import { validateBusiness, validateNewPassword } from '@/utils/settingsForm'
import { getRecentActivity } from './dashboard'
import { getCategories } from './inventory'
import {
  addTicketCategory,
  categoryKey,
  eraseCustomer,
  listAuditLog,
  saveBusinessProfile,
} from './settings'

const profile = {
  name: ' Umbane ',
  description: '',
  email: 'Accounts@Umbane.co.za ',
  phone: null,
  website: 'https://umbane.co.za',
  address: null,
  city: 'Sandton',
  province: 'Gauteng',
  postalCode: '2196',
}

describe('settings service', () => {
  it('saves the business profile, blank fields as empty', async () => {
    const { client, log } = fake({ businesses: { data: [{ id: 'b1' }] } })
    expect(await saveBusinessProfile('b1', profile, client)).toEqual({ ok: true, data: null })
    expect(JSON.parse(log[0].ops[0].slice('update('.length, -1))).toMatchObject({
      name: 'Umbane',
      description: null,
      email: 'accounts@umbane.co.za',
      postal_code: '2196',
    })
  })

  it('reports when the database let nothing change (not an administrator)', async () => {
    const { client } = fake({ businesses: { data: [] } })
    expect(await saveBusinessProfile('b1', profile, client)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  })

  it('makes a key from a category name', () => {
    expect(categoryKey('Solar installations')).toBe('solar_installations')
    expect(categoryKey('  Pré-paid   tokens! ')).toBe('pre_paid_tokens')
    expect(categoryKey('24h faults')).toBe('c_24h_faults')
  })

  it('adds a ticket category with its key', async () => {
    const { client, log } = fake({ ticket_categories: {} })
    await addTicketCategory(' Solar installations ', 80, client)
    expect(log[0].ops[0]).toBe(
      'insert({"key":"solar_installations","label":"Solar installations","position":80})',
    )
  })

  it('filters the audit log by South African dates, area and action, a page at a time', async () => {
    const { client, log } = fake({ audit_logs: { data: [], count: 0 } })
    await listAuditLog(
      { from: '2026-11-01', to: '2026-11-30', area: 'people', action: 'UPDATE', page: 2 },
      client,
    )
    expect(log[0].ops).toEqual(
      expect.arrayContaining([
        'gte("created_at","2026-11-01T00:00:00+02:00")',
        'lte("created_at","2026-11-30T23:59:59.999+02:00")',
        'in("table_name",["profiles","staff_invitations","access_requests"])',
        'eq("action","UPDATE")',
        'range(50,99)',
      ]),
    )
  })

  it('explains a refused erasure', async () => {
    const { client } = fake({
      'rpc:erase_customer': { error: { code: '23514', message: 'customer_has_balance' } },
    })
    expect(await eraseCustomer('c1', 'Asked', client)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('still owes money') },
    })
  })

  it('gives managers recent activity without the full audit log', async () => {
    const { client, log } = fake({
      'rpc:recent_activity': {
        data: [
          {
            id: 'a1',
            action: 'INSERT',
            table_name: 'payments',
            actor_name: 'Sam Staff',
            created_at: 'x',
          },
        ],
      },
    })
    const r = await getRecentActivity(client)
    expect(r).toEqual({
      ok: true,
      data: [
        { id: 'a1', action: 'INSERT', table: 'payments', actorName: 'Sam Staff', createdAt: 'x' },
      ],
    })
    expect(log[0]).toMatchObject({ table: 'rpc:recent_activity', ops: ['{"p_limit":8}'] })
  })

  it('suggests only switched-on product categories', async () => {
    const { client, log } = fake({ product_categories: { data: [{ name: 'Meters' }] } })
    expect(await getCategories(client)).toEqual({ ok: true, data: ['Meters'] })
    expect(log[0].ops).toContain('eq("is_active",true)')
  })
})

describe('audit wording', () => {
  const base = { id: 'e', recordId: 'r1', actorId: 'u1', createdAt: '2026-11-26T08:00:00Z' }
  it('turns entries into sentences', () => {
    expect(
      describeAudit({
        ...base,
        action: 'INSERT',
        table: 'payments',
        actorName: 'Sam',
        details: null,
      }),
    ).toBe('Sam added a payment')
    expect(
      describeAudit({
        ...base,
        action: 'DELETE',
        table: 'odd_table',
        actorName: null,
        actorId: null,
        details: null,
      }),
    ).toBe('The system deleted a odd table record')
    expect(
      describeAudit({
        ...base,
        action: 'UPDATE',
        table: 'profiles',
        actorName: null,
        details: null,
      }),
    ).toBe('A former user changed a user')
    expect(
      describeAudit({ ...base, action: 'RETENTION', table: null, actorName: null, details: {} }),
    ).toBe('The system removed records past their keeping period')
  })

  it('lists the changes, masked values as stored', () => {
    expect(
      auditDetails({
        ...base,
        action: 'UPDATE',
        table: 'customers',
        actorName: 'Ada',
        details: { changes: { id_number: [null, '•••087'], is_active: [true, false] } },
      }),
    ).toEqual(['Id number: empty → •••087', 'Is active: yes → no'])
    expect(
      auditDetails({
        ...base,
        action: 'RETENTION',
        table: null,
        actorName: null,
        details: { notifications: 3, audit_logs: 0 },
      }),
    ).toEqual(['Notifications: 3 removed'])
    expect(
      auditDetails({
        ...base,
        action: 'UPDATE',
        table: 'customers',
        actorName: null,
        details: { erased: true },
      }),
    ).toEqual(['Details removed when the customer was erased.'])
  })

  it('links to records that still exist', () => {
    expect(
      auditLink({ ...base, action: 'UPDATE', table: 'customers', actorName: null, details: null }),
    ).toBe('/customers/r1')
    expect(
      auditLink({ ...base, action: 'DELETE', table: 'customers', actorName: null, details: null }),
    ).toBeNull()
  })
})

describe('form checks', () => {
  it('checks the business profile like the database does', () => {
    expect(
      validateBusiness({ ...profile, website: 'umbane.co.za', postalCode: '219', email: 'x' }),
    ).toEqual({
      website: 'Start the website with https:// or http://',
      postalCode: 'A postal code has four digits.',
      email: 'Enter a valid email address.',
    })
    expect(validateBusiness({ ...profile, name: ' ' }).name).toBe('Enter the business name.')
  })

  it('asks for a strong, new, confirmed password', () => {
    expect(validateNewPassword('', 'Abcdefghijk1', 'Abcdefghijk1')).toEqual({
      current: 'Enter your current password.',
    })
    expect(validateNewPassword('a', 'abcdefghijkl', '').next).toMatch(/upper and lower/)
    expect(validateNewPassword('Abcdefghijk1', 'Abcdefghijk1', 'Abcdefghijk1').next).toMatch(
      /different/,
    )
    expect(validateNewPassword('a', 'Abcdefghijk1', 'Abcdefghijk2').confirm).toMatch(/do not match/)
    expect(validateNewPassword('a', 'Abcdefghijk1', 'Abcdefghijk1')).toEqual({})
  })
})
