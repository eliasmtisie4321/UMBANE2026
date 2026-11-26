import { Link } from 'react-router-dom'
import { Panel } from '@/components/dashboard/Panel'
import { inlineLink } from '@/components/data/linkStyles'
import { MonthBars } from '@/components/reports/MonthBars'
import { ReportFrame } from '@/components/reports/ReportFrame'
import {
  BarList,
  ChartPanel,
  FigureGrid,
  FilterSelect,
  ReportTable,
  type ReportColumn,
} from '@/components/reports/ReportParts'
import { useReportParams } from '@/hooks/useReportParams'
import { useResource } from '@/hooks/useResource'
import { getCustomerReport } from '@/services/reports'
import { CUSTOMER_STATUSES, PROVINCES, SEGMENTS } from '@/types/customers'
import type { CustomerReport, CustomerRow } from '@/types/reports'
import { formatDate, formatNumber, formatRand, monthLabel } from '@/utils/format'
import { countShare, filterNote, keyLabel, percent, pickOption } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: p }))
const TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'business', label: 'Business' },
]

const COLUMNS: ReportColumn<CustomerRow>[] = [
  {
    label: 'Customer',
    weight: 2.2,
    text: (r) => r.name,
    csv: (r) => r.name,
    cell: (r) => (
      <Link to={`/customers/${r.id}`} className={inlineLink}>
        {r.name}
      </Link>
    ),
  },
  {
    label: 'Segment',
    text: (r) => keyLabel(SEGMENTS, r.segment),
    csv: (r) => keyLabel(SEGMENTS, r.segment),
  },
  {
    label: 'Province',
    weight: 1.2,
    text: (r) => r.province ?? 'Not recorded',
    csv: (r) => r.province ?? '',
  },
  {
    label: 'Properties',
    align: 'right',
    weight: 0.8,
    text: (r) => formatNumber(r.properties),
    csv: (r) => r.properties,
  },
  {
    label: 'Meters',
    align: 'right',
    weight: 0.7,
    text: (r) => formatNumber(r.meters),
    csv: (r) => r.meters,
  },
  { label: 'Billed', align: 'right', text: (r) => formatRand(r.billed), csv: (r) => r.billed },
  { label: 'Paid', align: 'right', text: (r) => formatRand(r.paid), csv: (r) => r.paid },
  {
    label: 'Balance now',
    align: 'right',
    text: (r) => formatRand(r.balance),
    csv: (r) => r.balance,
  },
  {
    label: 'Last activity',
    text: (r) => (r.lastActivity ? formatDate(r.lastActivity) : '-'),
    csv: (r) => r.lastActivity ?? '',
  },
  {
    label: 'Status',
    weight: 0.8,
    text: (r) => keyLabel(CUSTOMER_STATUSES, r.status),
    csv: (r) => r.status,
  },
  { label: 'Registered', text: (r) => formatDate(r.createdOn), csv: (r) => r.createdOn },
]

const slices = (
  list: CustomerReport['bySegment'],
  total: number,
  labels: readonly { value: string; label: string }[],
) =>
  list.map((s) => ({
    label: keyLabel(labels, s.key),
    value: s.count,
    display: countShare(s.count, total),
  }))

function figures(r: CustomerReport) {
  const active = r.byStatus.active ?? 0
  return [
    {
      label: 'Customers',
      value: formatNumber(r.total),
      detail: 'Registered by the end of the period',
    },
    { label: 'New customers', value: formatNumber(r.new), detail: 'Registered in the period' },
    {
      label: 'Active',
      value: formatNumber(active),
      detail: `${percent(active, r.total)} of customers, status now`,
    },
    {
      label: 'Inactive or pending',
      value: formatNumber((r.byStatus.inactive ?? 0) + (r.byStatus.pending ?? 0)),
      detail: `${formatNumber(r.byStatus.inactive ?? 0)} inactive · ${formatNumber(r.byStatus.pending ?? 0)} pending`,
    },
  ]
}

function sections(r: CustomerReport): ReportSection[] {
  const breakdown = (heading: string, list: { label: string; display: string }[]) => ({
    kind: 'table' as const,
    heading,
    columns: [
      { label: heading.replace('By ', ''), weight: 2 },
      { label: 'Customers', align: 'right' as const },
    ],
    rows: list.map((i) => [i.label, i.display]),
  })
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [
        { label: 'Month' },
        { label: 'New', align: 'right' },
        { label: 'Customers at month end', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.new),
        formatNumber(m.total),
      ]),
    },
    breakdown('By province', slices(r.byProvince, r.total, PROVINCE_OPTIONS)),
    breakdown('By segment', slices(r.bySegment, r.total, SEGMENTS)),
    {
      kind: 'table',
      heading: 'Customers',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
      note: `Billed and paid are for the period: ${formatRand(r.billed)} billed, ${formatRand(r.paid)} paid.`,
    },
  ]
}

export default function CustomerReportScreen() {
  const p = useReportParams()
  const segment = pickOption(p.filter('segment'), SEGMENTS, true)
  const province = pickOption(p.filter('province'), PROVINCE_OPTIONS, true)
  const state = useResource(
    () => getCustomerReport(p.range, { segment, province }),
    JSON.stringify([p.range, segment, province]),
  )
  return (
    <ReportFrame
      title="Customer report"
      subtitle="Customer growth, where customers are, and what each was billed and paid."
      params={p}
      state={state}
      filters={
        <>
          <FilterSelect
            id="segment"
            label="Segment"
            value={segment}
            options={SEGMENTS}
            allowNone
            onChange={(v) => p.update({ segment: v })}
          />
          <FilterSelect
            id="province"
            label="Province"
            value={province}
            options={PROVINCE_OPTIONS}
            allowNone
            onChange={(v) => p.update({ province: v })}
          />
        </>
      }
      filterSummary={[
        ...filterNote('Segment', segment, SEGMENTS),
        ...filterNote('Province', province, PROVINCE_OPTIONS),
      ]}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Customer growth"
              subtitle="Customers at the end of each month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.total] }))}
                  series={[{ name: 'Customers' }]}
                  caption="Customers at the end of each month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By province">
              <BarList
                items={slices(r.byProvince, r.total, PROVINCE_OPTIONS)}
                empty="No customers in this period."
              />
            </Panel>
            <ChartPanel
              title="New customers"
              subtitle="Registered each month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.new] }))}
                  series={[{ name: 'New customers' }]}
                  caption="New customers by month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By segment">
              <BarList
                items={slices(r.bySegment, r.total, SEGMENTS)}
                empty="No customers in this period."
              />
              <h3 className="mb-3 mt-6 text-label-md font-semibold text-on-surface-variant">
                By type
              </h3>
              <BarList
                items={slices(r.byType, r.total, TYPES)}
                empty="No customers in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Customers"
            subtitle={`Biggest billing first. Billed ${formatRand(r.billed)} and paid ${formatRand(r.paid)} in the period.`}
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No customers match this period and these filters."
          />
        </>
      )}
    </ReportFrame>
  )
}
