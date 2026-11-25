import { Plus } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { primaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { StatusBadge } from '@/components/data/StatusBadge'
import { OpenActivitiesPanel } from '@/components/sales/ActivityPanels'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Badge, Select, Table, Td, Th } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getLeadTotals, listLeads } from '@/services/leads'
import { LEAD_SOURCES, LEAD_STATUSES, type LeadSort, type LeadStatus } from '@/types/sales'
import { formatDate, formatNumber, formatRand, formatRandCompact } from '@/utils/format'
import { formatPhone } from '@/utils/phone'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = [
  'created_at',
  'name',
  'estimated_value',
  'follow_up_on',
] as const satisfies readonly LeadSort[]
const SOURCE_VALUES = LEAD_SOURCES.map((s) => s.value)
const STATUS_VALUES: Array<LeadStatus | 'all'> = [...LEAD_STATUSES.map((s) => s.value), 'all']
const SOURCE_FILTER = [{ value: '', label: 'All sources' }, ...LEAD_SOURCES]
const STATUS_FILTER = [
  { value: '', label: 'Open leads' },
  ...LEAD_STATUSES,
  { value: 'all', label: 'All leads' },
]

export default function LeadsScreen() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const source = readEnum(params, 'source', SOURCE_VALUES)
  const rawOwner = params.get('owner') ?? ''
  const assignedTo = /^[0-9a-f-]{36}$/i.test(rawOwner) ? rawOwner : ''
  const { sort, ascending } = readSort(params, SORTS, 'created_at', false)
  const page = readPage(params)

  const state = useResource(
    () =>
      listLeads(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { status: status || 'open', source, assignedTo },
      ),
    JSON.stringify([search, status, source, assignedTo, sort, ascending, page]),
  )
  const totals = useResource(() => getLeadTotals(), 'lead-totals')

  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  const sortHeader = (label: string, column: LeadSort) => (
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
        title="Leads"
        subtitle="Prospective customers at every stage of the sale."
        actions={
          <Link to="/leads/new" className={primaryLink}>
            <Plus size={16} aria-hidden="true" /> Add Lead
          </Link>
        }
      />

      <Panel title="Pipeline" subtitle="Choose a stage to list its leads" className="mb-4">
        <ResourceBoundary state={totals}>
          {(rows) => (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {LEAD_STATUSES.map((s) => {
                const total = rows.find((r) => r.status === s.value)
                const active = status === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={active}
                    // Without this the parts run together for screen readers ("Lost2R100").
                    aria-label={`${s.label}: ${formatNumber(total?.count ?? 0)} leads, ${formatRandCompact(total?.value ?? 0)} value`}
                    onClick={() => update({ status: active ? undefined : s.value })}
                    className={cn(
                      'flex flex-col items-start rounded-md border px-3 py-2.5 text-left hover:bg-surface-container-low',
                      active ? 'border-secondary bg-primary-container' : 'border-outline-variant',
                    )}
                  >
                    <span className="text-label-md text-on-surface-variant">{s.label}</span>
                    <span className="text-title-lg font-bold text-on-surface">
                      {formatNumber(total?.count ?? 0)}
                    </span>
                    <span className="text-label-md text-on-surface-variant">
                      {formatRandCompact(total?.value ?? 0)} value
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </ResourceBoundary>
      </Panel>

      {profile && <OpenActivitiesPanel profileId={profile.id} />}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem]">
        <SearchField
          id="lead-search"
          label="Search leads"
          placeholder="Name, company, email, phone or reference"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="lead-status"
          label="Stage"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        <Select
          id="lead-source"
          label="Source"
          options={SOURCE_FILTER}
          value={source}
          onChange={(e) => update({ source: e.target.value })}
        />
        <StaffSelect
          id="lead-owner"
          label="Assigned to"
          emptyLabel="Everyone"
          value={assignedTo}
          onChange={(id) => update({ owner: id })}
        />
      </div>

      <ListPanel
        title="Lead list"
        noun="leads"
        state={state}
        page={page}
        filtered={Boolean(q || status || source || assignedTo)}
        empty={
          <>
            <p>There are no open leads.</p>
            <Link to="/leads/new" className="font-semibold text-secondary hover:text-primary">
              Add a lead
            </Link>
          </>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Leads</caption>
            <thead>
              <tr>
                <Th>Reference</Th>
                {sortHeader('Lead', 'name')}
                <Th>Contact</Th>
                <Th>Source</Th>
                {sortHeader('Value', 'estimated_value')}
                <Th>Assigned to</Th>
                {sortHeader('Follow-up', 'follow_up_on')}
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap font-mono text-label-md">{l.reference}</Td>
                  <Td>
                    <Link
                      to={`/leads/${l.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {l.companyName ?? l.name}
                    </Link>
                    {l.companyName && (
                      <span className="block text-label-md text-on-surface-variant">{l.name}</span>
                    )}
                  </Td>
                  <Td>{l.email ?? formatPhone(l.phone)}</Td>
                  <Td className="whitespace-nowrap">
                    {LEAD_SOURCES.find((s) => s.value === l.source)?.label ?? '-'}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {l.estimatedValue === null ? '-' : formatRand(l.estimatedValue)}
                  </Td>
                  <Td>{l.assignedName ?? '-'}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="flex flex-col items-start gap-1">
                      {l.followUpOn ? formatDate(l.followUpOn) : '-'}
                      {l.followUpOverdue && <Badge tone="error">Overdue</Badge>}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={l.status} />
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
