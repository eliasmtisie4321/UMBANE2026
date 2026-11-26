import {
  ArrowRight,
  Boxes,
  Building2,
  Headset,
  Receipt,
  ShoppingCart,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { MonthBars } from '@/components/reports/MonthBars'
import { ReportFrame } from '@/components/reports/ReportFrame'
import { ChartPanel, FigureGrid } from '@/components/reports/ReportParts'
import { useReportParams } from '@/hooks/useReportParams'
import { useResource } from '@/hooks/useResource'
import { getOverviewReport } from '@/services/reports'
import type { OverviewMonth, OverviewReport } from '@/types/reports'
import { formatNumber, formatRand, formatRandCompact, monthLabel } from '@/utils/format'
import { kwh, kwhAxis, percent, versus } from '@/utils/reportFormat'

interface Card {
  to: string
  title: string
  description: string
  icon: LucideIcon
  figure: (o: OverviewReport) => string
}

const CARDS: Card[] = [
  {
    to: '/reports/revenue',
    title: 'Revenue',
    description: 'Payments received by month, by payment method and by customer.',
    icon: Receipt,
    figure: (o) => `${formatRand(o.collected)} received`,
  },
  {
    to: '/reports/sales',
    title: 'Sales and invoices',
    description: 'Orders, invoices issued, what is paid, unpaid and overdue.',
    icon: ShoppingCart,
    figure: (o) => `${formatNumber(o.orders)} orders · ${formatRand(o.orderValue)}`,
  },
  {
    to: '/reports/customers',
    title: 'Customers',
    description: 'Growth, registrations, province and segment, and billing per customer.',
    icon: Users,
    figure: (o) => `${formatNumber(o.customers)} customers · ${formatNumber(o.newCustomers)} new`,
  },
  {
    to: '/reports/properties',
    title: 'Properties',
    description: 'Properties by type, province and status, with meters and electricity use.',
    icon: Building2,
    figure: (o) => `${formatNumber(o.properties)} properties`,
  },
  {
    to: '/reports/electricity',
    title: 'Electricity consumption',
    description: 'kWh used by month, property, meter and meter type, and every reading.',
    icon: Zap,
    figure: (o) => kwh(o.kwh),
  },
  {
    to: '/reports/inventory',
    title: 'Inventory',
    description: 'Stock value, low and out-of-stock items, and fast and slow movers.',
    icon: Boxes,
    figure: (o) => `${formatNumber(o.products)} products · ${formatRand(o.stockValue)}`,
  },
  {
    to: '/reports/support',
    title: 'Support tickets',
    description: 'Tickets opened and resolved, response times, categories and priorities.',
    icon: Headset,
    figure: (o) =>
      `${formatNumber(o.ticketsOpened)} opened · ${formatNumber(o.ticketsResolved)} resolved`,
  },
  {
    to: '/reports/team',
    title: 'Team performance',
    description: 'Tasks given and finished, on-time rate and workload per person and department.',
    icon: UsersRound,
    figure: (o) => `${formatNumber(o.tasksCompleted)} tasks finished`,
  },
]

const monthRows = (o: OverviewReport) => o.months

export default function ReportsScreen() {
  const p = useReportParams()
  const { search } = useLocation()
  const state = useResource(() => getOverviewReport(p.range), JSON.stringify(p.range))

  return (
    <ReportFrame<OverviewReport, OverviewMonth>
      title="Reports"
      subtitle="How the business is doing over the period you choose. Open a report for the detail."
      params={p}
      state={state}
      isHub
      exports={{
        columns: [
          { label: 'Month', text: (m) => monthLabel(m.month, 'long'), csv: (m) => m.month },
          {
            label: 'Payments received (R)',
            align: 'right',
            text: (m) => formatRand(m.collected, { cents: true }),
            csv: (m) => m.collected,
          },
          {
            label: 'Electricity used (kWh)',
            align: 'right',
            text: (m) => kwh(m.kwh),
            csv: (m) => m.kwh,
          },
        ],
        rows: monthRows,
        sections: (o) => [
          {
            kind: 'figures',
            heading: 'Summary',
            items: figures(o).map(({ label, value, detail }) => ({ label, value, detail })),
          },
          {
            kind: 'table',
            heading: 'By month',
            columns: [
              { label: 'Month' },
              { label: 'Payments received', align: 'right' },
              { label: 'Electricity used', align: 'right' },
            ],
            rows: o.months.map((m) => [
              monthLabel(m.month, 'long'),
              formatRand(m.collected, { cents: true }),
              kwh(m.kwh),
            ]),
          },
          {
            kind: 'table',
            heading: 'Reports',
            columns: [{ label: 'Report' }, { label: 'This period', weight: 2 }],
            rows: CARDS.map((c) => [c.title, c.figure(o)]),
          },
        ],
      }}
    >
      {(o) => (
        <>
          <FigureGrid label="Summary" figures={figures(o)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartPanel title="Payments received" subtitle="By month, in rand">
              {(asTable) => (
                <MonthBars
                  points={o.months.map((m) => ({ month: m.month, values: [m.collected] }))}
                  series={[{ name: 'Payments received' }]}
                  caption="Payments received by month"
                  format={(v) => formatRand(v)}
                  formatAxis={formatRandCompact}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <ChartPanel title="Electricity used" subtitle="By month, in kWh">
              {(asTable) => (
                <MonthBars
                  points={o.months.map((m) => ({ month: m.month, values: [m.kwh] }))}
                  series={[{ name: 'Electricity used' }]}
                  caption="Electricity used by month"
                  format={kwh}
                  formatAxis={kwhAxis}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
          </div>
          <h2 className="mb-3 mt-8 text-title-lg font-semibold text-on-surface">All reports</h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {CARDS.map((c) => (
              <li key={c.to}>
                <Link
                  to={`${c.to}${search}`}
                  className="flex h-full flex-col rounded-lg border border-outline-variant bg-surface p-5 shadow-card transition-colors hover:border-primary"
                >
                  <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary-container text-primary">
                    <c.icon size={18} aria-hidden="true" />
                  </span>
                  <span className="text-title-md font-semibold text-on-surface">{c.title}</span>
                  <span className="mt-1 flex-1 text-body-md text-on-surface-variant">
                    {c.description}
                  </span>
                  <span className="mt-3 text-label-md font-semibold text-on-surface tabular-nums">
                    {c.figure(o)}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1 text-label-md font-semibold text-secondary">
                    Open report <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </ReportFrame>
  )
}

function figures(o: OverviewReport) {
  return [
    {
      label: 'Payments received',
      value: formatRand(o.collected),
      detail: versus(o.collected, o.collectedPrior),
    },
    {
      label: 'Collection rate',
      value: percent(o.invoicedPaid, o.invoiced),
      detail: `${formatRand(o.invoicedPaid)} of ${formatRand(o.invoiced)} invoiced in the period is paid`,
    },
    {
      label: 'Electricity used',
      value: kwh(o.kwh),
      detail: versus(o.kwh, o.kwhPrior),
    },
    {
      label: 'Customers',
      value: formatNumber(o.customers),
      detail: `${formatNumber(o.newCustomers)} new · ${formatNumber(o.metersInService)} meters in service`,
    },
  ]
}
