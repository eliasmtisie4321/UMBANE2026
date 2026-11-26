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
import { getTeamReport } from '@/services/reports'
import type { TeamReport, TeamReportRow } from '@/types/reports'
import { DEPARTMENTS } from '@/types/team'
import { formatNumber, monthLabel } from '@/utils/format'
import { filterNote, keyLabel, percent, pickOption } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const COLUMNS: ReportColumn<TeamReportRow>[] = [
  {
    label: 'Person',
    weight: 1.8,
    text: (r) => (r.isActive ? r.fullName : `${r.fullName} (no longer active)`),
    csv: (r) => r.fullName,
    cell: (r) => (
      <Link to={`/team/${r.id}`} className={inlineLink}>
        {r.fullName}
        {!r.isActive && ' (no longer active)'}
      </Link>
    ),
  },
  { label: 'Job title', weight: 1.5, text: (r) => r.jobTitle ?? '-', csv: (r) => r.jobTitle ?? '' },
  {
    label: 'Department',
    weight: 1.4,
    text: (r) => keyLabel(DEPARTMENTS, r.department),
    csv: (r) => r.department ?? '',
  },
  {
    label: 'Given',
    align: 'right',
    weight: 0.7,
    text: (r) => formatNumber(r.assigned),
    csv: (r) => r.assigned,
  },
  {
    label: 'Finished',
    align: 'right',
    weight: 0.8,
    text: (r) => formatNumber(r.completed),
    csv: (r) => r.completed,
  },
  {
    label: 'On time',
    align: 'right',
    weight: 0.8,
    text: (r) => percent(r.onTime, r.withDue),
    csv: (r) => (r.withDue > 0 ? Math.round((r.onTime / r.withDue) * 1000) / 10 : null),
  },
  {
    label: 'Open now',
    align: 'right',
    weight: 0.8,
    text: (r) => formatNumber(r.pending),
    csv: (r) => r.pending,
  },
  {
    label: 'Overdue now',
    align: 'right',
    weight: 0.9,
    text: (r) => formatNumber(r.overdue),
    csv: (r) => r.overdue,
  },
  {
    label: 'Field jobs open',
    align: 'right',
    weight: 0.9,
    text: (r) => formatNumber(r.fieldOpen),
    csv: (r) => r.fieldOpen,
  },
  {
    label: 'Tickets resolved',
    align: 'right',
    weight: 1,
    text: (r) => formatNumber(r.ticketsResolved),
    csv: (r) => r.ticketsResolved,
  },
]

function figures(r: TeamReport) {
  return [
    {
      label: 'Team members',
      value: formatNumber(r.employees),
      detail: `${formatNumber(r.byEmployment.on_leave ?? 0)} on leave · ${formatNumber(r.byEmployment.training ?? 0)} in training`,
    },
    {
      label: 'Tasks finished',
      value: formatNumber(r.completed),
      detail: `${percent(r.assignedDone, r.assigned)} of the ${formatNumber(r.assigned)} tasks given in the period are done`,
    },
    {
      label: 'On time',
      value: percent(r.onTime, r.withDue),
      detail: `${formatNumber(r.onTime)} of ${formatNumber(r.withDue)} finished tasks with a due date`,
    },
    {
      label: 'Open tasks now',
      value: formatNumber(r.pending),
      detail: `${formatNumber(r.overdue)} overdue · ${formatNumber(r.unassignedOpen)} not assigned`,
      tone: r.overdue > 0 ? ('error' as const) : undefined,
    },
  ]
}

function sections(r: TeamReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [
        { label: 'Month' },
        { label: 'Tasks given', align: 'right' },
        { label: 'Tasks finished', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.created),
        formatNumber(m.completed),
      ]),
    },
    {
      kind: 'table',
      heading: 'By department',
      columns: [
        { label: 'Department', weight: 2 },
        { label: 'People', align: 'right' },
        { label: 'Finished', align: 'right' },
        { label: 'On time', align: 'right' },
        { label: 'Open now', align: 'right' },
        { label: 'Overdue now', align: 'right' },
      ],
      rows: r.byDepartment.map((d) => [
        keyLabel(DEPARTMENTS, d.key),
        formatNumber(d.people),
        formatNumber(d.completed),
        percent(d.onTime, d.withDue),
        formatNumber(d.pending),
        formatNumber(d.overdue),
      ]),
    },
    {
      kind: 'table',
      heading: 'People',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function TeamReportScreen() {
  const p = useReportParams()
  const department = pickOption(p.filter('department'), DEPARTMENTS, true)
  const state = useResource(
    () => getTeamReport(p.range, { department }),
    JSON.stringify([p.range, department]),
  )
  return (
    <ReportFrame
      title="Team performance report"
      subtitle="Tasks given and finished in the period, how many were on time, and each person's workload now."
      params={p}
      state={state}
      filters={
        <FilterSelect
          id="department"
          label="Department"
          value={department}
          options={DEPARTMENTS}
          allowNone
          onChange={(v) => p.update({ department: v })}
        />
      }
      filterSummary={filterNote('Department', department, DEPARTMENTS)}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Tasks given and finished"
              subtitle="By month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({
                    month: m.month,
                    values: [m.created, m.completed],
                  }))}
                  series={[{ name: 'Given' }, { name: 'Finished' }]}
                  caption="Tasks given and finished by month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By department" subtitle="Tasks finished · on time">
              <BarList
                items={r.byDepartment.map((d) => ({
                  label: keyLabel(DEPARTMENTS, d.key),
                  value: d.completed,
                  display: `${formatNumber(d.completed)} · ${percent(d.onTime, d.withDue)}`,
                }))}
                empty="Nobody in this department."
              />
            </Panel>
            <Panel
              title="Tasks finished by person"
              subtitle="In the period"
              className="xl:col-span-3"
            >
              <BarList
                items={r.rows
                  .filter((x) => x.completed > 0)
                  .map((x) => ({
                    label: x.fullName,
                    value: x.completed,
                    display: `${formatNumber(x.completed)} · ${percent(x.onTime, x.withDue)} on time`,
                  }))}
                empty="No tasks were finished in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="People"
            subtitle="Given and finished are for the period; open, overdue and field jobs are as they are now."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="Nobody matches this filter."
          />
        </>
      )}
    </ReportFrame>
  )
}
