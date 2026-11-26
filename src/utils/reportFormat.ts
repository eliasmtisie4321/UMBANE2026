import { formatDelta, formatNumber, percentChange } from './format'

/** "318 (25.5%)" */
export const countShare = (n: number, total: number) =>
  total > 0 ? `${formatNumber(n)} (${Math.round((n / total) * 1000) / 10}%)` : formatNumber(n)

/** "25.5%", or "-" when there is nothing to divide by. */
export const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '-'

/** "+14.2% on the previous period", or a plain note when there is nothing to compare with. */
export function versus(current: number, previous: number, what = 'the previous period'): string {
  const pct = percentChange(current, previous)
  if (pct === null) return current > 0 ? `Nothing in ${what}` : `Same as ${what}`
  return `${formatDelta(pct)} on ${what}`
}

/** "2.5 hours", "1.5 days", or "-" when unknown. */
export function duration(hours: number | null): string {
  if (hours === null) return '-'
  if (hours < 48) return `${Math.round(hours * 10) / 10} hours`
  return `${Math.round((hours / 24) * 10) / 10} days`
}

/** The label of a stored value, or "Not recorded" for an empty one. */
export const keyLabel = (
  list: readonly { value: string; label: string }[],
  key: string | null | undefined,
) => (key ? (list.find((i) => i.value === key)?.label ?? key) : 'Not recorded')

/** kWh with no decimals for big totals: "1,842,640 kWh". */
export const kwh = (value: number) =>
  `${value.toLocaleString('en-US', { maximumFractionDigits: value >= 100 ? 0 : 1 })} kWh`

/** Short kWh for chart axes: "1.5K", "2M". */
export { formatCompact as kwhAxis } from './format'

/** A filter value from the address, if it is one of the options (or "none" where allowed). */
export const pickOption = (
  value: string,
  list: readonly { value: string }[],
  allowNone = false,
): string => ((allowNone && value === 'none') || list.some((o) => o.value === value) ? value : '')

/** "Segment: Commercial" for the PDF and the period line, or nothing when the filter is off. */
export const filterNote = (
  label: string,
  value: string,
  list: readonly { value: string; label: string }[],
): string[] => (value ? [`${label}: ${keyLabel(list, value === 'none' ? null : value)}`] : [])
