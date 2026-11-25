import { describe, expect, it } from 'vitest'
import {
  fillMonths,
  formatDate,
  formatDelta,
  formatNumber,
  formatRand,
  formatRandCompact,
  monthLabel,
  monthRange,
  percentChange,
  previousMonthRange,
} from './format'

describe('money', () => {
  it('formats whole rands and cents', () => {
    expect(formatRand(1482950)).toBe('R 1,482,950')
    expect(formatRand(250)).toBe('R 250')
    expect(formatRand(1150.5, { cents: true })).toBe('R 1,150.50')
    expect(formatRand(-40)).toBe('-R 40')
  })
  it('compacts for chart axes', () => {
    expect(formatRandCompact(0)).toBe('R0')
    expect(formatRandCompact(900)).toBe('R900')
    expect(formatRandCompact(1500)).toBe('R1.5K')
    expect(formatRandCompact(20000)).toBe('R20K')
    expect(formatRandCompact(1_482_950)).toBe('R1.5M')
    expect(formatRandCompact(2_000_000)).toBe('R2M')
  })
  it('formats counts', () => {
    expect(formatNumber(2847)).toBe('2,847')
  })
})

describe('percentChange', () => {
  it('computes change and refuses to divide by zero', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10)
    expect(percentChange(50, 100)).toBeCloseTo(-50)
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(0, 0)).toBeNull()
  })
  it('formats a signed delta', () => {
    expect(formatDelta(4.24)).toBe('+4.2%')
    expect(formatDelta(-11.8)).toBe('-11.8%')
    expect(formatDelta(0)).toBe('0%')
    expect(formatDelta(0.01)).toBe('0%')
  })
})

describe('month ranges (UTC)', () => {
  const now = new Date('2026-11-25T12:00:00Z')
  it('ends with the current month, oldest first', () => {
    expect(monthRange(3, now)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
    expect(monthRange(1, now)).toEqual(['2026-11-01'])
  })
  it('crosses year boundaries', () => {
    expect(monthRange(3, new Date('2026-01-15T00:00:00Z'))).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
    ])
  })
  it('previous range is the same length immediately before', () => {
    expect(previousMonthRange(3, now)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
  })
  it('does not shift months near midnight UTC on the last day', () => {
    expect(monthRange(1, new Date('2026-10-31T23:59:59Z'))).toEqual(['2026-10-01'])
  })
})

describe('fillMonths', () => {
  it('puts zeros in months without payments and ignores out-of-range rows', () => {
    const rows = [
      { month: '2026-09-01', total: 300 },
      { month: '2026-11-01', total: 200 },
      { month: '2025-01-01', total: 999 },
    ]
    expect(fillMonths(rows, ['2026-09-01', '2026-10-01', '2026-11-01'])).toEqual([300, 0, 200])
  })
  it('accepts numeric strings from the API', () => {
    expect(
      fillMonths([{ month: '2026-09-01', total: '12.5' as unknown as number }], ['2026-09-01']),
    ).toEqual([12.5])
  })
})

describe('dates', () => {
  it('labels months', () => {
    expect(monthLabel('2026-09-01')).toBe('Sep')
    expect(monthLabel('2026-09-01', 'long')).toBe('September 2026')
  })
  it('formats a date in UTC', () => {
    expect(formatDate('2026-11-10T10:00:00+00:00')).toBe('10 Nov 2026')
    expect(formatDate('2026-12-31T23:30:00+00:00')).toBe('31 Dec 2026')
  })
  it('always abbreviates to three letters, independent of locale data', () => {
    const labels = Array.from({ length: 12 }, (_, i) =>
      monthLabel(`2026-${String(i + 1).padStart(2, '0')}-01`),
    )
    expect(labels).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ])
    expect(formatDate('2026-09-05T08:00:00+00:00')).toBe('5 Sep 2026')
  })
})
