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
import { getPropertyReport } from '@/services/reports'
import { PROVINCES } from '@/types/customers'
import { PROPERTY_STATUSES, PROPERTY_TYPES } from '@/types/properties'
import type { PropertyReport, PropertyRow } from '@/types/reports'
import { formatNumber, monthLabel } from '@/utils/format'
import { countShare, filterNote, keyLabel, kwh, percent, pickOption } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: p }))
const nameOf = (r: PropertyRow) => r.name ?? r.address

const COLUMNS: ReportColumn<PropertyRow>[] = [
  {
    label: 'Property',
    weight: 2.2,
    text: nameOf,
    csv: nameOf,
    cell: (r) => (
      <Link to={`/properties/${r.id}`} className={inlineLink}>
        {nameOf(r)}
      </Link>
    ),
  },
  { label: 'Address', weight: 2, text: (r) => r.address, csv: (r) => r.address },
  { label: 'Reference', text: (r) => r.reference ?? '-', csv: (r) => r.reference ?? '' },
  { label: 'Customer', weight: 1.6, text: (r) => r.customerName, csv: (r) => r.customerName },
  {
    label: 'Type',
    text: (r) => keyLabel(PROPERTY_TYPES, r.propertyType),
    csv: (r) => r.propertyType ?? '',
  },
  {
    label: 'Province',
    weight: 1.2,
    text: (r) => r.province ?? 'Not recorded',
    csv: (r) => r.province ?? '',
  },
  { label: 'Status', text: (r) => keyLabel(PROPERTY_STATUSES, r.status), csv: (r) => r.status },
  {
    label: 'Units',
    align: 'right',
    weight: 0.6,
    text: (r) => (r.units === null ? '-' : formatNumber(r.units)),
    csv: (r) => r.units,
  },
  {
    label: 'Meters',
    align: 'right',
    weight: 0.6,
    text: (r) => formatNumber(r.meters),
    csv: (r) => r.meters,
  },
  { label: 'Used (kWh)', align: 'right', text: (r) => kwh(r.kwh), csv: (r) => r.kwh },
]

const slices = (
  list: PropertyReport['byType'],
  total: number,
  labels: readonly { value: string; label: string }[],
) =>
  list.map((s) => ({
    label: keyLabel(labels, s.key),
    value: s.count,
    display: countShare(s.count, total),
  }))

function figures(r: PropertyReport) {
  return [
    {
      label: 'Properties',
      value: formatNumber(r.total),
      detail: `${formatNumber(r.new)} added in the period`,
    },
    {
      label: 'Units',
      value: formatNumber(r.units),
      detail: 'Homes, shops or offices across the properties',
    },
    {
      label: 'Meters in service',
      value: formatNumber(r.metersInService),
      detail: `${formatNumber(r.withoutMeter)} ${r.withoutMeter === 1 ? 'property has' : 'properties have'} no meter`,
      tone: r.withoutMeter > 0 ? ('warning' as const) : undefined,
    },
    {
      label: 'Electricity used',
      value: kwh(r.kwh),
      detail: `${percent(r.byStatus.active ?? 0, r.total)} of properties active`,
    },
  ]
}

function sections(r: PropertyReport): ReportSection[] {
  const breakdown = (heading: string, list: { label: string; display: string }[]) => ({
    kind: 'table' as const,
    heading,
    columns: [
      { label: heading.replace('By ', ''), weight: 2 },
      { label: 'Properties', align: 'right' as const },
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
        { label: 'Added', align: 'right' },
        { label: 'Properties at month end', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.new),
        formatNumber(m.total),
      ]),
    },
    breakdown('By type', slices(r.byType, r.total, PROPERTY_TYPES)),
    breakdown('By province', slices(r.byProvince, r.total, PROVINCE_OPTIONS)),
    {
      kind: 'table',
      heading: 'Properties',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function PropertyReportScreen() {
  const p = useReportParams()
  const type = pickOption(p.filter('type'), PROPERTY_TYPES, true)
  const province = pickOption(p.filter('province'), PROVINCE_OPTIONS, true)
  const state = useResource(
    () => getPropertyReport(p.range, { type, province }),
    JSON.stringify([p.range, type, province]),
  )
  return (
    <ReportFrame
      title="Property report"
      subtitle="Properties by type, province and status, with their meters and electricity use."
      params={p}
      state={state}
      filters={
        <>
          <FilterSelect
            id="type"
            label="Property type"
            value={type}
            options={PROPERTY_TYPES}
            allowNone
            onChange={(v) => p.update({ type: v })}
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
        ...filterNote('Type', type, PROPERTY_TYPES),
        ...filterNote('Province', province, PROVINCE_OPTIONS),
      ]}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Properties"
              subtitle="At the end of each month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.total] }))}
                  series={[{ name: 'Properties' }]}
                  caption="Properties at the end of each month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By type">
              <BarList
                items={slices(r.byType, r.total, PROPERTY_TYPES)}
                empty="No properties in this period."
              />
            </Panel>
            <Panel title="By province" className="xl:col-span-2">
              <BarList
                items={slices(r.byProvince, r.total, PROVINCE_OPTIONS)}
                empty="No properties in this period."
              />
            </Panel>
            <Panel title="By status" subtitle="Status now">
              <BarList
                items={PROPERTY_STATUSES.map((s) => ({
                  label: s.label,
                  value: r.byStatus[s.value] ?? 0,
                  display: countShare(r.byStatus[s.value] ?? 0, r.total),
                }))}
                empty="No properties in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Properties"
            subtitle="Highest electricity use in the period first."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No properties match this period and these filters."
          />
        </>
      )}
    </ReportFrame>
  )
}
