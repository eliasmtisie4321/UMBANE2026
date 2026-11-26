import { AlertTriangle, CheckCircle2, Inbox, Plus, Wrench } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { inlineLink, primaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/TicketBadges'
import { Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listStaffOptions } from '@/services/maintenance'
import { getTicketCounts, listTickets, type TicketFilters } from '@/services/support'
import {
  labelOf,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketSort,
} from '@/types/support'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = ['created_at', 'last_activity_at'] as const satisfies readonly TicketSort[]
const STATUS_VALUES = ['active', ...TICKET_STATUSES.map((s) => s.value)] as const
const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Open, assigned or in progress' },
  ...TICKET_STATUSES,
]
const CATEGORY_FILTER = [{ value: '', label: 'All categories' }, ...TICKET_CATEGORIES]
const PRIORITY_FILTER = [{ value: '', label: 'All priorities' }, ...TICKET_PRIORITIES]
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

export default function SupportTicketsScreen() {
  const { profile } = useAuth()
  const isStaff = profile !== null && profile.role !== 'client'
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const category = readEnum(
    params,
    'category',
    TICKET_CATEGORIES.map((c) => c.value),
  )
  const priority = readEnum(
    params,
    'priority',
    TICKET_PRIORITIES.map((p) => p.value),
  )
  const rawAssignee = params.get('assignee') ?? ''
  const assignee =
    rawAssignee === 'me' || rawAssignee === 'unassigned' || isUuid(rawAssignee) ? rawAssignee : ''
  const { sort, ascending } = readSort(params, SORTS, 'created_at', false)
  const page = readPage(params)

  const filters: TicketFilters = {
    status,
    category: isStaff ? category : '',
    priority: isStaff ? priority : '',
    assignee: !isStaff ? '' : assignee === 'me' ? (profile?.id ?? '') : assignee,
  }
  const state = useResource(
    () => listTickets({ search, sort, ascending, page, pageSize: PAGE_SIZE }, filters),
    JSON.stringify([search, filters, sort, ascending, page]),
  )
  const counts = useResource(() => getTicketCounts(), 'ticket-counts')
  const staff = useResource(
    () => (isStaff ? listStaffOptions() : Promise.resolve({ ok: true as const, data: [] })),
    `ticket-staff-${isStaff}`,
  )
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const sortHeader = (label: string, column: TicketSort) => (
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
  const filtered = Boolean(q || status || filters.category || filters.priority || filters.assignee)

  return (
    <>
      <PageHeader
        title={isStaff ? 'Support Tickets' : 'Support'}
        subtitle={
          isStaff
            ? 'Metering faults, prepaid token problems and billing questions, through to resolution.'
            : 'Report a problem with your electricity, meter or account, and follow its progress.'
        }
        actions={
          <Link to="/support-tickets/new" className={primaryLink}>
            <Plus size={16} aria-hidden="true" /> {isStaff ? 'Create Ticket' : 'New Ticket'}
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={isStaff ? 'Open' : 'Waiting for the team'}
          icon={Inbox}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.open),
            detail: isStaff ? 'not yet assigned' : 'not yet picked up',
          })}
        />
        <StatTile
          label="In progress"
          icon={Wrench}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.assigned + c.inProgress),
            detail: `${formatNumber(c.inProgress)} being worked on`,
          })}
        />
        <StatTile
          label="Resolved"
          icon={CheckCircle2}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.resolved),
            detail: `${formatNumber(c.closed)} closed`,
          })}
        />
        <StatTile
          label="Urgent"
          icon={AlertTriangle}
          state={counts}
          map={(c) => ({
            value: formatNumber(c.urgentOpen),
            detail: 'still open',
            tone: c.urgentOpen > 0 ? 'error' : 'neutral',
          })}
        />
      </div>

      <div
        className={
          isStaff
            ? 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_11rem_10rem_12rem]'
            : 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]'
        }
      >
        <SearchField
          id="ticket-search"
          label="Search tickets"
          placeholder={isStaff ? 'Reference, subject or customer' : 'Reference or subject'}
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="ticket-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        {isStaff && (
          <>
            <Select
              id="ticket-category"
              label="Category"
              options={CATEGORY_FILTER}
              value={category}
              onChange={(e) => update({ category: e.target.value })}
            />
            <Select
              id="ticket-priority"
              label="Priority"
              options={PRIORITY_FILTER}
              value={priority}
              onChange={(e) => update({ priority: e.target.value })}
            />
            <Select
              id="ticket-assignee"
              label="Assigned to"
              options={[
                { value: '', label: 'Anyone' },
                { value: 'me', label: 'Me' },
                { value: 'unassigned', label: 'Nobody yet' },
                ...(staff.data ?? [])
                  .filter((p) => p.id !== profile?.id)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
              value={assignee}
              onChange={(e) => update({ assignee: e.target.value })}
            />
          </>
        )}
      </div>

      <ListPanel
        title={isStaff ? 'Ticket queue' : 'Your tickets'}
        noun="tickets"
        state={state}
        page={page}
        filtered={filtered}
        empty={
          <>
            <p>
              {isStaff ? 'There are no support tickets yet.' : 'You have not opened a ticket yet.'}
            </p>
            <Link to="/support-tickets/new" className={inlineLink}>
              {isStaff ? 'Create the first ticket' : 'Report a problem'}
            </Link>
          </>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Support tickets</caption>
            <thead>
              <tr>
                <Th>Ticket</Th>
                {isStaff && <Th>Customer</Th>}
                <Th>Subject</Th>
                {isStaff && <Th>Priority</Th>}
                {isStaff && <Th>Assigned to</Th>}
                {sortHeader('Opened', 'created_at')}
                {sortHeader('Last activity', 'last_activity_at')}
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">
                    <Link
                      to={`/support-tickets/${t.id}`}
                      className="font-mono text-label-md font-medium text-primary hover:underline"
                    >
                      {t.reference}
                    </Link>
                  </Td>
                  {isStaff && <Td>{t.customerName}</Td>}
                  <Td className="min-w-48">
                    {t.subject}
                    <span className="block text-label-md text-on-surface-variant">
                      {labelOf(TICKET_CATEGORIES, t.category)}
                    </span>
                  </Td>
                  {isStaff && (
                    <Td className="whitespace-nowrap">
                      <TicketPriorityBadge priority={t.priority} />
                    </Td>
                  )}
                  {isStaff && (
                    <Td className="whitespace-nowrap">
                      {t.assigneeName ?? (
                        <span className="text-on-surface-variant">Nobody yet</span>
                      )}
                    </Td>
                  )}
                  <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(t.lastActivityAt)}</Td>
                  <Td className="whitespace-nowrap">
                    <TicketStatusBadge status={t.status} />
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
