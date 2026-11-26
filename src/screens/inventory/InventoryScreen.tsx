import {
  AlertTriangle,
  Boxes,
  History,
  PackageX,
  Plus,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, Notice, SearchField } from '@/components/data/ListPanel'
import { inlineLink, primaryLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { StockMovementDialog } from '@/components/inventory/StockMovementDialog'
import { Badge, Button, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import {
  getCategories,
  getInventorySummary,
  getStockAlerts,
  listProducts,
} from '@/services/inventory'
import { STOCK_STATUSES, type ProductSort } from '@/types/inventory'
import { formatNumber, formatRand } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = [
  'name',
  'sku',
  'stock_on_hand',
  'unit_price',
  'created_at',
] as const satisfies readonly ProductSort[]
const STATUS_VALUES = STOCK_STATUSES.map((s) => s.value)
const money = (n: number) => formatRand(n, { cents: true })

function StockAlerts({ version }: { version: number }) {
  const state = useResource(() => getStockAlerts(), `stock-alerts-${version}`)
  return (
    <Panel
      title="Low stock alerts"
      subtitle="At or below their minimum, emptiest first"
      className="mb-4"
    >
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="Every stocked product is above its minimum."
      >
        {(rows) => (
          <ul className="divide-y divide-outline-variant">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <Link to={`/inventory/${p.id}`} className={inlineLink}>
                    {p.name}
                  </Link>
                  <span className="block text-label-md text-on-surface-variant">
                    {p.sku} · {formatNumber(p.stockOnHand)} left, minimum{' '}
                    {formatNumber(p.lowStockThreshold)}
                  </span>
                </span>
                <StatusBadge status={p.stockStatus} />
              </li>
            ))}
          </ul>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

export default function InventoryScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'stock', STATUS_VALUES)
  const category = params.get('category') ?? ''
  const includeInactive = params.get('inactive') === '1'
  const { sort, ascending } = readSort(params, SORTS, 'name')
  const page = readPage(params)
  const [moving, setMoving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped after a movement so counts, alerts and the list refresh together.
  const [version, setVersion] = useState(0)

  const state = useResource(
    () =>
      listProducts(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { status, category, includeInactive },
      ),
    JSON.stringify([search, status, category, includeInactive, sort, ascending, page, version]),
  )
  const summary = useResource(() => getInventorySummary(), `inventory-summary-${version}`)
  const categories = useResource(() => getCategories(), 'categories')
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const sortHeader = (label: string, column: ProductSort, className?: string) => (
    <SortableTh
      label={label}
      className={className}
      active={sort === column}
      ascending={ascending}
      onSort={() => {
        const next = nextSort({ sort, ascending }, column)
        update({ sort: next.sort, dir: next.dir })
      }}
    />
  )

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Products, stock on hand and stock movements."
        actions={
          <>
            <Link to="/inventory/history" className={secondaryLink}>
              <History size={16} aria-hidden="true" /> Stock History
            </Link>
            <Button variant="secondary" onClick={() => setMoving(true)}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Stock Movement
            </Button>
            <Link to="/inventory/new" className={primaryLink}>
              <Plus size={16} aria-hidden="true" /> Add Product
            </Link>
          </>
        }
      />
      {notice && <Notice>{notice}</Notice>}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Units in stock"
          icon={Boxes}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.units),
            detail: `${formatNumber(s.activeProducts)} active products`,
          })}
        />
        <StatTile
          label="Low stock"
          icon={AlertTriangle}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.low),
            detail: 'at or below minimum',
            tone: s.low > 0 ? 'warning' : 'neutral',
          })}
        />
        <StatTile
          label="Out of stock"
          icon={PackageX}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.outOfStock),
            detail: s.outOfStock > 0 ? 'restock needed' : undefined,
            tone: s.outOfStock > 0 ? 'error' : 'neutral',
          })}
        />
        <StatTile
          label="Stock value"
          icon={Wallet}
          state={summary}
          map={(s) => ({
            value: money(s.stockValue),
            detail:
              s.unvalued > 0
                ? `${formatNumber(s.unvalued)} ${s.unvalued === 1 ? 'product has' : 'products have'} no cost price`
                : 'at cost price',
            tone: s.unvalued > 0 ? 'warning' : 'neutral',
          })}
        />
      </div>

      <StockAlerts version={version} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <SearchField
          id="product-search"
          label="Search products"
          placeholder="Name, SKU, category or supplier"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="product-category"
          label="Category"
          options={[
            { value: '', label: 'All categories' },
            ...(categories.data ?? []).map((c) => ({ value: c, label: c })),
            ...(category && !(categories.data ?? []).includes(category)
              ? [{ value: category, label: category }]
              : []),
          ]}
          value={category}
          onChange={(e) => update({ category: e.target.value })}
        />
        <Select
          id="product-stock"
          label="Stock"
          options={[{ value: '', label: 'All stock levels' }, ...STOCK_STATUSES]}
          value={status}
          onChange={(e) => update({ stock: e.target.value })}
        />
      </div>

      <ListPanel
        title="Products"
        noun="products"
        state={state}
        page={page}
        filtered={Boolean(q || status || category)}
        action={
          <label className="flex items-center gap-2 text-label-md text-on-surface">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => update({ inactive: e.target.checked ? '1' : undefined })}
              className="h-4 w-4 accent-primary"
            />
            Show inactive
          </label>
        }
        empty={
          <>
            <p>There are no products yet.</p>
            <Link to="/inventory/new" className={inlineLink}>
              Add the first product
            </Link>
          </>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Products</caption>
            <thead>
              <tr>
                {sortHeader('Product', 'name')}
                {sortHeader('SKU', 'sku')}
                <Th>Category</Th>
                <Th className="text-right">Cost</Th>
                {sortHeader('Price', 'unit_price', 'text-right')}
                {sortHeader('On hand', 'stock_on_hand', 'text-right')}
                <Th>Stock</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link
                      to={`/inventory/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                    {!p.isActive && (
                      <Badge className="ml-2" tone="neutral">
                        Inactive
                      </Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-label-md">{p.sku}</Td>
                  <Td>{p.category ?? '-'}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {p.costPrice === null ? '-' : money(p.costPrice)}
                  </Td>
                  <Td className="whitespace-nowrap text-right">{money(p.unitPrice)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {p.trackStock ? formatNumber(p.stockOnHand) : '-'}
                  </Td>
                  <Td>
                    <StatusBadge status={p.stockStatus} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ListPanel>

      {moving && (
        <StockMovementDialog
          product={null}
          onClose={() => setMoving(false)}
          onSaved={(balance, p) => {
            setMoving(false)
            setNotice(`${p.name}: ${formatNumber(balance)} now on hand.`)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </>
  )
}
