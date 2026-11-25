export type Period = '' | 'this-month' | 'last-month' | 'this-year'

export const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '', label: 'All dates' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-year', label: 'This year' },
]

const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)

/** Inclusive first and last day of a period, relative to `today` (YYYY-MM-DD). Empty = no bound. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  switch (period) {
    case 'this-month':
      return { from: iso(year, month, 1), to: iso(year, month + 1, 0) }
    case 'last-month':
      return { from: iso(year, month - 1, 1), to: iso(year, month, 0) }
    case 'this-year':
      return { from: iso(year, 0, 1), to: iso(year, 11, 31) }
    default:
      return { from: '', to: '' }
  }
}
