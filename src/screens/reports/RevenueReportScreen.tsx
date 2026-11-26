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
import { getRevenueReport } from '@/services/reports'
import { SEGMENTS } from '@/types/customers'
import { PAYMENT_METHOD_CODES } from '@/types/invoices'
import type { PaymentReportRow, RevenueReport } from '@/types/reports'
import { formatDate, formatNumber, formatRand, formatRandCompact, monthLabel } from '@/utils/format'
import { filterNote, keyLabel, percent, pickOption, versus } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const COLUMNS: ReportColumn<PaymentReportRow>[] = [
  { label: 'Payment', text: (r) => r.referenceNumber, csv: (r) => r.referenceNumber },
  { label: 'Date', text: (r) => formatDate(r.paidOn), csv: (r) => r.paidOn },
  { label: 'Customer', weight: 2, text: (r) => r.customerName, csv: (r) => r.customerName },
  {
    label: 'Invoice',
    weight: 1.3,
    text: (r) => r.invoiceNumber,
    csv: (r) => r.invoiceNumber,
    cell: (r) => (
      <Link to={`/invoices/${r.invoiceId}`} className={inlineLink}>
        {r.invoiceNumber}
      </Link>
    ),
  },
  {
    label: 'Method',
    weight: 1.2,
    text: (r) => keyLabel(PAYMENT_METHOD_CODES, r.method),
    csv: (r) => r.method,
  },
  {
    label: 'Reference',
    weight: 1.3,
    text: (r) => r.reference ?? '-',
    csv: (r) => r.reference ?? '',
  },
  {
    label: 'Amount',
    align: 'right',
    text: (r) => formatRand(r.amount, { cents: true }),
    csv: (r) => r.amount,
  },
  {
    label: 'Recorded by',
    weight: 1.3,
    text: (r) => r.recordedByName ?? '-',
    csv: (r) => r.recordedByName ?? '',
  },
]

function figures(r: RevenueReport) {
  return [
    {
      label: 'Payments received',
      value: formatRand(r.collected),
      detail: `${formatNumber(r.payments)} payments · ${versus(r.collected, r.collectedPrior)}`,
    },
    {
      label: 'Received this year',
      value: formatRand(r.collectedYear),
      detail: 'From 1 January to the end of the period',
    },
    {
      label: 'Invoiced in the period',
      value: formatRand(r.invoiced),
      detail: `Received is ${percent(r.collected, r.invoiced)} of invoiced`,
    },
    {
      label: 'Outstanding now',
      value: formatRand(r.outstanding),
      detail: `${formatNumber(r.outstandingCount)} invoices with a balance`,
      tone: r.outstanding > 0 ? ('warning' as const) : undefined,
    },
  ]
}

function sections(r: RevenueReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [
        { label: 'Month' },
        { label: 'Received', align: 'right' },
        { label: 'Invoiced', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatRand(m.collected, { cents: true }),
        formatRand(m.invoiced, { cents: true }),
      ]),
    },
    {
      kind: 'table',
      heading: 'By payment method',
      columns: [
        { label: 'Method', weight: 2 },
        { label: 'Payments', align: 'right' },
        { label: 'Amount', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: r.byMethod.map((m) => [
        keyLabel(PAYMENT_METHOD_CODES, m.key),
        formatNumber(m.count),
        formatRand(m.amount, { cents: true }),
        percent(m.amount, r.collected),
      ]),
    },
    {
      kind: 'table',
      heading: 'By customer segment',
      columns: [
        { label: 'Segment', weight: 2 },
        { label: 'Payments', align: 'right' },
        { label: 'Amount', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: r.bySegment.map((m) => [
        keyLabel(SEGMENTS, m.key),
        formatNumber(m.count),
        formatRand(m.amount, { cents: true }),
        percent(m.amount, r.collected),
      ]),
    },
    {
      kind: 'table',
      heading: 'Payments',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function RevenueReportScreen() {
  const p = useReportParams()
  const method = pickOption(p.filter('method'), PAYMENT_METHOD_CODES)
  const state = useResource(
    () => getRevenueReport(p.range, { method }),
    JSON.stringify([p.range, method]),
  )
  return (
    <ReportFrame
      title="Revenue report"
      subtitle="Money received: every payment recorded against an invoice in the period."
      params={p}
      state={state}
      filters={
        <FilterSelect
          id="method"
          label="Payment method"
          value={method}
          options={PAYMENT_METHOD_CODES}
          onChange={(v) => p.update({ method: v })}
        />
      }
      filterSummary={filterNote('Payment method', method, PAYMENT_METHOD_CODES)}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Received and invoiced"
              subtitle="By month, in rand"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({
                    month: m.month,
                    values: [m.collected, m.invoiced],
                  }))}
                  series={[{ name: 'Received' }, { name: 'Invoiced' }]}
                  caption="Payments received and amounts invoiced by month"
                  format={(v) => formatRand(v)}
                  formatAxis={formatRandCompact}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By payment method">
              <BarList
                items={r.byMethod.map((m) => ({
                  label: keyLabel(PAYMENT_METHOD_CODES, m.key),
                  value: m.amount,
                  display: `${formatRand(m.amount)} (${percent(m.amount, r.collected)})`,
                }))}
                formatOther={(v) => formatRand(v)}
                empty="No payments in this period."
              />
            </Panel>
            <Panel title="Top customers" subtitle="By payments received" className="xl:col-span-2">
              <BarList
                items={r.topCustomers.map((c) => ({
                  label: c.name,
                  value: c.amount,
                  display: formatRand(c.amount),
                }))}
                empty="No payments in this period."
              />
            </Panel>
            <Panel title="By customer segment">
              <BarList
                items={r.bySegment.map((m) => ({
                  label: keyLabel(SEGMENTS, m.key),
                  value: m.amount,
                  display: `${formatRand(m.amount)} (${percent(m.amount, r.collected)})`,
                }))}
                empty="No payments in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Payments"
            subtitle="Newest first."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No payments were received in this period."
          />
        </>
      )}
    </ReportFrame>
  )
}
