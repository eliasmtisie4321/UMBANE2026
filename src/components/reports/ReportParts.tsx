import { useState, type ReactNode } from 'react'
import { EmptyNotice, Panel } from '@/components/dashboard/Panel'
import { Pagination } from '@/components/data/Pagination'
import { Select, Table, Td, Th } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import type { CsvValue } from '@/utils/csv'
import { formatNumber } from '@/utils/format'

// Figures --------------------------------------------------------------------------------------------
export interface Figure {
  label: string
  value: string
  /** Plain text under the value, so meaning never rests on colour alone. */
  detail?: string
  tone?: 'neutral' | 'warning' | 'error'
}

const toneClass = {
  neutral: 'text-on-surface-variant',
  warning: 'text-on-tertiary-container',
  error: 'text-error',
}

export function FigureGrid({ figures, label }: { figures: Figure[]; label: string }) {
  return (
    <section
      aria-label={label}
      className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {figures.map((f) => (
        <div
          key={f.label}
          className="rounded-lg border border-outline-variant bg-surface p-5 shadow-card"
        >
          <h2 className="text-label-md font-medium text-on-surface-variant">{f.label}</h2>
          <p className="mt-2 text-headline-md font-bold text-on-surface tabular-nums">{f.value}</p>
          {f.detail && (
            <p className={cn('mt-1 text-label-md', toneClass[f.tone ?? 'neutral'])}>{f.detail}</p>
          )}
        </div>
      ))}
    </section>
  )
}

// Ranked bars -------------------------------------------------------------------------------------
export interface BarItem {
  label: string
  value: number
  /** The value as people read it, e.g. "R 12,400" or "318 (25.5%)". */
  display: string
}

/** At most this many bars; the rest are added together as "Other". */
const MAX_BARS = 8

/**
 * A ranked list with a bar under each label: one hue, because the bars show size, not identity.
 * The text carries the numbers; the bars are decoration for sighted readers.
 */
export function BarList({
  items,
  formatOther,
  empty = 'Nothing in this period.',
}: {
  items: BarItem[]
  formatOther?: (value: number, count: number) => string
  empty?: string
}) {
  if (items.length === 0 || items.every((i) => i.value === 0))
    return <EmptyNotice>{empty}</EmptyNotice>
  let shown = items
  if (items.length > MAX_BARS) {
    const rest = items.slice(MAX_BARS - 1)
    const sum = rest.reduce((n, i) => n + i.value, 0)
    shown = [
      ...items.slice(0, MAX_BARS - 1),
      {
        label: `Other (${rest.length})`,
        value: sum,
        display: formatOther ? formatOther(sum, rest.length) : formatNumber(sum),
      },
    ]
  }
  const max = Math.max(...shown.map((i) => i.value), 1)
  return (
    <ul className="flex flex-col gap-3">
      {shown.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-body-md">
            <span className="min-w-0 truncate text-on-surface">{i.label}</span>
            <span className="shrink-0 font-semibold text-on-surface tabular-nums">{i.display}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-container-high" aria-hidden="true">
            <div
              className="h-2 rounded-full bg-chart-1"
              style={{ width: `${Math.max(0, (i.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// A panel whose chart can be swapped for a table ---------------------------------------------------
export function ChartPanel({
  title,
  subtitle,
  className,
  children,
}: {
  title: string
  subtitle?: string
  className?: string
  children: (asTable: boolean) => ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      className={className}
      action={
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="shrink-0 rounded-md px-2 py-1 text-label-md font-medium text-secondary hover:bg-surface-container"
        >
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      }
    >
      {children(asTable)}
    </Panel>
  )
}

// Detail table ------------------------------------------------------------------------------------
export interface ReportColumn<R> {
  label: string
  align?: 'right'
  /** Relative width in the PDF. */
  weight?: number
  /** The text shown on screen and in the PDF. */
  text: (row: R) => string
  /** What the CSV holds: raw numbers and ISO dates, so spreadsheets can sum and sort them. */
  csv: (row: R) => CsvValue
  /** Screen-only content, e.g. a link. Defaults to `text`. */
  cell?: (row: R) => ReactNode
}

const PAGE = 25

export function ReportTable<R extends { id?: string | null }>({
  title,
  subtitle,
  columns,
  rows,
  rowCount,
  empty,
}: {
  title: string
  subtitle?: string
  columns: ReportColumn<R>[]
  rows: R[]
  /** Rows that matched; more than `rows.length` only beyond the 5,000-row limit. */
  rowCount: number
  empty: string
}) {
  const [page, setPage] = useState(1)
  const shown = rows.slice((page - 1) * PAGE, page * PAGE)
  return (
    <Panel title={title} subtitle={subtitle} className="mt-6">
      {rows.length === 0 ? (
        <EmptyNotice>{empty}</EmptyNotice>
      ) : (
        <>
          <Table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th key={c.label} className={c.align === 'right' ? 'text-right' : undefined}>
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id ?? i}>
                  {columns.map((c) => (
                    <Td
                      key={c.label}
                      className={cn(
                        c.align === 'right' && 'text-right',
                        // Wide columns (names, addresses, subjects) wrap; codes, dates and amounts stay on one line.
                        (c.weight ?? 1) >= 1.5 ? 'min-w-40' : 'whitespace-nowrap',
                      )}
                    >
                      {c.cell ? c.cell(r) : c.text(r)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length > PAGE && (
            <Pagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} />
          )}
          {rowCount > rows.length && (
            <p className="mt-2 text-label-md text-on-surface-variant">
              The first {formatNumber(rows.length)} of {formatNumber(rowCount)} are listed. Choose a
              shorter period to see the rest.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

// Filters -----------------------------------------------------------------------------------------
/** A category filter. "All" clears it; "Not recorded" finds records with the category left empty. */
export function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
  allowNone = false,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
  allowNone?: boolean
}) {
  return (
    <div className="w-48">
      <Select
        id={id}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: 'All' },
          ...options,
          ...(allowNone ? [{ value: 'none', label: 'Not recorded' }] : []),
        ]}
      />
    </div>
  )
}
