import { Pencil, Power, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { DetailList } from '@/components/data/DetailList'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { StatusBadge } from '@/components/data/StatusBadge'
import { MovementTable } from '@/components/inventory/MovementTable'
import { StockMovementDialog } from '@/components/inventory/StockMovementDialog'
import { Badge, Button, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getProduct, getProductOrders, listMovements, setProductActive } from '@/services/inventory'
import type { Product } from '@/types/inventory'
import { formatDate, formatNumber, formatRand } from '@/utils/format'

const PER_PAGE = 10
const money = (n: number) => formatRand(n, { cents: true })

function ProductBody({
  product: p,
  version,
  onChanged,
}: {
  product: Product
  version: number
  onChanged: (notice: string) => void
}) {
  const [page, setPage] = useState(1)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const movements = useResource(
    () =>
      listMovements(
        { search: '', sort: 'created_at', ascending: false, page, pageSize: PER_PAGE },
        { type: '', productId: p.id, from: '', to: '' },
      ),
    `movements-${p.id}-${page}-${version}`,
  )
  const orders = useResource(() => getProductOrders(p.id), `product-orders-${p.id}`)
  const margin =
    p.costPrice !== null && p.unitPrice > 0
      ? Math.round(((p.unitPrice - p.costPrice) / p.unitPrice) * 1000) / 10
      : null

  async function toggleActive() {
    setBusy(true)
    setError(null)
    const result = await setProductActive(p.id, !p.isActive)
    setBusy(false)
    if (result.ok)
      onChanged(
        p.isActive
          ? 'Product deactivated. It is hidden from new orders; its history is kept.'
          : 'Product reactivated.',
      )
    else setError(result.error.message)
  }

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            <StatusBadge status={p.stockStatus} />
            {!p.isActive && <Badge>Inactive</Badge>}
          </span>
        }
        back={{ to: '/inventory', label: 'Inventory' }}
        actions={
          <>
            <Button variant="secondary" loading={busy} onClick={() => void toggleActive()}>
              <Power size={16} aria-hidden="true" /> {p.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
            <Link to={`/inventory/${p.id}/edit`} className={secondaryLink}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Link>
            {p.trackStock && (
              <Button onClick={() => setMoving(true)}>
                <SlidersHorizontal size={16} aria-hidden="true" /> Adjust Stock
              </Button>
            )}
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Stock">
          {p.trackStock ? (
            <DetailList
              items={[
                { label: 'On hand', value: `${formatNumber(p.stockOnHand)} units` },
                { label: 'Minimum level', value: `${formatNumber(p.lowStockThreshold)} units` },
                {
                  label: 'Stock value',
                  value:
                    p.stockValue === null || p.costPrice === null
                      ? 'No cost price'
                      : money(p.stockValue),
                },
              ]}
            />
          ) : (
            <p className="text-body-md text-on-surface-variant">
              This is a service. It is sold on orders and invoices but has no stock.
            </p>
          )}
        </Panel>
        <Panel title="Product information">
          <DetailList
            items={[
              { label: 'Selling price', value: money(p.unitPrice) },
              { label: 'Cost price', value: p.costPrice === null ? null : money(p.costPrice) },
              { label: 'Margin', value: margin === null ? null : `${margin}%` },
              { label: 'Category', value: p.category },
              { label: 'Supplier', value: p.supplier },
              { label: 'Added', value: formatDate(p.createdAt) },
            ]}
          />
          {p.description && (
            <p className="mt-4 whitespace-pre-wrap border-t border-outline-variant pt-4 text-body-md text-on-surface">
              {p.description}
            </p>
          )}
        </Panel>

        {p.trackStock && (
          <Panel title="Stock movement history" className="lg:col-span-2">
            <ResourceBoundary
              state={movements}
              isEmpty={(d) => d.total === 0}
              empty="No stock has moved yet."
            >
              {(d) => (
                <>
                  <MovementTable rows={d.rows} showProduct={false} />
                  <Pagination
                    page={page}
                    pageSize={PER_PAGE}
                    total={d.total}
                    onPageChange={setPage}
                  />
                </>
              )}
            </ResourceBoundary>
          </Panel>
        )}

        <Panel
          title="Recent orders"
          subtitle="Orders that include this product"
          className="lg:col-span-2"
        >
          <ResourceBoundary
            state={orders}
            isEmpty={(rows) => rows.length === 0}
            empty="No orders include this product yet."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Orders with this product</caption>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Customer</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Quantity</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr key={`${o.orderId}-${i}`}>
                      <Td>
                        <Link
                          to={`/sales-orders/${o.orderId}`}
                          className={`font-mono ${inlineLink}`}
                        >
                          {o.reference}
                        </Link>
                      </Td>
                      <Td>{o.customerName ?? '-'}</Td>
                      <Td className="whitespace-nowrap">{formatDate(o.orderDate)}</Td>
                      <Td className="text-right">{formatNumber(o.quantity)}</Td>
                      <Td>
                        <StatusBadge status={o.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>
      </div>

      {moving && (
        <StockMovementDialog
          product={{
            id: p.id,
            sku: p.sku,
            name: p.name,
            unitPrice: p.unitPrice,
            trackStock: p.trackStock,
            stockOnHand: p.stockOnHand,
          }}
          onClose={() => setMoving(false)}
          onSaved={(balance) => {
            setMoving(false)
            setPage(1)
            onChanged(`Stock movement saved: ${formatNumber(balance)} now on hand.`)
          }}
        />
      )}
    </>
  )
}

export default function ProductDetailScreen() {
  const { id = '' } = useParams()
  return <ProductDetail key={id} id={id} />
}

function ProductDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getProduct(id), `product-${id}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(product) => (
          <ProductBody
            product={product}
            version={version}
            onChanged={(text) => {
              setNotice(text)
              setVersion((v) => v + 1)
              state.reload()
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
