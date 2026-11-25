/** Display helpers. All dates are handled in UTC to match the database views. */

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/** South African rand, whole rands by default: R 1,482,950. */
export function formatRand(value: number, options: { cents?: boolean } = {}): string {
  const digits = options.cents ? 2 : 0
  const body = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${value < 0 ? '-' : ''}R ${body}`
}

const trimZero = (n: number) => n.toFixed(1).replace(/\.0$/, '')

/** Axis-friendly: R0, R900, R1.5K, R2M. */
export function formatRandCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}R${trimZero(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}R${trimZero(abs / 1_000)}K`
  return `${sign}R${Math.round(abs)}`
}

/** Percentage change, or null when there is no previous value to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

export function formatDelta(pct: number): string {
  const rounded = Math.round(Math.abs(pct) * 10) / 10
  if (rounded === 0) return '0%'
  return `${pct > 0 ? '+' : '-'}${rounded}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** First day of the month containing `date`, as YYYY-MM-01 (UTC). */
const monthStart = (year: number, monthIndex: number) => {
  const d = new Date(Date.UTC(year, monthIndex, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
}

/** The last `count` calendar months ending with the current one, oldest first. */
export function monthRange(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) =>
    monthStart(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i)),
  )
}

/** The `count` months immediately before `monthRange(count)`, oldest first. */
export function previousMonthRange(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) =>
    monthStart(now.getUTCFullYear(), now.getUTCMonth() - (2 * count - 1 - i)),
  )
}

/** One value per month; months with no row are zero (the database only returns months with payments). */
export function fillMonths(
  rows: Array<{ month: string; total: number }>,
  months: string[],
): number[] {
  // Accumulate rather than overwrite, so several rows for one month still add up.
  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const key = r.month.slice(0, 7)
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.total))
  }
  return months.map((m) => byMonth.get(m.slice(0, 7)) ?? 0)
}

// Fixed names rather than Intl: locale data varies by browser and ICU version (some abbreviate
// September as "Sept"), which would make chart labels and dates inconsistent between users.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function monthLabel(isoDate: string, style: 'short' | 'long' = 'short'): string {
  const name = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return style === 'short' ? name.slice(0, 3) : `${name} ${isoDate.slice(0, 4)}`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`
}
