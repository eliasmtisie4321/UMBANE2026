import { CalendarClock, CheckCheck, HardHat, Hourglass, Search, Siren, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorNotice, Panel } from '@/components/dashboard/Panel'
import { StatTile } from '@/components/dashboard/StatTile'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { MaintenanceDialog } from '@/components/meters/MaintenanceDialog'
import { Badge, Button, Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getMaintenanceCounts, listMaintenance } from '@/services/maintenance'
import {
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceItem,
  type MaintenanceSort,
  type MaintenanceStatus,
} from '@/types/meters'
import { formatDate, formatNumber } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = [
  'priority_rank',
  'scheduled_for',
  'created_at',
] as const satisfies readonly MaintenanceSort[]
const PRIORITY_VALUES = MAINTENANCE_PRIORITIES.map((p) => p.value)
const STATUS_VALUES: Array<MaintenanceStatus | 'all'> = [
  ...MAINTENANCE_STATUSES.map((s) => s.value),
  'all',
]
const PRIORITY_FILTER = [{ value: '', label: 'All priorities' }, ...MAINTENANCE_PRIORITIES]
const STATUS_FILTER = [
  { value: '', label: 'Open work' },
  ...MAINTENANCE_STATUSES,
  { value: 'all', label: 'All statuses' },
]

export default function MaintenanceScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const priority = readEnum(params, 'priority', PRIORITY_VALUES)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const { sort, ascending } = readSort(params, SORTS, 'priority_rank')
  const page = readPage(params)
  const [dialog, setDialog] = useState<MaintenanceItem | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const state = useResource(
    () =>
      listMaintenance(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { priority, status: status || 'open' },
      ),
    JSON.stringify([search, priority, status, sort, ascending, page]),
  )
  const counts = useResource(() => getMaintenanceCounts(), 'maintenance-counts')

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const filtered = Boolean(q || priority || status)
  const data = state.data

  const sortHeader = (label: string, column: MaintenanceSort) => (
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
        title="Meter Maintenance"
        subtitle="Schedule and track inspections, repairs and calibration."
        back={{ to: '/electricity-meters', label: 'Electricity & Meters' }}
        actions={
          <Button onClick={() => setDialog('new')}>
            <Wrench size={16} aria-hidden="true" /> Schedule Maintenance
          </Button>
        }
      />
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          {notice}
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Scheduled"
          icon={CalendarClock}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.scheduled),
            detail: c.overdue > 0 ? `${formatNumber(c.overdue)} overdue` : undefined,
            tone: 'error',
          })}
        />
        <StatTile
          label="Pending"
          icon={Hourglass}
          state={counts}
          map={(c) => ({ value: formatNumber(c.pending) })}
        />
        <StatTile
          label="In progress"
          icon={HardHat}
          state={counts}
          map={(c) => ({ value: formatNumber(c.inProgress) })}
        />
        <StatTile
          label="Completed"
          icon={CheckCheck}
          state={counts}
          map={(c) => ({ value: formatNumber(c.completed) })}
        />
        <StatTile
          label="Urgent"
          icon={Siren}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.urgent),
            detail: c.urgent > 0 ? 'Immediate action' : undefined,
            tone: 'error',
          })}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mnt-search" className="text-label-md font-semibold text-on-surface">
            Search maintenance
          </label>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline"
            />
            <input
              id="mnt-search"
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Work order, meter, issue, property or technician"
              className="w-full rounded-md border border-outline-variant bg-surface py-2.5 pl-10 pr-3.5 text-body-md placeholder:text-placeholder"
            />
          </div>
        </div>
        <Select
          id="filter-priority"
          label="Priority"
          options={PRIORITY_FILTER}
          value={priority}
          onChange={(e) => update({ priority: e.target.value })}
        />
        <Select
          id="filter-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      <Panel title="Work orders">
        {state.status === 'loading' && (
          <div
            role="status"
            aria-label="Loading work orders"
            className="animate-pulse space-y-3 p-2"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-5 rounded bg-surface-container-high" />
            ))}
          </div>
        )}
        {state.status === 'error' && (
          <div className="mb-3">
            <ErrorNotice message={state.error.message} onRetry={state.reload} />
          </div>
        )}
        {data && data.rows.length === 0 && (
          <div className="rounded-md bg-surface-container-low px-4 py-10 text-center text-body-md text-on-surface-variant">
            <p>
              {data.total > 0
                ? 'There are no work orders on this page.'
                : filtered
                  ? 'No work orders match your search or filters.'
                  : 'There is no open maintenance work.'}
            </p>
            {filtered && (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => setParams({}, { replace: true })}
              >
                Clear search and filters
              </Button>
            )}
            {!filtered && data.total > 0 && (
              <Button variant="secondary" className="mt-3" onClick={() => update({ page: 1 })}>
                Go to the first page
              </Button>
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
              <caption className="sr-only">Work orders</caption>
              <thead>
                <tr>
                  <Th>Work order</Th>
                  <Th>Meter</Th>
                  <Th>Customer</Th>
                  <Th>Property</Th>
                  <Th>Issue</Th>
                  <Th>Technician</Th>
                  {sortHeader('Scheduled', 'scheduled_for')}
                  {sortHeader('Priority', 'priority_rank')}
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((w) => (
                  <tr key={w.id}>
                    <Td className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setDialog(w)}
                        className="font-mono text-label-md font-medium text-primary hover:underline"
                      >
                        {w.reference}
                      </button>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/electricity-meters/${w.meterId}`}
                        className="font-mono text-label-md text-secondary hover:underline"
                      >
                        {w.serialNumber}
                      </Link>
                    </Td>
                    <Td>{w.customerName ?? '-'}</Td>
                    <Td>{w.propertyName}</Td>
                    <Td>{w.issue}</Td>
                    <Td>{w.assignedName ?? '-'}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="flex flex-col items-start gap-1">
                        {w.scheduledFor ? formatDate(w.scheduledFor) : '-'}
                        {w.isOverdue && <Badge tone="error">Overdue</Badge>}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={w.priority} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <StatusBadge status={w.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPageChange={(n) => update({ page: n })}
            />
          </div>
        )}
      </Panel>

      {dialog && (
        <MaintenanceDialog
          item={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setNotice(dialog === 'new' ? 'Work order created.' : 'Work order updated.')
            setDialog(null)
            state.reload()
            counts.reload()
          }}
        />
      )}
    </>
  )
}
