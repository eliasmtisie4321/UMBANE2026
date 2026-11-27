import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  daysOf,
  monthGrid,
  monthLabel,
  saDate,
  saTime,
  timeRange,
  toInstant,
  weekday,
} from './calendar'

describe('calendar dates in South African time', () => {
  it('reads the South African date and time of an instant', () => {
    expect(saDate('2026-12-31T22:30:00Z')).toBe('2027-01-01')
    expect(saTime('2026-12-31T22:30:00Z')).toBe('00:30')
    expect(toInstant('2026-12-03', '09:15')).toBe('2026-12-03T07:15:00.000Z')
  })

  it('moves days and months across ends of months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
  })

  it('lays a month out in six weeks starting on Monday', () => {
    const grid = monthGrid('2026-12-10')
    expect(grid).toHaveLength(42)
    expect(weekday(grid[0])).toBe(0)
    expect(grid[0]).toBe('2026-11-30')
    expect(grid).toContain('2026-12-31')
    expect(monthLabel('2026-12-01')).toBe('December 2026')
  })

  it('knows which days an item covers', () => {
    expect(
      daysOf({ startsAt: toInstant('2026-12-05'), endsAt: toInstant('2026-12-07'), allDay: true }),
    ).toEqual(['2026-12-05', '2026-12-06'])
    expect(
      daysOf({
        startsAt: toInstant('2026-12-05', '22:00'),
        endsAt: toInstant('2026-12-06', '02:00'),
        allDay: false,
      }),
    ).toEqual(['2026-12-05', '2026-12-06'])
    expect(
      daysOf({
        startsAt: toInstant('2026-12-05', '09:00'),
        endsAt: toInstant('2026-12-06', '00:00'),
        allDay: false,
      }),
    ).toEqual(['2026-12-05'])
  })

  it('writes the time of an item', () => {
    expect(
      timeRange({
        startsAt: toInstant('2026-12-05', '09:00'),
        endsAt: toInstant('2026-12-05', '10:30'),
        allDay: false,
      }),
    ).toBe('09:00–10:30')
    expect(
      timeRange({
        startsAt: toInstant('2026-12-05'),
        endsAt: toInstant('2026-12-06'),
        allDay: true,
      }),
    ).toBe('All day')
  })
})
