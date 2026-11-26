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
import { getInventoryReport, listProductCategories } from '@/services/reports'
import { STOCK_STATUSES } from '@/types/inventory'
import type { InventoryReport, ProductReportRow } from '@/types/reports'
import { formatDate, formatNumber, formatRand, monthLabel } from '@/utils/format'
import { filterNote, keyLabel, pickOption } from '@/utils/reportFormat'
import type { ReportSection } from '@/utils/reportPdf'

const COLUMNS: ReportColumn<ProductReportRow>[] = [
  { label: 'SKU', text: (r) => r.sku, csv: (r) => r.sku },
  {
    label: 'Product',
    weight: 2.2,
    text: (r) => r.name,
    csv: (r) => r.name,
    cell: (r) => (
      <Link to={`/inventory/${r.id}`} className={inlineLink}>
        {r.name}
      </Link>
    ),
  },
  {
    label: 'Category',
    weight: 1.3,
    text: (r) => r.category ?? 'Not recorded',
    csv: (r) => r.category ?? '',
  },
  {
    label: 'In stock',
    align: 'right',
    text: (r) => (r.trackStock ? formatNumber(r.stockOnHand) : '-'),
    csv: (r) => (r.trackStock ? r.stockOnHand : null),
  },
  {
    label: 'Cost',
    align: 'right',
    text: (r) => (r.costPrice === null ? '-' : formatRand(r.costPrice, { cents: true })),
    csv: (r) => r.costPrice,
  },
  {
    label: 'Stock value',
    align: 'right',
    text: (r) => (r.stockValue === null ? '-' : formatRand(r.stockValue)),
    csv: (r) => r.stockValue,
  },
  {
    label: 'Status',
    text: (r) => (r.isActive ? keyLabel(STOCK_STATUSES, r.stockStatus) : 'Inactive'),
    csv: (r) => (r.isActive ? r.stockStatus : 'inactive'),
  },
  {
    label: 'In',
    align: 'right',
    weight: 0.6,
    text: (r) => formatNumber(r.inbound),
    csv: (r) => r.inbound,
  },
  {
    label: 'Out',
    align: 'right',
    weight: 0.6,
    text: (r) => formatNumber(r.outbound),
    csv: (r) => r.outbound,
  },
]

function figures(r: InventoryReport) {
  return [
    {
      label: 'Stock value',
      value: formatRand(r.stockValue),
      detail:
        r.unvalued > 0
          ? `${formatNumber(r.unvalued)} products have stock but no cost price`
          : 'At cost price, stock now',
    },
    {
      label: 'Products',
      value: formatNumber(r.products),
      detail: `${formatNumber(r.units)} units in stock now`,
    },
    {
      label: 'Low stock',
      value: formatNumber(r.low),
      detail: 'At or below the reorder level',
      tone: r.low > 0 ? ('warning' as const) : undefined,
    },
    {
      label: 'Out of stock',
      value: formatNumber(r.out),
      detail: `${formatNumber(r.inbound)} units in and ${formatNumber(r.outbound)} out in the period`,
      tone: r.out > 0 ? ('error' as const) : undefined,
    },
  ]
}

function sections(r: InventoryReport): ReportSection[] {
  return [
    { kind: 'figures', heading: 'Summary', items: figures(r) },
    {
      kind: 'table',
      heading: 'Stock in and out by month',
      columns: [
        { label: 'Month' },
        { label: 'Units in', align: 'right' },
        { label: 'Units out', align: 'right' },
      ],
      rows: r.months.map((m) => [
        monthLabel(m.month, 'long'),
        formatNumber(m.inbound),
        formatNumber(m.outbound),
      ]),
    },
    {
      kind: 'table',
      heading: 'By category',
      columns: [
        { label: 'Category', weight: 2 },
        { label: 'Products', align: 'right' },
        { label: 'Units', align: 'right' },
        { label: 'Value', align: 'right' },
      ],
      rows: r.byCategory.map((c) => [
        c.key ?? 'Not recorded',
        formatNumber(c.products),
        formatNumber(c.units),
        formatRand(c.value),
      ]),
    },
    {
      kind: 'table',
      heading: 'Fastest-moving products',
      columns: [
        { label: 'SKU' },
        { label: 'Product', weight: 3 },
        { label: 'Units out', align: 'right' },
        { label: 'In stock', align: 'right' },
      ],
      rows: r.fast.map((f) => [
        f.sku,
        f.name,
        formatNumber(f.outbound),
        formatNumber(f.stockOnHand),
      ]),
    },
    {
      kind: 'table',
      heading: 'Slowest-moving products',
      columns: [
        { label: 'SKU' },
        { label: 'Product', weight: 3 },
        { label: 'Units out', align: 'right' },
        { label: 'In stock', align: 'right' },
        { label: 'Last out' },
      ],
      rows: r.slow.map((s) => [
        s.sku,
        s.name,
        formatNumber(s.outbound),
        formatNumber(s.stockOnHand),
        s.lastOut ? formatDate(s.lastOut) : 'Never',
      ]),
    },
    {
      kind: 'table',
      heading: 'Products',
      columns: COLUMNS.map((c) => ({ label: c.label, align: c.align, weight: c.weight })),
      rows: r.rows.map((row) => COLUMNS.map((c) => c.text(row))),
    },
  ]
}

