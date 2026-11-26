import type { ReportRange } from '@/types/reports'
import { formatDate } from './format'
import { isRealDate } from './meterForm'

export type RangePreset =
  | 'this-month'
  | 'last-month'
  | 'last-3-months'
  | 'last-12-months'
  | 'this-year'
  | 'last-year'
  | 'custom'

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'last-12-months', label: 'Last 12 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'custom', label: 'Custom dates' },
]

export const DEFAULT_PRESET: Exclude<RangePreset, 'custom'> = 'last-12-months'
/** The database refuses longer periods (report_check). */
export const MAX_RANGE_DAYS = 1830

const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)

/**
 * The dates a preset covers, relative to `today` (YYYY-MM-DD, South African). "Last 3 months" and
 * "Last 12 months" are whole calendar months ending with the current one, so their charts never
 * start part-way through a month.
 */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): ReportRange {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) - 1
  switch (preset) {
    case 'this-month':
      return { from: iso(y, m, 1), to: today }
    case 'last-month':
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) }
    case 'last-3-months':
      return { from: iso(y, m - 2, 1), to: today }
    case 'last-12-months':
      return { from: iso(y, m - 11, 1), to: today }
    case 'this-year':
      return { from: iso(y, 0, 1), to: today }
    case 'last-year':
      return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) }
  }
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000

/** Why a custom period cannot be used, or null when it is fine. */
export function rangeProblem(from: string, to: string, today: string): string | null {
  if (!isRealDate(from) || !isRealDate(to)) return 'Enter a start and an end date.'
  if (from > to) return 'The start date must be on or before the end date.'
  if (from > today) return 'The period cannot start in the future.'
  if (days(from, to) > MAX_RANGE_DAYS) return 'Choose a period of five years or less.'
  return null
}

/** The period in the address (?range=…&from=…&to=…), falling back to the default preset. */
export function readRange(
  params: URLSearchParams,
  today: string,
): {
  preset: RangePreset
  range: ReportRange
  problem: string | null
  /** The dates as typed, so a refused custom period can be corrected rather than retyped. */
  entered: ReportRange
} {
  const raw = params.get('range')
  const preset = (RANGE_PRESETS.some((p) => p.value === raw) ? raw : DEFAULT_PRESET) as RangePreset
  if (preset !== 'custom') {
    const range = presetRange(preset, today)
    return { preset, range, problem: null, entered: range }
  }
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const problem = rangeProblem(from, to, today)
  return {
    preset,
    range: problem ? presetRange(DEFAULT_PRESET, today) : { from, to },
    problem,
    entered: { from, to },
  }
}

/** "1 Mar 2024 – 31 Mar 2024", or a single date. */
export const rangeLabel = (r: ReportRange) =>
  r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`

/** The same length of time just before (for "vs previous period"). */
export function priorRange(r: ReportRange): ReportRange {
  const length = days(r.from, r.to) + 1
  const shift = (d: string, n: number) =>
    new Date(Date.parse(d) - n * 86_400_000).toISOString().slice(0, 10)
  return { from: shift(r.from, length), to: shift(r.from, 1) }
}
