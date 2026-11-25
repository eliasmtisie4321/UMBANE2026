import { describe, expect, it } from 'vitest'
import { businessToday, checkReading, daysBetween, daysInMonth, monthNote } from './consumption'

const TODAY = '2026-11-25'
const meter = { installedOn: '2025-01-15', retiredOn: null }
// The same figures as the database test, so the two implementations are held to the same answers.
const history = [
  { readingDate: '2026-11-10', readingValue: 1785.25 },
  { readingDate: '2026-09-01', readingValue: 1200.5 },
  { readingDate: '2026-10-16', readingValue: 1535.25 },
  { readingDate: '2026-10-01', readingValue: 1385.25 },
]
const check = (readingDate: string, readingValue: number, h = history, m = meter) =>
  checkReading({ readingDate, readingValue }, h, m, TODAY)

describe('checkReading: consumption', () => {
  it('is the difference from the latest earlier reading, whatever order they arrive in', () => {
    const r = check('2026-11-20', 1870)
    expect(r.error).toBeNull()
    expect(r.previous).toEqual({ readingDate: '2026-11-10', readingValue: 1785.25 })
    expect(r.consumption).toBe(84.75)
    expect(r.days).toBe(10)
    expect(r.flag).toBeNull()
  })

  it('has no floating-point dust', () => {
    const r = check('2026-11-02', 0.3, [{ readingDate: '2026-11-01', readingValue: 0.1 }])
    expect(r.consumption).toBe(0.2)
  })

  it('is unknown for the first reading, and zero use is allowed', () => {
    expect(check('2026-11-20', 5, []).consumption).toBeNull()
    expect(check('2026-11-20', 5, []).error).toBeNull()
    const same = check('2026-11-20', 1785.25)
    expect(same.error).toBeNull()
    expect(same.consumption).toBe(0)
  })

  it('uses the neighbours when backdating', () => {
    const r = check('2026-10-10', 1450)
    expect(r.consumption).toBe(64.75)
    expect(r.days).toBe(9)
  })
})

describe('checkReading: invalid readings', () => {
  it.each([
    ['below the previous', '2026-11-20', 1785.249, 'readingValue', /below the previous.*1,785.25/],
    ['above the next', '2026-10-20', 1785.251, 'readingValue', /above the next.*1,785.25/],
    ['in the future', '2026-11-26', 9999, 'readingDate', /future/],
    ['before installation', '2025-01-14', 1, 'readingDate', /before the meter was installed/],
    ['a second one that day', '2026-11-10', 1790, 'readingDate', /already has a reading/],
  ] as const)('refuses a reading %s', (_name, date, value, field, message) => {
    const r = check(date, value)
    expect(r.error?.field).toBe(field)
    expect(r.error?.message).toMatch(message)
    expect(r.consumption).toBeNull()
  })

  it('refuses a reading after retirement but allows one on the day', () => {
    const m = { installedOn: null, retiredOn: '2026-11-22' }
    expect(
      checkReading({ readingDate: '2026-11-23', readingValue: 1900 }, history, m, TODAY).error,
    ).toMatchObject({ field: 'readingDate' })
    expect(
      checkReading({ readingDate: '2026-11-22', readingValue: 1900 }, history, m, TODAY).error,
    ).toBeNull()
  })

  it('allows today', () => {
    expect(check(TODAY, 1900).error).toBeNull()
  })
})

describe('checkReading: unusual values', () => {
  it('flags over three times, and under a fifth of, usual daily use', () => {
    expect(check('2026-11-20', 2785.25).flag).toBe('high')
    expect(check('2026-11-20', 1790.25).flag).toBe('low')
    expect(check('2026-11-20', 2785.25).baseline).toBeCloseTo(584.75 / 70, 6)
  })

  it('needs three earlier readings before judging', () => {
    const two = history.filter((r) => r.readingDate < '2026-10-10')
    expect(two).toHaveLength(2)
    expect(check('2026-11-20', 99999, two).flag).toBeNull()
  })

  it('does not judge against a meter that has never used anything', () => {
    const idle = ['2026-08-01', '2026-09-01', '2026-10-01'].map((readingDate) => ({
      readingDate,
      readingValue: 100,
    }))
    expect(check('2026-11-01', 500, idle).flag).toBeNull()
  })

  it('looks at no more than the last seven readings', () => {
    // One enormous jump long ago must not hide a high reading now.
    const old = { readingDate: '2026-01-01', readingValue: 0 }
    const steady = Array.from({ length: 7 }, (_, i) => ({
      readingDate: `2026-0${i + 2}-01`,
      readingValue: 1_000_000 + i * 30,
    }))
    expect(check('2026-09-01', 1_000_180 + 500, [old, ...steady]).flag).toBe('high')
  })
})

describe('dates', () => {
  it('uses the South African day, two hours ahead of UTC', () => {
    expect(businessToday(new Date('2026-11-25T21:59:00Z'))).toBe('2026-11-25')
    expect(businessToday(new Date('2026-11-25T22:00:00Z'))).toBe('2026-11-26')
  })

  it('counts days across months and leap years', () => {
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysInMonth('2028-02-01')).toBe(29)
    expect(daysInMonth('2026-12-01')).toBe(31)
  })
})

describe('monthNote', () => {
  it('explains partial and estimated months, and says nothing otherwise', () => {
    const m = { month: '2026-11-01', daysCovered: 30, hasEstimate: false }
    expect(monthNote(m)).toBeNull()
    expect(monthNote({ ...m, daysCovered: 9 })).toBe('Partial: 9 of 30 days')
    expect(monthNote({ ...m, daysCovered: 9, hasEstimate: true })).toBe(
      'Partial: 9 of 30 days · Includes estimates',
    )
    expect(monthNote({ ...m, daysCovered: null })).toBeNull()
  })
})