export default function InventoryReportScreen() {
  const p = useReportParams()
  const categories = useResource(() => listProductCategories(), 'product-categories')
  const options = (categories.data ?? []).map((c) => ({ value: c, label: c }))
  // Until the list loads, keep whatever category the address asks for.
  const category = categories.data
    ? pickOption(p.filter('category'), options, true)
    : p.filter('category')
  const state = useResource(
    () => getInventoryReport(p.range, { category }),
    JSON.stringify([p.range, category]),
  )
  return (
    <ReportFrame
      title="Inventory report"
      subtitle="Stock value and levels as they are now, and stock movement in the period."
      params={p}
      state={state}
      filters={
        <FilterSelect
          id="category"
          label="Category"
          value={category}
          options={options}
          allowNone
          onChange={(v) => p.update({ category: v })}
        />
      }
      filterSummary={filterNote('Category', category, options)}
      exports={{ columns: COLUMNS, rows: (r) => r.rows, sections }}
    >
      {(r) => (
        <>
          <FigureGrid label="Summary" figures={figures(r)} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartPanel
              title="Stock in and out"
              subtitle="Units by month"
              className="xl:col-span-2"
            >
              {(asTable) => (
                <MonthBars
                  points={r.months.map((m) => ({
                    month: m.month,
                    values: [m.inbound, m.outbound],
                  }))}
                  series={[{ name: 'Units in' }, { name: 'Units out' }]}
                  caption="Units in and out by month"
                  format={formatNumber}
                  formatAxis={formatNumber}
                  asTable={asTable}
                />
              )}
            </ChartPanel>
            <Panel title="By category" subtitle="Stock value now">
              <BarList
                items={r.byCategory.map((c) => ({
                  label: `${c.key ?? 'Not recorded'} (${formatNumber(c.products)})`,
                  value: c.value,
                  display: formatRand(c.value),
                }))}
                formatOther={(v) => formatRand(v)}
                empty="No products."
              />
            </Panel>
            <Panel
              title="Fastest-moving"
              subtitle="Most units out in the period"
              className="xl:col-span-2"
            >
              <BarList
                items={r.fast.map((f) => ({
                  label: `${f.name} · ${f.sku}`,
                  value: f.outbound,
                  display: `${formatNumber(f.outbound)} out · ${formatNumber(f.stockOnHand)} left`,
                }))}
                empty="Nothing went out in this period."
              />
            </Panel>
            <Panel title="Slowest-moving" subtitle="In stock, fewest units out">
              {r.slow.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">No products in stock.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {r.slow.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 text-body-md"
                    >
                      <span className="min-w-0 truncate text-on-surface">{s.name}</span>
                      <span className="shrink-0 text-label-md text-on-surface-variant">
                        {formatNumber(s.stockOnHand)} in stock ·{' '}
                        {s.lastOut ? `last out ${formatDate(s.lastOut)}` : 'never sold'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <ReportTable
            title="Products"
            subtitle="Highest stock value first. In and out are units moved in the period."
            columns={COLUMNS}
            rows={r.rows}
            rowCount={r.rowCount}
            empty="No products match this filter."
          />
        </>
      )}
    </ReportFrame>
  )
}
