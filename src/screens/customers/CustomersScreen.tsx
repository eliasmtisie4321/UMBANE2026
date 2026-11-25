import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorNotice, Panel } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { Button, Dropdown, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listCustomers, setCustomerStatus } from '@/services/customers'
import {
  CUSTOMER_STATUSES,
  SEGMENTS,
  type CustomerListItem,
  type CustomerSort,
} from '@/types/customers'
import { formatDate } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'
import { formatPhone } from '@/utils/phone'

const SORTS = ['name', 'status', 'created_at'] as const satisfies readonly CustomerSort[]
const STATUS_VALUES = CUSTOMER_STATUSES.map((s) => s.value)
const SEGMENT_VALUES = SEGMENTS.map((s) => s.value)

const STATUS_FILTER = [{ value: '', label: 'All statuses' }, ...CUSTOMER_STATUSES]
const SEGMENT_FILTER = [{ value: '', label: 'All customer types' }, ...SEGMENTS]
const segmentLabel = (v: string | null) => SEGMENTS.find((s) => s.value === v)?.label ?? '-'

const menuItem =
  'flex w-full items-center rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container'

export default function CustomersScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const segment = readEnum(params, 'segment', SEGMENT_VALUES)
  const { sort, ascending } = readSort(params, SORTS, 'name')
  const page = readPage(params)

  const state = useResource(
    () =>
      listCustomers({ search, sort, ascending, page, pageSize: PAGE_SIZE }, { status, segment }),
    JSON.stringify([search, status, segment, sort, ascending, page]),
  )

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const filtered = Boolean(q || status || segment)

  const [target, setTarget] = useState<CustomerListItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function changeStatus() {
    if (!target) return
    setBusy(true)
    const result = await setCustomerStatus(
      target.id,
      target.status === 'inactive' ? 'active' : 'inactive',
    )
    setBusy(false)
    if (result.ok) {
      setTarget(null)
      state.reload()
    } else {
      setActionError(result.error.message)
    }
  }

  const sortHeader = (label: string, column: CustomerSort) => (
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

  const data = state.data
  const total = data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={
          data
            ? `${total.toLocaleString('en-US')} ${total === 1 ? 'customer' : 'customers'}${filtered ? ' match' : ''}`
            : undefined
        }
        actions={
          <Link
            to="/customers/new"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-hover"
          >
            <Plus size={16} aria-hidden="true" /> Add Customer
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="customer-search" className="text-label-md font-semibold text-on-surface">
            Search customers
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              id="customer-search"
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Name, email, company or phone"
              className="w-full rounded-md border border-outline-variant bg-surface py-2.5 pl-10 pr-3.5 text-body-md placeholder:text-placeholder"
            />
          </div>
        </div>
        <Select
          id="customer-segment"
          label="Customer type"
          options={SEGMENT_FILTER}
          value={segment}
          onChange={(e) => update({ segment: e.target.value })}
        />
        <Select
          id="customer-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      <Panel title="Customer list" className="p-0">
        {state.status === 'loading' && (
          <div role="status" aria-label="Loading customers" className="animate-pulse space-y-3 p-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-5 rounded bg-surface-container-high" />
            ))}
          </div>
        )}
        {state.status === 'error' && state.data === null && (
          <ErrorNotice message={state.error.message} onRetry={state.reload} />
        )}
        {data && data.rows.length === 0 && (
          <div className="rounded-md bg-surface-container-low px-4 py-10 text-center text-body-md text-on-surface-variant">
            {data.total > 0 ? (
              <>
                <p>There are no customers on this page.</p>
                <Button variant="secondary" className="mt-3" onClick={() => update({ page: 1 })}>
                  Go to the first page
                </Button>
              </>
            ) : filtered ? (
              <>
                <p>No customers match your search or filters.</p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setParams({}, { replace: true })}
                >
                  Clear search and filters
                </Button>
              </>
            ) : (
              <>
                <p>You have no customers yet.</p>
                <Link
                  to="/customers/new"
                  className="mt-3 inline-block font-semibold text-secondary hover:text-primary"
                >
                  Add your first customer
                </Link>
              </>
            )}
          </div>
        )}
        {data && data.rows.length > 0 && (
          <div
            className={
              state.status === 'refreshing' ? 'opacity-60 transition-opacity' : 'transition-opacity'
            }
            aria-busy={state.status === 'refreshing'}
          >
            <Table>
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr>
                  {sortHeader('Customer', 'name')}
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Properties</Th>
                  {sortHeader('Status', 'status')}
                  {sortHeader('Added', 'created_at')}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link
                        to={`/customers/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.companyName && (
                        <p className="text-label-sm text-on-surface-variant">{c.companyName}</p>
                      )}
                    </Td>
                    <Td>{c.email ?? '-'}</Td>
                    <Td className="whitespace-nowrap">{formatPhone(c.phone)}</Td>
                    <Td>{segmentLabel(c.segment)}</Td>
                    <Td className="text-right">{c.propertyCount}</Td>
                    <Td>
                      <StatusBadge status={c.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(c.createdAt)}</Td>
                    <Td>
                      <Dropdown
                        label={`Actions for ${c.name}`}
                        trigger={<MoreHorizontal size={18} aria-hidden="true" />}
                      >
                        <Link to={`/customers/${c.id}`} className={menuItem}>
                          View profile
                        </Link>
                        <Link to={`/customers/${c.id}/edit`} className={menuItem}>
                          Edit details
                        </Link>
                        <Link to={`/properties?customer=${c.id}`} className={menuItem}>
                          Linked properties
                        </Link>
                        <button
                          type="button"
                          className={`${menuItem} ${c.status === 'inactive' ? '' : 'text-error'}`}
                          onClick={() => {
                            setActionError(null)
                            setTarget(c)
                          }}
                        >
                          {c.status === 'inactive' ? 'Reactivate account' : 'Deactivate account'}
                        </button>
                      </Dropdown>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={(p) => update({ page: p })}
            />
          </div>
        )}
        {state.status === 'error' && state.data !== null && (
          <div className="mt-3">
            <ErrorNotice message={state.error.message} onRetry={state.reload} />
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={target !== null}
        title={target?.status === 'inactive' ? 'Reactivate customer' : 'Deactivate customer'}
        confirmLabel={target?.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
        danger={target?.status !== 'inactive'}
        busy={busy}
        error={actionError}
        onConfirm={changeStatus}
        onCancel={() => setTarget(null)}
      >
        {target?.status === 'inactive' ? (
          <p>{target?.name} will be marked active again.</p>
        ) : (
          <p>
            {target?.name} will be marked inactive. Their records and history are kept, and you can
            reactivate them at any time.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
