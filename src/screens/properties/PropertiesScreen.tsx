import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorNotice, Panel } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { Button, Dropdown, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listProperties } from '@/services/properties'
import { PROPERTY_STATUSES, PROPERTY_TYPES, type PropertySort } from '@/types/properties'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = ['name', 'status', 'created_at'] as const satisfies readonly PropertySort[]
const TYPE_VALUES = PROPERTY_TYPES.map((t) => t.value)
const STATUS_VALUES = PROPERTY_STATUSES.map((s) => s.value)
const TYPE_FILTER = [{ value: '', label: 'All property types' }, ...PROPERTY_TYPES]
const STATUS_FILTER = [{ value: '', label: 'All statuses' }, ...PROPERTY_STATUSES]
const typeLabel = (v: string | null) => PROPERTY_TYPES.find((t) => t.value === v)?.label ?? '-'

const menuItem =
  'flex w-full items-center rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container'

export default function PropertiesScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const type = readEnum(params, 'type', TYPE_VALUES)
  const status = readEnum(params, 'status', STATUS_VALUES)
  // Only a well-formed id may reach the query.
  const rawCustomer = params.get('customer') ?? ''
  const customerId = /^[0-9a-f-]{36}$/i.test(rawCustomer) ? rawCustomer : ''
  const { sort, ascending } = readSort(params, SORTS, 'name')
  const page = readPage(params)

  const state = useResource(
    () =>
      listProperties(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { type, status, customerId },
      ),
    JSON.stringify([search, type, status, customerId, sort, ascending, page]),
  )

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const filtered = Boolean(q || type || status || customerId)
  const data = state.data
  const total = data?.total ?? 0

  const sortHeader = (label: string, column: PropertySort) => (
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
        title="Properties"
        subtitle={
          data
            ? `${total.toLocaleString('en-US')} ${total === 1 ? 'property' : 'properties'}${filtered ? ' match' : ''}`
            : undefined
        }
        actions={
          <Link
            to={customerId ? `/properties/new?customer=${customerId}` : '/properties/new'}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-hover"
          >
            <Plus size={16} aria-hidden="true" /> Register Property
          </Link>
        }
      />

      {customerId && (
        <p
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          <span>Showing the properties of one customer.</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => update({ customer: undefined })}
          >
            Show all properties
          </button>
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="property-search" className="text-label-md font-semibold text-on-surface">
            Search properties
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              id="property-search"
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Name, ID, address, suburb or city"
              className="w-full rounded-md border border-outline-variant bg-surface py-2.5 pl-10 pr-3.5 text-body-md placeholder:text-placeholder"
            />
          </div>
        </div>
        <Select
          id="property-type"
          label="Property type"
          options={TYPE_FILTER}
          value={type}
          onChange={(e) => update({ type: e.target.value })}
        />
        <Select
          id="property-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      <Panel title="Property list" className="p-0">
        {state.status === 'loading' && (
          <div
            role="status"
            aria-label="Loading properties"
            className="animate-pulse space-y-3 p-2"
          >
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
                <p>There are no properties on this page.</p>
                <Button variant="secondary" className="mt-3" onClick={() => update({ page: 1 })}>
                  Go to the first page
                </Button>
              </>
            ) : filtered ? (
              <>
                <p>No properties match your search or filters.</p>
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
                <p>No properties are registered yet.</p>
                <Link
                  to="/properties/new"
                  className="mt-3 inline-block font-semibold text-secondary hover:text-primary"
                >
                  Register the first property
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
              <caption className="sr-only">Properties</caption>
              <thead>
                <tr>
                  <Th>Property ID</Th>
                  {sortHeader('Property', 'name')}
                  <Th>Owner</Th>
                  <Th>Address</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="text-right">Meters</Th>
                  {sortHeader('Status', 'status')}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap font-mono text-label-md">
                      {p.reference ?? '-'}
                    </Td>
                    <Td>
                      <Link
                        to={`/properties/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.name ?? p.address}
                      </Link>
                    </Td>
                    <Td>{p.ownerName ?? '-'}</Td>
                    <Td>{[p.address, p.suburb, p.city].filter(Boolean).join(', ')}</Td>
                    <Td>{typeLabel(p.propertyType)}</Td>
                    <Td className="text-right">{p.units ?? '-'}</Td>
                    <Td className="text-right">{p.meterCount}</Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td>
                      <Dropdown
                        label={`Actions for ${p.name ?? p.address}`}
                        trigger={<MoreHorizontal size={18} aria-hidden="true" />}
                      >
                        <Link to={`/properties/${p.id}`} className={menuItem}>
                          View details
                        </Link>
                        <Link to={`/properties/${p.id}/edit`} className={menuItem}>
                          Edit property
                        </Link>
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
              onPageChange={(n) => update({ page: n })}
            />
          </div>
        )}
        {state.status === 'error' && state.data !== null && (
          <div className="mt-3">
            <ErrorNotice message={state.error.message} onRetry={state.reload} />
          </div>
        )}
      </Panel>
    </>
  )
}
