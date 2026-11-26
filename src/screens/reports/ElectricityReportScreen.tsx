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
import { getElectricityReport } from '@/services/reports'
import { METER_TYPES } from '@/types/meters'
import type { ElectricityReport, ReadingRow } from '@/types/reports'
import { formatDate, formatNumber, monthLabel } from '@/utils/format'
import {
  filterNote,
  keyLabel,
  kwh,
  kwhAxis,
  percent,
  pickOption,
  versus,
} from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const reading = (v: number | null) =>
  v === null ? '-' : v.toLocaleString('en-US', { maximumFractionDigits: 3 })

const COLUMNS: ReportColumn<ReadingRow>[] = [
  { label: 'Date', text: (r) => formatDate(r.readingDate), csv: (r) => r.readingDate },
  {
    label: 'Meter',
    weight: 1.2,
    text: (r) => r.serialNumber,
    csv: (r) => r.serialNumber,
    cell: (r) => (
      <Link to={`/electricity-meters/${r.meterId}`} className={inlineLink}>
        {r.serialNumber}
      </Link>
    ),
  },
  { label: 'Property', weight: 2, text: (r) => r.propertyName, csv: (r) => r.propertyName },
  {
    label: 'Previous',
    align: 'right',
    text: (r) => reading(r.previousValue),
    csv: (r) => r.previousValue,
  },
  {
    label: 'Reading',
    align: 'right',
    text: (r) => reading(r.readingValue),
    csv: (r) => r.readingValue,
  },
  {
    label: 'Used (kWh)',
    align: 'right',
    text: (r) => (r.consumption === null ? 'First reading' : reading(r.consumption)),
    csv: (r) => r.consumption,
  },
  {
    label: 'Notes',
    weight: 1.2,
    text: (r) =>
      [
        r.isEstimate && 'Estimated',
        r.flag === 'high' && 'Unusually high',
        r.flag === 'low' && 'Unusually low',
      ]
        .filter(Boolean)
        .join(', ') || '-',
    csv: (r) => [r.isEstimate && 'estimated', r.flag].filter(Boolean).join(' '),
  },
]

function figures(r: ElectricityReport) {
  return [
    { label: 'Electricity used', value: kwh(r.kwh), detail: versus(r.kwh, r.kwhPrior) },
    {
      label: 'Average per day',
      value: kwh(r.days > 0 ? r.kwh / r.days : 0),
      detail: `Over ${r.days} days`,
    },
    {
      label: 'Same period last year',
      value: kwh(r.kwhLastYear),
      detail:
        r.kwhLastYear > 0 ? versus(r.kwh, r.kwhLastYear, 'last year') : 'No readings a year ago',
    },
    {
      label: 'Estimated',
      value: percent(r.estimatedKwh, r.kwh),
      detail: `${kwh(r.estimatedKwh)} from estimated readings · ${formatNumber(r.metersReporting)} of ${formatNumber(r.meters)} meters reporting`,
      tone: r.estimatedKwh > 0 ? ('warning' as const) : undefined,
    },
  ]
}

function sections(r: ElectricityReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'By month',
      columns: [{ label: 'Month' }, { label: 'Used', align: 'right' }],
      rows: r.months.map((m) => [monthLabel(m.month, 'long'), kwh(m.kwh)]),
    },
    {
      kind: 'table',
      heading: 'By property',
      columns: [
        { label: 'Property', weight: 3 },
        { label: 'Meters', align: 'right' },
        { label: 'Used', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: r.byProperty.map((p) => [p.name, String(p.meters), kwh(p.kwh), percent(p.kwh, r.kwh)]),
    },
    {
      kind: 'table',
      heading: 'By meter type',
      columns: [
        { label: 'Meter type', weight: 2 },
        { label: 'Meters', align: 'right' },
        { label: 'Used', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: r.byMeterType.map((t) => [
        keyLabel(METER_TYPES, t.key),
        String(t.meters),
        kwh(t.kwh),
        percent(t.kwh, r.kwh),
      ]),
    },
    {
      kind: 'table',
      heading: 'Readings',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function ElectricityReportScreen() {
  const p = useReportParams()
  const property = /^[0-9a-f-]{36}$/i.test(p.filter('property')) ? p.filter('property') : ''
  const meterType = pickOption(p.filter('meterType'), METER_TYPES, true)
  const state = useResource(
    () => getElectricityReport(p.range, { property, meterType }),
    JSON.stringify([p.range, property, meterType]),
  )
  const properties = state.data?.properties ?? []
  const propertyOptions = properties.map((x) => ({ value: x.id, label: x.name }))
  return (
    <ReportFrame
      title="Electricity consumption report"
      subtitle="kWh used across properties and meters. Use between two readings is spread evenly over the days between them."
      params={p}
      state={state}
      filters={
        <>
          <FilterSelect
            id="property"
            label="Property"
            value={property}
            options={propertyOptions}
            onChange={(v) => p.update({ property: v })}
          />
          <FilterSelect
            id="meterType"
            label="Meter type"
            value={meterType}
            options={METER_TYPES}
            allowNone
            onChange={(v) => p.update({ meterType: v })}
          />
        </>
      }
      filterSummary={[
        ...filterNote('Property', property, propertyOptions),
        ...filterNote('Meter type', meterType, METER_TYPES),
      ]}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Monthly consumption"
              subtitle="kWh used each month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({ month: m.month, values: [m.kwh] }))}
                  series={[{ name: 'Electricity used' }]}
                  caption="Electricity used by month"
                  format={kwh}
                  formatAxis={kwhAxis}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By meter type">
              <BarList
                items={r.byMeterType.map((t) => ({
                  label: keyLabel(METER_TYPES, t.key),
                  value: t.kwh,
                  display: `${kwh(t.kwh)} (${percent(t.kwh, r.kwh)})`,
                }))}
                formatOther={kwh}
                empty="No consumption in this period."
              />
            </Panel>
            <Panel title="By property" subtitle="Highest use first" className="xl:col-span-2">
              <BarList
                items={r.byProperty.map((x) => ({
                  label: x.name,
                  value: x.kwh,
                  display: `${kwh(x.kwh)} (${percent(x.kwh, r.kwh)})`,
                }))}
                formatOther={kwh}
                empty="No consumption in this period."
              />
            </Panel>
            <Panel title="Highest-use meters">
              <BarList
                items={r.byMeter.map((m) => ({
                  label: `${m.serialNumber} · ${m.propertyName}`,
                  value: m.kwh,
                  display: kwh(m.kwh),
                }))}
                formatOther={kwh}
                empty="No consumption in this period."
              />
            </Panel>
          </div>
          <ReportTable
            title="Readings"
            subtitle="Every reading taken in the period, newest first."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No readings were taken in this period."
          />
        </>
      )}
    </ReportFrame>
  )
}
