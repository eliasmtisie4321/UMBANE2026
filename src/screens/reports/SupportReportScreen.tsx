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
import { getSupportReport } from '@/services/reports'
import type { SupportReport, TicketReportRow } from '@/types/reports'
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '@/types/support'
import { formatDateTime, formatNumber, monthLabel } from '@/utils/format'
import { countShare, duration, filterNote, keyLabel, pickOption } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const COLUMNS: ReportColumn<TicketReportRow>[] = [
  {
    label: 'Ticket',
    weight: 1.3,
    text: (r) => r.reference,
    csv: (r) => r.reference,
    cell: (r) => (
      <Link to={`/support-tickets/${r.id}`} className={inlineLink}>
        {r.reference}
      </Link>
    ),
  },
  { label: 'Subject', weight: 2.4, text: (r) => r.subject, csv: (r) => r.subject },
  { label: 'Customer', weight: 1.6, text: (r) => r.customerName, csv: (r) => r.customerName },
  {
    label: 'Category',
    weight: 1.2,
    text: (r) => keyLabel(TICKET_CATEGORIES, r.category),
    csv: (r) => r.category,
  },
  {
    label: 'Priority',
    weight: 0.8,
    text: (r) => keyLabel(TICKET_PRIORITIES, r.priority),
    csv: (r) => r.priority,
  },
  { label: 'Status', text: (r) => keyLabel(TICKET_STATUSES, r.status), csv: (r) => r.status },
  {
    label: 'Assigned to',
    weight: 1.3,
    text: (r) => r.assigneeName ?? 'Nobody',
    csv: (r) => r.assigneeName ?? '',
  },
  {
    label: 'Opened',
    weight: 1.4,
    text: (r) => formatDateTime(r.createdAt),
    csv: (r) => r.createdAt,
  },
  {
    label: 'First response',
    weight: 1.4,
    text: (r) => (r.firstResponseAt ? formatDateTime(r.firstResponseAt) : '-'),
    csv: (r) => r.firstResponseAt ?? '',
  },
  {
    label: 'Resolved',
    weight: 1.4,
    text: (r) => (r.resolvedAt ? formatDateTime(r.resolvedAt) : '-'),
    csv: (r) => r.resolvedAt ?? '',
  },
]

function figures(r: SupportReport) {
  return [
    {
      label: 'Tickets opened',
      value: formatNumber(r.opened),
      detail: `${formatNumber(r.resolved)} resolved in the period`,
    },
    {
      label: 'First response',
      value: duration(r.avgFirstResponseHours),
      detail: 'Average, for tickets opened in the period',
    },
    {
      label: 'Time to resolve',
      value: duration(r.avgResolutionHours),
      detail: 'Average, for tickets opened and resolved',
    },
    {
      label: 'Open now',
      value: formatNumber(r.openNow),
      detail: `${formatNumber(r.urgentOpen)} urgent · ${formatNumber(r.unassignedOpen)} not assigned`,
      tone: r.urgentOpen > 0 ? ('error' as const) : undefined,
    },
  ]
}

function sections(r: SupportReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [
        { label: 'Month' },
        { label: 'Opened', align: 'right' },
        { label: 'Resolved', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.opened),
        formatNumber(m.resolved),
      ]),
    },
    {
      kind: 'table',
      heading: 'By category',
      columns: [
        { label: 'Category', weight: 2 },
        { label: 'Tickets', align: 'right' },
      ],
      rows: r.byCategory.map((s) => [
        keyLabel(TICKET_CATEGORIES, s.key),
        countShare(s.count, r.opened),
      ]),
    },
    {
      kind: 'table',
      heading: 'By priority',
      columns: [
        { label: 'Priority', weight: 2 },
        { label: 'Tickets', align: 'right' },
      ],
      rows: r.byPriority.map((s) => [
        keyLabel(TICKET_PRIORITIES, s.key),
        countShare(s.count, r.opened),
      ]),
    },
    {
      kind: 'table',
      heading: 'By person',
      columns: [
        { label: 'Assigned to', weight: 2 },
        { label: 'Tickets', align: 'right' },
        { label: 'Resolved', align: 'right' },
        { label: 'Average time to resolve', align: 'right', weight: 1.5 },
      ],
      rows: r.byAssignee.map((a) => [
        a.name ?? 'Not assigned',
        formatNumber(a.tickets),
        formatNumber(a.resolved),
        duration(a.avgResolutionHours),
      ]),
    },
    {
      kind: 'table',
      heading: 'Tickets opened',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function SupportReportScreen() {
  const p = useReportParams()
  const category = pickOption(p.filter('category'), TICKET_CATEGORIES)
  const priority = pickOption(p.filter('priority'), TICKET_PRIORITIES)
  const state = useResource(
    () => getSupportReport(p.range, { category, priority }),
    JSON.stringify([p.range, category, priority]),
  )
  return (
    <ReportFrame
      title="Support ticket report"
      subtitle="Tickets opened in the period, how quickly the team responded and resolved them, and what is open now."
      params={p}
      state={state}
      filters={
        <>
          <FilterSelect
            id="category"
            label="Category"
            value={category}
            options={TICKET_CATEGORIES}
            onChange={(v) => p.update({ category: v })}
          />
          <FilterSelect
            id="priority"
            label="Priority"
            value={priority}
            options={TICKET_PRIORITIES}
            onChange={(v) => p.update({ priority: v })}
          />
        </>
      }
      filterSummary={[
        ...filterNote('Category', category, TICKET_CATEGORIES),
        ...filterNote('Priority', priority, TICKET_PRIORITIES),
      ]}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Opened and resolved"
              subtitle="Tickets by month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.opened, m.resolved] }))}
                  series={[{ name: 'Opened' }, { name: 'Resolved' }]}
                  caption="Tickets opened and resolved by month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By category">
              <BarList
                items={r.byCategory.map((s) => ({
                  label: keyLabel(TICKET_CATEGORIES, s.key),
                  value: s.count,
                  display: countShare(s.count, r.opened),
                }))}
                empty="No tickets were opened in this period."
              />
            </Panel>
            <Panel
              title="By person"
              subtitle="Tickets opened in the period, by who has them"
              className="xl:col-span-2"
            >
              <BarList
                items={r.byAssignee.map((a) => ({
                  label: a.name ?? 'Not assigned',
                  value: a.tickets,
                  display: `${formatNumber(a.tickets)} · ${formatNumber(a.resolved)} resolved${a.avgResolutionHours === null ? '' : ` in ${duration(a.avgResolutionHours)}`}`,
                }))}
                empty="No tickets were opened in this period."
              />
            </Panel>
            <Panel title="By priority">
              <BarList
                items={r.byPriority.map((s) => ({
                  label: keyLabel(TICKET_PRIORITIES, s.key),
                  value: s.count,
                  display: countShare(s.count, r.opened),
                }))}
                empty="No tickets were opened in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Tickets opened"
            subtitle="Newest first. Status is as it is now."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No tickets were opened in this period."
          />
        </>
      )}
    </ReportFrame>
  )
}
