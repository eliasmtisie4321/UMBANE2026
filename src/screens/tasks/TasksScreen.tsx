import { AlertTriangle, CheckCircle2, Clock, Plus, Wrench } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { inlineLink, primaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { TicketPriorityBadge } from '@/components/support/TicketBadges'
import { TaskStatusBadge } from '@/components/team/TeamBadges'
import { Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listStaffOptions } from '@/services/maintenance'
import { getTaskSummary, listTasks, type TaskFilters } from '@/services/tasks'
import { labelOf, TICKET_PRIORITIES } from '@/types/support'
import { TASK_CATEGORIES, TASK_STATUSES, type TaskSort } from '@/types/team'
import { formatDate, formatNumber } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'

const SORTS = ['due_date', 'created_at', 'last_activity_at'] as const satisfies readonly TaskSort[]
const STATUS_VALUES = ['active', 'overdue', ...TASK_STATUSES.map((s) => s.value)] as const
const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Pending or in progress' },
  { value: 'overdue', label: 'Overdue' },
  ...TASK_STATUSES,
]
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

export default function TasksScreen() {
  const { profile } = useAuth()
  const isManager = profile !== null && canAccess(profile.role, '/tasks/new')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const category = readEnum(
    params,
    'category',
    TASK_CATEGORIES.map((c) => c.value),
  )
  const priority = readEnum(
    params,
    'priority',
    TICKET_PRIORITIES.map((p) => p.value),
  )
  const rawAssignee = params.get('assignee') ?? ''
  const assignee =
    rawAssignee === 'me' || rawAssignee === 'unassigned' || isUuid(rawAssignee) ? rawAssignee : ''
  const { sort, ascending } = readSort(params, SORTS, 'due_date', true)
  const page = readPage(params)

  const filters: TaskFilters = {
    status,
    category,
    priority,
    assignee: !isManager ? '' : assignee === 'me' ? (profile?.id ?? '') : assignee,
  }
  const state = useResource(
    () => listTasks({ search, sort, ascending, page, pageSize: PAGE_SIZE }, filters),
    JSON.stringify([search, filters, sort, ascending, page]),
  )
  const summary = useResource(() => getTaskSummary(), 'task-summary')
  const staff = useResource(
    () => (isManager ? listStaffOptions() : Promise.resolve({ ok: true as const, data: [] })),
    `task-staff-${isManager}`,
  )
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const sortHeader = (label: string, column: TaskSort) => (
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
        title={isManager ? 'Task Management' : 'My Tasks'}
        subtitle={
          isManager
            ? 'Assign, prioritise and follow field work, audits and customer follow-ups.'
            : 'The work assigned to you. Open a task to update it.'
        }
        back={isManager ? { to: '/team', label: 'Team' } : undefined}
        actions={
          isManager ? (
            <Link to="/tasks/new" className={primaryLink}>
              <Plus size={16} aria-hidden="true" /> Create Task
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pending"
          icon={Clock}
          state={summary}
          map={(s) => ({ value: formatNumber(s.pending), detail: 'not started' })}
        />
        <StatTile
          label="In progress"
          icon={Wrench}
          state={summary}
          map={(s) => ({ value: formatNumber(s.inProgress), detail: 'being worked on' })}
        />
        <StatTile
          label="Overdue"
          icon={AlertTriangle}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.overdue),
            detail: 'past their due date',
            tone: s.overdue > 0 ? 'error' : 'neutral',
          })}
        />
        <StatTile
          label="Completed"
          icon={CheckCircle2}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.completedThisMonth),
            detail: 'this month',
          })}
        />
      </div>

      <div
        className={
          isManager
            ? 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_12rem_10rem_12rem]'
            : 'mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_12rem]'
        }
      >
        <SearchField
          id="task-search"
          label="Search tasks"
          placeholder="Reference, title or customer"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="task-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        <Select
          id="task-category"
          label="Category"
          options={[{ value: '', label: 'All categories' }, ...TASK_CATEGORIES]}
          value={category}
          onChange={(e) => update({ category: e.target.value })}
        />
        {isManager && (
          <>
            <Select
              id="task-priority"
              label="Priority"
              options={[{ value: '', label: 'All priorities' }, ...TICKET_PRIORITIES]}
              value={priority}
              onChange={(e) => update({ priority: e.target.value })}
            />
            <Select
              id="task-assignee"
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
        title={isManager ? 'All tasks' : 'Your tasks'}
        noun="tasks"
        state={state}
        page={page}
        filtered={Boolean(q || status || category || filters.priority || filters.assignee)}
        empty={
          isManager ? (
            <>
              <p>There are no tasks yet.</p>
              <Link to="/tasks/new" className={inlineLink}>
                Create the first task
              </Link>
            </>
          ) : (
            <p>Nothing is assigned to you right now.</p>
          )
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Tasks</caption>
            <thead>
              <tr>
                <Th>Task</Th>
                {isManager && <Th>Assigned to</Th>}
                <Th>Customer and property</Th>
                <Th>Priority</Th>
                {sortHeader('Due', 'due_date')}
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <Td className="min-w-56">
                    <Link
                      to={`/tasks/${t.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="block text-label-md text-on-surface-variant">
                      <span className="font-mono">{t.reference}</span> ·{' '}
                      {labelOf(TASK_CATEGORIES, t.category)}
                    </span>
                  </Td>
                  {isManager && (
                    <Td className="whitespace-nowrap">
                      {t.assigneeName ?? (
                        <span className="text-on-surface-variant">Nobody yet</span>
                      )}
                    </Td>
                  )}
                  <Td>
                    {t.customerName ?? '-'}
                    {t.propertyName && (
                      <span className="block text-label-md text-on-surface-variant">
                        {t.propertyName}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <TicketPriorityBadge priority={t.priority} />
                  </Td>
                  <Td
                    className={
                      t.isOverdue ? 'whitespace-nowrap font-medium text-error' : 'whitespace-nowrap'
                    }
                  >
                    {t.dueDate ? formatDate(t.dueDate) : '-'}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <TaskStatusBadge status={t.displayStatus} />
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
