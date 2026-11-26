import { Link } from 'react-router-dom'
import { Panel } from '@/components/dashboard/Panel'
import { inlineLink } from '@/components/data/linkStyles'
import { MonthBars } from '@/components/reports/MonthBars'
import { ReportFrame } from '@/components/reports/ReportFrame'
import {
  BarList,
  ChartPanel,
  FigureGrid,
  ReportTable,
  type ReportColumn,
} from '@/components/reports/ReportParts'
import { useReportParams } from '@/hooks/useReportParams'
import { useResource } from '@/hooks/useResource'
import { getSalesReport } from '@/services/reports'
import { DISPLAY_STATUSES, PAYMENT_METHOD_CODES } from '@/types/invoices'
import type { InvoiceReportRow, SalesReport } from '@/types/reports'
import { ORDER_STATUSES } from '@/types/sales'
import { formatDate, formatNumber, formatRand, formatRandCompact, monthLabel } from '@/utils/format'
import { countShare, keyLabel, percent, versus } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const COLUMNS: ReportColumn<InvoiceReportRow>[] = [
  {
    label: 'Invoice',
    weight: 1.3,
    text: (r) => r.invoiceNumber,
    csv: (r) => r.invoiceNumber,
    cell: (r) => (
      <Link to={`/invoices/${r.id}`} className={inlineLink}>
        {r.invoiceNumber}
      </Link>
    ),
  },
  { label: 'Order', text: (r) => r.orderReference ?? '-', csv: (r) => r.orderReference ?? '' },
  { label: 'Customer', weight: 2, text: (r) => r.customerName, csv: (r) => r.customerName },
  { label: 'Issued', text: (r) => formatDate(r.issueDate), csv: (r) => r.issueDate },
  {
    label: 'Due',
    text: (r) => (r.dueDate ? formatDate(r.dueDate) : '-'),
    csv: (r) => r.dueDate ?? '',
  },
  {
    label: 'Total',
    align: 'right',
    text: (r) => formatRand(r.total, { cents: true }),
    csv: (r) => r.total,
  },
  {
    label: 'Paid',
    align: 'right',
    text: (r) => formatRand(r.paid, { cents: true }),
    csv: (r) => r.paid,
  },
  {
    label: 'Balance',
    align: 'right',
    text: (r) => formatRand(r.balance, { cents: true }),
    csv: (r) => r.balance,
  },
  { label: 'Status', text: (r) => keyLabel(DISPLAY_STATUSES, r.status), csv: (r) => r.status },
  {
    label: 'Last payment',
    weight: 1.2,
    text: (r) =>
      r.method
        ? `${keyLabel(PAYMENT_METHOD_CODES, r.method)}${r.lastPaidOn ? `, ${formatDate(r.lastPaidOn)}` : ''}`
        : '-',
    csv: (r) => r.method ?? '',
  },
]

function figures(r: SalesReport) {
  return [
    {
      label: 'Orders',
      value: formatRand(r.orderValue),
      detail: `${formatNumber(r.orders)} orders · ${versus(r.orderValue, r.orderValuePrior)}`,
    },
    {
      label: 'Invoiced',
      value: formatRand(r.invoiced),
      detail: `${formatNumber(r.invoices)} invoices issued`,
    },
    {
      label: 'Paid invoices',
      value: formatNumber(r.paidCount),
      detail: `${formatRand(r.paidAmount)} · ${r.avgSettlementDays === null ? 'no settlements yet' : `paid in ${r.avgSettlementDays} days on average`}`,
    },
    {
      label: 'Overdue',
      value: formatNumber(r.overdueCount),
      detail: `${formatRand(r.overdueBalance)} past due · ${formatRand(r.outstanding)} still to collect`,
      tone: r.overdueCount > 0 ? ('error' as const) : undefined,
    },
  ]
}

