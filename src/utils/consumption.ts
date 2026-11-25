import type { ReadingFlag, ReadingPoint } from '@/types/meters'

/**
 * Preview of the rules in the database trigger `check_meter_reading` (migration 0006), so a person
 * sees a problem before submitting. The database decides; keep the two in step. See docs/METERS.md.
 */

const DAY = 86_400_000
const HIGH_FACTOR = 3
const LOW_FACTOR = 1 / 5
const BASELINE_READINGS = 7
const MIN_BASELINE_READINGS = 3

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/** "Today" in South Africa (UTC+2, no daylight saving), as YYYY-MM-DD. */
export const businessToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10)

export interface ReadingCheck {
  error: { field: 'readingDate' | 'readingValue'; message: string } | null
  previous: ReadingPoint | null
  consumption: number | null
  days: number | null
  flag: ReadingFlag | null
  /** Average daily use the flag compares against; null without enough history. */
  baseline: number | null
}

const kwh = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 })

export function checkReading(
  entry: { readingDate: string; readingValue: number },
  history: ReadingPoint[],
  meter: { installedOn: string | null; retiredOn?: string | null },
  today: string = businessToday(),
): ReadingCheck {
  const sorted = [...history].sort((a, b) => a.readingDate.localeCompare(b.readingDate))
  const before = sorted.filter((r) => r.readingDate < entry.readingDate)
  const previous = before.at(-1) ?? null
  const next = sorted.find((r) => r.readingDate > entry.readingDate) ?? null
  const result: ReadingCheck = {
    error: null,
    previous,
    consumption: null,
    days: null,
    flag: null,
    baseline: null,
  }
  const fail = (field: 'readingDate' | 'readingValue', message: string): ReadingCheck => ({
    ...result,
    error: { field, message },
  })

  if (entry.readingDate > today) return fail('readingDate', 'A reading cannot be in the future.')
  if (meter.installedOn && entry.readingDate < meter.installedOn)
    return fail('readingDate', 'This is before the meter was installed.')
  if (meter.retiredOn && entry.readingDate > meter.retiredOn)
    return fail('readingDate', 'This is after the meter was taken out of service.')
  if (sorted.some((r) => r.readingDate === entry.readingDate))
    return fail('readingDate', 'This meter already has a reading on this date.')
  if (previous && entry.readingValue < previous.readingValue)
    return fail(
      'readingValue',
      `This is below the previous reading of ${kwh(previous.readingValue)} kWh.`,
    )
  if (next && entry.readingValue > next.readingValue)
    return fail('readingValue', `This is above the next reading of ${kwh(next.readingValue)} kWh.`)
  if (!previous) return result

  // Readings have three decimals; rounding removes binary floating-point dust.
  result.consumption = Math.round((entry.readingValue - previous.readingValue) * 1000) / 1000
  result.days = daysBetween(previous.readingDate, entry.readingDate)

  const recent = before.slice(-BASELINE_READINGS)
  const used = recent[recent.length - 1].readingValue - recent[0].readingValue
  if (recent.length >= MIN_BASELINE_READINGS && used > 0) {
    const baseline = used / daysBetween(recent[0].readingDate, previous.readingDate)
    const daily = result.consumption / result.days
    result.baseline = baseline
    if (daily > baseline * HIGH_FACTOR) result.flag = 'high'
    else if (daily < baseline * LOW_FACTOR) result.flag = 'low'
  }
  return result
}

export const FLAG_LABEL: Record<ReadingFlag, string> = {
  high: 'Unusually high',
  low: 'Unusually low',
}

export const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

/** Why a month's figure is not a plain measurement, or null when it is. */
export function monthNote(m: {
  month: string
  daysCovered: number | null
  hasEstimate: boolean
}): string | null {
  const notes: string[] = []
  const total = daysInMonth(m.month)
  if (m.daysCovered !== null && m.daysCovered < total)
    notes.push(`Partial: ${m.daysCovered} of ${total} days`)
  if (m.hasEstimate) notes.push('Includes estimates')
  return notes.length > 0 ? notes.join(' · ') : null
}
