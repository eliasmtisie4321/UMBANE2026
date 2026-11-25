import { CircleCheck, CircleX, ClipboardCheck, Hourglass, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { MonthlyChart } from '@/components/dashboard/MonthlyChart'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { inlineLink, primaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { Button, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getMonthlySales, getSalesSummary, listOrders } from '@/services/orders'
import { ORDER_STATUSES, type OrderListItem, type OrderSort } from '@/types/sales'
import { businessToday } from '@/utils/consumption'
import { formatDate, formatNumber, formatRand, formatRandCompact } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'
import { PERIODS, periodRange, type Period } from '@/utils/period'

const SORTS = ['order_date', 'number', 'total', 'status'] as const satisfies readonly OrderSort[]
const STATUS_VALUES = ORDER_STATUSES.map((s) => s.value)
const PERIOD_VALUES = PERIODS.map((p) => p.value).filter((v): v is Exclude<Period, ''> => v !== '')
const STATUS_FILTER = [{ value: '', label: 'All statuses' }, ...ORDER_STATUSES]

const itemsLabel = (o: OrderListItem) =>
  o.firstItem === null
    ? 'No lines'
    : o.itemCount > 1
      ? `${o.firstItem} + ${o.itemCount - 1} more`
      : o.firstItem

function SalesPanel() {
  const state = useResource(() => getMonthlySales(12), 'monthly-sales')
  const [asTable, setAsTable] = useState(false)
  return (
    <Panel
      title="Sales"
      subtitle="Fulfilled orders per month, excluding VAT (ZAR)"
      className="mb-4"
      action={
        <Button
          variant="secondary"
          aria-pressed={asTable}
          onClick={() => setAsTable((t) => !t)}
          className="px-3 py-1.5"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </Button>
      }
    >
      <ResourceBoundary
        state={state}
        skeletonLines={5}
        isEmpty={(rows) => rows.every((r) => r.total === 0)}
        empty="Sales appear once an order has been fulfilled."
      >
        {(rows) => (
          <MonthlyChart
            points={rows}
            asTable={asTable}
            measure="Sales"
            caption="Sales per month, excluding VAT"
            format={formatRand}
            formatAxis={formatRandCompact}
          />
        )}
      </ResourceBoundary>
    </Panel>
  )
}

export default function OrdersScreen() {
  const { profile } = useAuth()
  const canWrite = profile !== null && canAccess(profile.role, '/sales-orders/new')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const period = readEnum(params, 'period', PERIOD_VALUES)
  // Only a well-formed id may reach the query.
  const rawCustomer = params.get('customer') ?? ''
  const customerId = /^[0-9a-f-]{36}$/i.test(rawCustomer) ? rawCustomer : ''
  const { sort, ascending } = readSort(params, SORTS, 'order_date', false)
  const page = readPage(params)
  const range = periodRange(period, businessToday())

  const state = useResource(
    () =>
      listOrders(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { status, customerId, ...range },
      ),
    JSON.stringify([search, status, customerId, range, sort, ascending, page]),
  )
  const summary = useResource(() => getSalesSummary(), 'sales-summary')

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  const sortHeader = (label: string, column: OrderSort) => (
    <SortableTh
      label={label}
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
        title="Sales & Orders"
        subtitle={canWrite ? 'Orders, their progress and completed sales.' : 'Your orders.'}
        actions={
          canWrite && (
            <Link
              to={customerId ? `/sales-orders/new?customer=${customerId}` : '/sales-orders/new'}
              className={primaryLink}
            >
              <Plus size={16} aria-hidden="true" /> Create Order
            </Link>
          )
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pending orders"
          icon={Hourglass}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.pendingCount),
            detail: `${formatRand(s.pendingValue)} including VAT`,
          })}
        />
        <StatTile
          label="Confirmed orders"
          icon={ClipboardCheck}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.confirmedCount),
            detail: `${formatRand(s.confirmedValue)} including VAT`,
          })}
        />
        <StatTile
          label="Fulfilled orders"
          icon={CircleCheck}
          state={summary}
          map={(s) => ({ value: formatNumber(s.fulfilledCount) })}
        />
        <StatTile
          label="Cancelled orders"
          icon={CircleX}
          state={summary}
          map={(s) => ({ value: formatNumber(s.cancelledCount) })}
        />
      </div>

      {canWrite && <SalesPanel />}

      {customerId && (
        <p
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          <span>Showing the orders of one customer.</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => update({ customer: undefined })}
          >
            Show all orders
          </button>
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <SearchField
          id="order-search"
          label="Search orders"
          placeholder="Order, customer, product or employee"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="order-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        <Select
          id="order-period"
          label="Order date"
          options={PERIODS}
          value={period}
          onChange={(e) => update({ period: e.target.value })}
        />
      </div>

      <ListPanel
        title="Orders"
        noun="orders"
        state={state}
        page={page}
        filtered={Boolean(q || status || period || customerId)}
        empty={
          <>
            <p>There are no orders yet.</p>
            {canWrite && (
              <Link to="/sales-orders/new" className={inlineLink}>
                Create the first order
              </Link>
            )}
          </>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Orders</caption>
            <thead>
              <tr>
                {sortHeader('Order', 'number')}
                <Th>Customer</Th>
                {sortHeader('Date', 'order_date')}
                <Th>Products and services</Th>
                {sortHeader('Total', 'total')}
                {canWrite && <Th>Assigned to</Th>}
                {sortHeader('Status', 'status')}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td className="whitespace-nowrap">
                    <Link
                      to={`/sales-orders/${o.id}`}
                      className="font-mono text-label-md font-medium text-primary hover:underline"
                    >
                      {o.reference}
                    </Link>
                  </Td>
                  <Td>{o.customerName}</Td>
                  <Td className="whitespace-nowrap">{formatDate(o.orderDate)}</Td>
                  <Td>{itemsLabel(o)}</Td>
                  <Td className="whitespace-nowrap">{formatRand(o.total, { cents: true })}</Td>
                  {canWrite && <Td>{o.assignedName ?? '-'}</Td>}
                  <Td>
                    <StatusBadge status={o.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ListPanel>
    </>
  )
}