const invoiceSlices = (r: SalesReport) => [
  { label: 'Paid', value: r.paidCount, display: countShare(r.paidCount, r.invoices) },
  {
    label: 'Unpaid, within terms',
    value: r.unpaidCount,
    display: countShare(r.unpaidCount, r.invoices),
  },
  { label: 'Overdue', value: r.overdueCount, display: countShare(r.overdueCount, r.invoices) },
]

function sections(r: SalesReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [
        { label: 'Month' },
        { label: 'Orders', align: 'right' },
        { label: 'Order value', align: 'right' },
        { label: 'Invoiced', align: 'right' },
        { label: 'Collected', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.orders),
        formatRand(m.orderValue),
        formatRand(m.invoiced),
        formatRand(m.collected),
      ]),
    },
    {
      kind: 'table',
      heading: 'Orders by status',
      columns: [
        { label: 'Status', weight: 2 },
        { label: 'Orders', align: 'right' },
        { label: 'Value', align: 'right' },
      ],
      rows: r.ordersByStatus.map((s) => [
        keyLabel(ORDER_STATUSES, s.key),
        formatNumber(s.count),
        formatRand(s.value),
      ]),
    },
    {
      kind: 'table',
      heading: 'Invoice status',
      columns: [
        { label: 'Status', weight: 2 },
        { label: 'Invoices', align: 'right' },
      ],
      rows: invoiceSlices(r).map((s) => [s.label, s.display]),
    },
    {
      kind: 'table',
      heading: 'Top items ordered',
      columns: [
        { label: 'Item', weight: 3 },
        { label: 'Quantity', align: 'right' },
        { label: 'Value', align: 'right' },
      ],
      rows: r.topItems.map((i) => [i.name, formatNumber(i.quantity), formatRand(i.value)]),
    },
    {
      kind: 'table',
      heading: 'Invoices issued',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function SalesReportScreen() {
  const p = useReportParams()
  const state = useResource(() => getSalesReport(p.range), JSON.stringify(p.range))
  return (
    <ReportFrame
      title="Sales and invoice report"
      subtitle="Orders placed, invoices issued in the period, and how much of them is paid. Cancelled orders and draft or cancelled invoices are left out."
      params={p}
      state={state}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Invoiced and collected"
              subtitle="By month, in rand"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({
                    month: m.month,
                    values: [m.invoiced, m.collected],
                  }))}
                  series={[{ name: 'Invoiced' }, { name: 'Collected' }]}
                  caption="Invoiced and collected by month"
                  format={(v) => formatRand(v)}
                  formatAxis={formatRandCompact}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel
              title="Invoice status"
              subtitle={`${formatNumber(r.invoices)} issued in the period, status now`}
            >
              <BarList items={invoiceSlices(r)} empty="No invoices were issued in this period." />
              <p className="mt-4 text-label-md text-on-surface-variant">
                {percent(r.paidAmount, r.invoiced)} of the amount invoiced is fully paid.
              </p>
            </Panel>
            <ChartPanel
              title="Orders"
              subtitle="Order value by month, in rand"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.orderValue] }))}
                  series={[{ name: 'Order value' }]}
                  caption="Order value by month"
                  format={(v) => formatRand(v)}
                  formatAxis={formatRandCompact}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="Top items ordered" subtitle="By value">
              <BarList
                items={r.topItems.map((i) => ({
                  label: `${i.name} (${formatNumber(i.quantity)})`,
                  value: i.value,
                  display: formatRand(i.value),
                }))}
                empty="No orders in this period."
              />
              <h3 className="mb-3 mt-6 text-label-md font-semibold text-on-surface-variant">
                Orders by status
              </h3>
              <BarList
                items={r.ordersByStatus.map((s) => ({
                  label: keyLabel(ORDER_STATUSES, s.key),
                  value: s.count,
                  display: `${formatNumber(s.count)} · ${formatRand(s.value)}`,
                }))}
                empty="No orders in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Invoices issued"
            subtitle="Newest first."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No invoices were issued in this period."
          />
        </>
      )}
    </ReportFrame>
  )
}
