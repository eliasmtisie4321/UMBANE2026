import {
  CircleCheck,
  CircleOff,
  Gauge,
  MoreHorizontal,
  Plus,
  Search,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { ErrorNotice, Panel } from '@/components/dashboard/Panel'
import { StatTile } from '@/components/dashboard/StatTile'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { ConsumptionPanel } from '@/components/meters/ConsumptionPanel'
import { EstimateBadge, FlagBadge } from '@/components/meters/MeterBadges'
import { Button, Dropdown, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getMeterSummary, getTotalConsumption, listMeters } from '@/services/meters'
import { METER_STATUSES, METER_TYPES, type MeterSort } from '@/types/meters'
import { formatDate, formatKwh, formatNumber, percentOf } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = [
  'serial_number',
  'status',
  'installed_on',
  'latest_date',
] as const satisfies readonly MeterSort[]
const TYPE_VALUES = METER_TYPES.map((t) => t.value)
const STATUS_VALUES = METER_STATUSES.map((s) => s.value)
const TYPE_FILTER = [{ value: '', label: 'All meter types' }, ...METER_TYPES]
const STATUS_FILTER = [{ value: '', label: 'All statuses' }, ...METER_STATUSES]
const typeLabel = (v: string | null) => METER_TYPES.find((t) => t.value === v)?.label ?? '-'

const share = (part: number, whole: number) => {
  const pct = percentOf(part, whole)
  return pct && `${pct} of meters in service`
}

const primaryLink =
  'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-hover'
const secondaryLink =
  'inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container'
const menuItem =
  'flex w-full items-center rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container'

export default function MetersScreen() {
  const { profile } = useAuth()
  const canWrite = profile !== null && canAccess(profile.role, '/electricity-meters/new')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const type = readEnum(params, 'type', TYPE_VALUES)
  const status = readEnum(params, 'status', STATUS_VALUES)
  // Only a well-formed id may reach the query.
  const rawProperty = params.get('property') ?? ''
  const propertyId = /^[0-9a-f-]{36}$/i.test(rawProperty) ? rawProperty : ''
  const { sort, ascending } = readSort(params, SORTS, 'serial_number')
  const page = readPage(params)

  const state = useResource(
    () =>
      listMeters(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { type, status, propertyId },
      ),
    JSON.stringify([search, type, status, propertyId, sort, ascending, page]),
  )
  const summary = useResource(() => getMeterSummary(), 'meter-summary')

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const filtered = Boolean(q || type || status || propertyId)
  const data = state.data
  const total = data?.total ?? 0

  const sortHeader = (label: string, column: MeterSort, className?: string) => (
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
        title="Electricity & Meters"
        subtitle="Meters, readings and consumption"
        actions={
          canWrite && (
            <>
              <Link to="/electricity-meters/maintenance" className={secondaryLink}>
                <Wrench size={16} aria-hidden="true" /> Maintenance
              </Link>
              <Link to="/electricity-meters/readings/new" className={secondaryLink}>
                <Gauge size={16} aria-hidden="true" /> Record Reading
              </Link>
              <Link
                to={
                  propertyId
                    ? `/electricity-meters/new?property=${propertyId}`
                    : '/electricity-meters/new'
                }
                className={primaryLink}
              >
                <Plus size={16} aria-hidden="true" /> Add Meter
              </Link>
            </>
          )
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="In service"
          icon={Gauge}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.inService),
            detail: s.retired > 0 ? `${formatNumber(s.retired)} retired` : undefined,
          })}
        />
        <StatTile
          label="Active"
          icon={CircleCheck}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.active),
            detail: share(s.active, s.inService),
          })}
        />
        <StatTile
          label="Inactive"
          icon={CircleOff}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.inactive),
            detail: share(s.inactive, s.inService),
          })}
        />
        <StatTile
          label="Faulty"
          icon={TriangleAlert}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.faulty),
            detail: share(s.faulty, s.inService),
            tone: s.faulty > 0 ? 'error' : 'neutral',
          })}
        />
        <StatTile
          label="In maintenance"
          icon={Wrench}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.maintenance),
            detail: share(s.maintenance, s.inService),
            tone: s.maintenance > 0 ? 'warning' : 'neutral',
          })}
        />
      </div>

      <ConsumptionPanel
        load={() => getTotalConsumption(12)}
        resourceKey="total-consumption"
        className="mb-4"
      />

      {propertyId && (
        <p
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          <span>Showing the meters of one property.</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => update({ property: undefined })}
          >
            Show all meters
          </button>
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meter-search" className="text-label-md font-semibold text-on-surface">
            Search meters
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              id="meter-search"
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Serial number, property or customer"
              className="w-full rounded-md border border-outline-variant bg-surface py-2.5 pl-10 pr-3.5 text-body-md placeholder:text-placeholder"
            />
          </div>
        </div>
        <Select
          id="meter-type"
          label="Meter type"
          options={TYPE_FILTER}
          value={type}
          onChange={(e) => update({ type: e.target.value })}
        />
        <Select
          id="meter-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      <Panel
        title="Meter directory"
        subtitle={
          data
            ? `${formatNumber(total)} ${total === 1 ? 'meter' : 'meters'}${filtered ? ' match' : ''}`
            : undefined
        }
      >
        {state.status === 'loading' && (
          <div role="status" aria-label="Loading meters" className="animate-pulse space-y-3 p-2">
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
                <p>There are no meters on this page.</p>
                <Button variant="secondary" className="mt-3" onClick={() => update({ page: 1 })}>
                  Go to the first page
                </Button>
              </>
            ) : filtered ? (
              <>
                <p>No meters match your search or filters.</p>
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
                <p>No meters are registered yet.</p>
                {canWrite && (
                  <Link
                    to="/electricity-meters/new"
                    className="mt-3 inline-block font-semibold text-secondary hover:text-primary"
                  >
                    Add the first meter
                  </Link>
                )}
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
              <caption className="sr-only">Meters</caption>
              <thead>
                <tr>
                  {sortHeader('Serial number', 'serial_number')}
                  <Th>Type</Th>
                  <Th>Customer</Th>
                  <Th>Property</Th>
                  {sortHeader('Installed', 'installed_on')}
                  {sortHeader('Latest reading', 'latest_date')}
                  <Th className="text-right">Est. per month</Th>
                  {sortHeader('Status', 'status')}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/electricity-meters/${m.id}`}
                        className="font-mono text-label-md font-medium text-primary hover:underline"
                      >
                        {m.serialNumber}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{typeLabel(m.meterType)}</Td>
                    <Td>{m.customerName ?? '-'}</Td>
                    <Td>
                      <Link
                        to={`/properties/${m.propertyId}`}
                        className="text-secondary hover:underline"
                      >
                        {m.propertyName}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {m.installedOn ? formatDate(m.installedOn) : '-'}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {m.latestValue === null || m.latestDate === null ? (
                        '-'
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          <span>{formatKwh(m.latestValue)}</span>
                          <span className="text-label-sm text-on-surface-variant">
                            {formatDate(m.latestDate)}
                          </span>
                          {m.latestIsEstimate && <EstimateBadge />}
                          {m.latestFlag && <FlagBadge flag={m.latestFlag} />}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {m.estimatedMonthly === null
                        ? '-'
                        : formatKwh(Math.round(m.estimatedMonthly))}
                    </Td>
                    <Td>
                      <StatusBadge status={m.status} />
                    </Td>
                    <Td>
                      <Dropdown
                        label={`Actions for ${m.serialNumber}`}
                        trigger={<MoreHorizontal size={18} aria-hidden="true" />}
                      >
                        <Link to={`/electricity-meters/${m.id}`} className={menuItem}>
                          View details
                        </Link>
                        {canWrite && m.status !== 'replaced' && m.status !== 'decommissioned' && (
                          <Link
                            to={`/electricity-meters/readings/new?meter=${m.id}`}
                            className={menuItem}
                          >
                            Record reading
                          </Link>
                        )}
                        {canWrite && (
                          <Link to={`/electricity-meters/${m.id}/edit`} className={menuItem}>
                            Edit meter
                          </Link>
                        )}
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
            <p className="mt-3 text-label-md text-on-surface-variant">
              Est. per month is the average daily use over the last three reading periods, times 30
              days.
            </p>
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
