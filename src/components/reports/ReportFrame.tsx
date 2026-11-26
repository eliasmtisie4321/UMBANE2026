import { Download, FileText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ErrorNotice, ResourceBoundary } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Select } from '@/components/ui'
import { useAuth } from '@/auth/useAuth'
import type { Resource } from '@/hooks/useResource'
import type { ReportParams } from '@/hooks/useReportParams'
import { getBusinessName } from '@/services/messages'
import { downloadFile, fileSlug, toCsv } from '@/utils/csv'
import { formatDateTime } from '@/utils/format'
import { buildReportPdf, type ReportSection } from '@/utils/reportPdf'
import { RANGE_PRESETS, rangeLabel, rangeProblem, type RangePreset } from '@/utils/reportRange'
import type { ReportColumn } from './ReportParts'

/** What a report exports: its detail table as CSV, and a PDF of figures and tables. */
export interface ReportExport<T, R> {
  columns: ReportColumn<R>[]
  rows: (data: T) => R[]
  sections: (data: T) => ReportSection[]
}

function RangePicker({ p }: { p: ReportParams }) {
  const [from, setFrom] = useState(p.entered.from)
  const [to, setTo] = useState(p.entered.to)
  const [error, setError] = useState<string | null>(null)
  const choose = (preset: RangePreset) => {
    setError(null)
    if (preset === 'custom') {
      // Start from the dates currently shown, so "Custom" is an edit, not a blank form.
      setFrom(p.range.from)
      setTo(p.range.to)
      p.update({ range: 'custom', from: p.range.from, to: p.range.to })
    } else {
      p.update({ range: preset, from: undefined, to: undefined })
    }
  }
  const apply = () => {
    const problem = rangeProblem(from, to, p.today)
    setError(problem)
    if (!problem) p.update({ range: 'custom', from, to })
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <Select
          id="report-range"
          label="Period"
          value={p.preset}
          options={RANGE_PRESETS}
          onChange={(e) => choose(e.target.value as RangePreset)}
        />
      </div>
      {p.preset === 'custom' && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <div className="w-40">
            <Input
              id="report-from"
              label="From"
              type="date"
              value={from}
              max={p.today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              id="report-to"
              label="To"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      )}
      {(error ?? p.problem) && (
        <p role="alert" className="basis-full text-label-md text-error">
          {error ?? `${p.problem} Showing the last 12 months instead.`}
        </p>
      )}
    </div>
  )
}

interface ReportFrameProps<T, R> {
  title: string
  subtitle: string
  params: ReportParams
  state: Resource<T> & { reload: () => void }
  /** Filter controls shown beside the period. */
  filters?: ReactNode
  /** Filters in effect, written on the PDF, e.g. ["Segment: Commercial"]. */
  filterSummary?: string[]
  exports?: ReportExport<T, R>
  /** The reports hub itself has no link back to the hub. */
  isHub?: boolean
  children: (data: T) => ReactNode
}

/**
 * The page around every report: title, period and filters, export buttons, and the loading, error
 * and refresh states. The figures come straight from the database function, and the CSV and PDF
 * are built from the same data the page shows.
 */
export function ReportFrame<T, R>({
  title,
  subtitle,
  params,
  state,
  filters,
  filterSummary = [],
  exports,
  isHub = false,
  children,
}: ReportFrameProps<T, R>) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const name = `${fileSlug(title)}-${params.range.from}-to-${params.range.to}`
  const data = state.data

  const exportCsv = () => {
    if (!exports || data === null) return
    setBusy('csv')
    try {
      downloadFile(
        `${name}.csv`,
        toCsv(
          exports.columns.map((c) => ({ label: c.label, value: c.csv })),
          exports.rows(data),
        ),
        'text/csv;charset=utf-8',
      )
      setExportError(null)
    } catch {
      setExportError('The CSV could not be created. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const exportPdf = async () => {
    if (!exports || data === null) return
    setBusy('pdf')
    setExportError(null)
    try {
      const business = await getBusinessName()
      const bytes = await buildReportPdf({
        title,
        business: business.ok && business.data ? business.data : 'Umbane CRM',
        period: rangeLabel(params.range),
        generated: `Generated ${formatDateTime(new Date().toISOString())}${profile ? ` by ${profile.full_name}` : ''}`,
        filters: filterSummary,
        sections: exports.sections(data),
      })
      downloadFile(`${name}.pdf`, bytes as BlobPart, 'application/pdf')
    } catch {
      setExportError('The PDF could not be created. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        back={isHub ? undefined : { to: '/reports', label: 'Reports' }}
        actions={
          exports && (
            <>
              <Button
                variant="secondary"
                onClick={exportCsv}
                disabled={data === null || busy !== null}
                loading={busy === 'csv'}
              >
                <Download size={16} aria-hidden="true" /> Export CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportPdf()}
                disabled={data === null || busy !== null}
                loading={busy === 'pdf'}
              >
                <FileText size={16} aria-hidden="true" /> Export PDF
              </Button>
            </>
          )
        }
      />
      <div className="mb-6 rounded-lg border border-outline-variant bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <RangePicker
            key={`${params.preset}:${params.range.from}:${params.range.to}`}
            p={params}
          />
          {filters}
        </div>
        <p className="mt-3 text-label-md text-on-surface-variant" aria-live="polite">
          Showing {rangeLabel(params.range)}
          {filterSummary.length > 0 ? ` · ${filterSummary.join(' · ')}` : ''}
        </p>
      </div>
      {exportError && (
        <div className="mb-4">
          <ErrorNotice message={exportError} />
        </div>
      )}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(d) => children(d)}
      </ResourceBoundary>
    </>
  )
}
