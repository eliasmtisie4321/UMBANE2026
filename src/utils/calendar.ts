/**
 * Dates for the calendar, in South African time (UTC+2 all year: no daylight saving), so a day
 * on the calendar is the same day for everyone in the business wherever their browser is.
 */
const OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The South African date (YYYY-MM-DD) of an instant. */
export const saDate = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 10)

/** The South African time (HH:MM, 24-hour) of an instant. */
export const saTime = (iso: string | Date) =>
  new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(11, 16)

/** An instant from a South African date and time. */
export const toInstant = (date: string, time = '00:00') =>
  new Date(`${date}T${time}:00+02:00`).toISOString()

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Monday 0 … Sunday 6. */
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7

export const monthStart = (date: string) => `${date.slice(0, 7)}-01`

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/** The 42 days (six weeks, Monday first) shown for the month of `date`. */
export function monthGrid(date: string): string[] {
  const first = monthStart(date)
  const start = addDays(first, -weekday(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** Every day from `from` up to and including `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

const label = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T12:00:00Z`),
  )

export const monthLabel = (date: string) => label(date, { month: 'long', year: 'numeric' })
export const dayLabel = (date: string) =>
  label(date, { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDayLabel = (date: string) =>
  label(date, { weekday: 'short', day: 'numeric', month: 'short' })

/** Which South African days an item covers (an all-day item ends at midnight, exclusive). */
export function daysOf(item: { startsAt: string; endsAt: string; allDay: boolean }): string[] {
  const first = saDate(item.startsAt)
  const endInstant = new Date(new Date(item.endsAt).getTime() - (item.allDay ? DAY_MS : 1))
  const last = saDate(endInstant)
  return last < first ? [first] : daysBetween(first, last)
}

/** "09:00–10:30", or "All day". */
export function timeRange(item: { startsAt: string; endsAt: string; allDay: boolean }): string {
  if (item.allDay) return 'All day'
  const sameDay = saDate(item.startsAt) === saDate(item.endsAt)
  return sameDay
    ? `${saTime(item.startsAt)}–${saTime(item.endsAt)}`
    : `${shortDayLabel(saDate(item.startsAt))} ${saTime(item.startsAt)} – ${shortDayLabel(saDate(item.endsAt))} ${saTime(item.endsAt)}`
}
