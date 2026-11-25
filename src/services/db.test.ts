import { describe, expect, it } from 'vitest'
import { embeddedCount, mapReadError, mapWriteError, num, one } from './db'

describe('mapWriteError', () => {
  it('names the field for each known duplicate', () => {
    const cases: Array<[string, string]> = [
      ['customers_business_email_uniq', 'email'],
      ['customers_business_id_number_uniq', 'idNumber'],
      ['customers_business_registration_uniq', 'registrationNumber'],
      ['properties_business_reference_uniq', 'reference'],
      ['properties_customer_address_uniq', 'address'],
    ]
    for (const [constraint, field] of cases) {
      const e = mapWriteError(
        {
          code: '23505',
          message: `duplicate key value violates unique constraint "${constraint}"`,
        },
        'customer',
      )
      expect(e.code).toBe('conflict')
      expect(e.field).toBe(field)
    }
  })

  it('does not leak raw database details', () => {
    const e = mapWriteError(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "customers_business_email_uniq"',
        details: 'Key (business_id, lower(email::text))=(b1, secret@x.co) already exists.',
      },
      'customer',
    )
    expect(JSON.stringify(e)).not.toContain('secret@x.co')
    expect(JSON.stringify(e)).not.toContain('business_id')
  })

  it('handles an unknown duplicate, constraint failures, permissions and network', () => {
    expect(mapWriteError({ code: '23505', message: 'x' }, 'property').message).toBe(
      'This property already exists.',
    )
    expect(mapWriteError({ code: '23514' }, 'customer').code).toBe('validation')
    expect(mapWriteError({ code: '23503' }, 'property').message).toMatch(/no longer exists/)
    expect(mapWriteError({ code: '42501' }, 'customer').code).toBe('forbidden')
    expect(mapWriteError({ message: 'TypeError: Failed to fetch' }, 'customer').code).toBe(
      'network',
    )
    expect(mapWriteError({ code: 'XX000', message: 'secret' }, 'customer').message).toBe(
      'Could not save the customer. Please try again.',
    )
  })
})

describe('mapReadError', () => {
  it('maps permissions, a missing view and network failures', () => {
    expect(mapReadError({ code: '42501' }, 'Customers').code).toBe('forbidden')
    expect(mapReadError({ code: 'PGRST205' }, 'Stock').message).toMatch(/latest database update/)
    expect(mapReadError({ message: 'Failed to fetch' }, 'x').code).toBe('network')
    expect(mapReadError({ message: 'secret' }, 'Customers').message).toBe(
      'Could not load Customers. Please try again.',
    )
  })
})

describe('row helpers', () => {
  it('reads embedded counts in both shapes', () => {
    expect(embeddedCount([{ count: 3 }])).toBe(3)
    expect(embeddedCount({ count: '4' })).toBe(4)
    expect(embeddedCount([])).toBe(0)
    expect(embeddedCount(null)).toBe(0)
  })
  it('coerces numbers and joined rows', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('abc')).toBe(0)
    expect(one([{ a: 1 }])).toEqual({ a: 1 })
    expect(one({ a: 1 })).toEqual({ a: 1 })
    expect(one(null)).toBeNull()
  })
})
