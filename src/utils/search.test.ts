import { describe, expect, it } from 'vitest'
import { orIlike, sanitizeSearch } from './search'

describe('sanitizeSearch', () => {
  it('keeps ordinary names, emails and numbers', () => {
    expect(sanitizeSearch('  Thabo  Mokoena ')).toBe('Thabo Mokoena')
    expect(sanitizeSearch("o'brien+test@example.co.za")).toBe("o'brien+test@example.co.za")
    expect(sanitizeSearch('+27 82 441 9082')).toBe('+27 82 441 9082')
    expect(sanitizeSearch('Ñandú Müller')).toBe('Ñandú Müller')
  })
  it('removes characters that are filter syntax', () => {
    expect(sanitizeSearch('a,b(c)d"e\\f*g%h')).toBe('abcdefgh')
  })
  it('limits the length', () => {
    expect(sanitizeSearch('x'.repeat(500))).toHaveLength(100)
  })
})

describe('orIlike', () => {
  it('builds one clause per column', () => {
    expect(orIlike(['name', 'email'], 'cleo')).toBe('name.ilike.*cleo*,email.ilike.*cleo*')
  })
  it('returns null when there is nothing to search for', () => {
    expect(orIlike(['name'], '')).toBeNull()
    expect(orIlike(['name'], ' ,() ')).toBeNull()
  })
  it('cannot be used to inject extra filter clauses', () => {
    const filter = orIlike(['name'], 'x),business_id.eq.other,(name.ilike.*')!
    // One clause only: no comma-separated extra conditions survive.
    expect(filter.split(',')).toHaveLength(1)
    expect(filter).not.toContain('(')
    expect(filter).not.toContain(')')
  })
})
