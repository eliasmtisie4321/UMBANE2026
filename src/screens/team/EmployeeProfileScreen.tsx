import { ClipboardPlus, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { Notice } from '@/components/data/ListPanel'
import { primaryLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { EmployeeStatusBadge, TaskStatusBadge } from '@/components/team/TeamBadges'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listTasks } from '@/services/tasks'
import { getTeamMember, setEmployeeActive } from '@/services/team'
import { ROLE_LABEL } from '@/types/auth'
import { labelOf } from '@/types/support'
import { DEPARTMENTS, type TaskListItem, type TeamMember } from '@/types/team'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import { formatPhone } from '@/utils/phone'
import { onTimeRate } from '@/utils/teamForm'

function TaskLines({ rows, empty }: { rows: TaskListItem[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="py-4 text-body-md text-on-surface-variant">{empty}</p>
  }
  return (
    <ul className="divide-y divide-outline-variant">
      {rows.map((t) => (
        <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link
              to={`/tasks/${t.id}`}
              className="text-body-md font-medium text-primary hover:underline"
            >
              {t.title}
            </Link>
            <p className="text-label-md text-on-surface-variant">
              {[
                t.reference,
                t.status === 'done' && t.completedAt
                  ? `completed ${formatDateTime(t.completedAt)}`
                  : t.dueDate
                    ? `due ${formatDate(t.dueDate)}`
                    : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <TaskStatusBadge status={t.displayStatus} />
        </li>
      ))}
    </ul>
  )
}

function Profile({ member: m, onChanged }: { member: TeamMember; onChanged: (n: string) => void }) {
  const { profile } = useAuth()
  const role = profile?.role ?? 'staff'
  const isAdmin = canAccess(role, '/team/new')
  const isSelf = profile?.id === m.id
  const query = { search: '', page: 1, pageSize: 10 }
  const open = useResource(
    () =>
      listTasks(
        { ...query, sort: 'due_date', ascending: true },
        { status: 'active', category: '', priority: '', assignee: m.id },
      ),
    `employee-open-${m.id}-${m.activeTasks}`,
  )
  const done = useResource(
    () =>
      listTasks(
        { ...query, sort: 'last_activity_at', ascending: false },
        { status: 'done', category: '', priority: '', assignee: m.id },
      ),
    `employee-done-${m.id}-${m.completedTasks}`,
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rate = onTimeRate(m)

  async function toggleActive() {
    setBusy(true)
    setError(null)
    const result = await setEmployeeActive(m.id, !m.isActive)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setConfirming(false)
    onChanged(
      m.isActive ? `${m.fullName} can no longer sign in.` : `${m.fullName} can sign in again.`,
    )
  }

  return (
    <>
      <PageHeader
        title={m.fullName}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {m.employeeCode && <span className="font-mono text-on-surface">{m.employeeCode}</span>}
            <EmployeeStatusBadge status={m.employmentStatus} isActive={m.isActive} />
            <span>
              {[m.jobTitle, m.department && labelOf(DEPARTMENTS, m.department)]
                .filter(Boolean)
                .join(' · ') || ROLE_LABEL[m.role]}
            </span>
          </span>
        }
        back={{ to: '/team', label: 'Team' }}
        actions={
          <>
            {isAdmin && (
              <Link to={`/team/${m.id}/edit`} className={secondaryLink}>
                <Pencil size={16} aria-hidden="true" /> Edit Employee
              </Link>
            )}
            {isAdmin && !isSelf && (
              <Button
                variant={m.isActive ? 'danger' : 'secondary'}
                onClick={() => {
                  setError(null)
                  setConfirming(true)
                }}
              >
                {m.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
            {m.isActive && canAccess(role, '/tasks/new') && (
              <Link to={`/tasks/new?assignee=${m.id}`} className={primaryLink}>
                <ClipboardPlus size={16} aria-hidden="true" /> Assign Task
              </Link>
            )}
          </>
        }
      />
      {!m.isActive && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          This person is deactivated and cannot sign in. Their history is kept.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Contact">
          <DetailList
            items={[
              { label: 'Email', value: m.email },
              { label: 'Phone', value: m.phone && formatPhone(m.phone) },
            ]}
          />
        </Panel>
        <Panel title="Employment">
          <DetailList
            items={[
              { label: 'Department', value: m.department && labelOf(DEPARTMENTS, m.department) },
              { label: 'Job title', value: m.jobTitle },
              { label: 'Access level', value: ROLE_LABEL[m.role] },
              { label: 'Reports to', value: m.reportsToName },
              { label: 'Start date', value: m.startDate && formatDate(m.startDate) },
            ]}
          />
        </Panel>
        <Panel title="Work">
          <dl className="grid grid-cols-2 gap-4">
            {[
              ['Open tasks', formatNumber(m.activeTasks)],
              ['Overdue', formatNumber(m.overdueTasks)],
              ['Completed this month', formatNumber(m.completedThisMonth)],
              ['Finished on time', rate === null ? '-' : `${rate}%`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-md text-on-surface-variant">{label}</dt>
                <dd className="text-title-lg font-semibold tabular-nums text-on-surface">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {rate !== null && (
            <p className="mt-3 text-label-md text-on-surface-variant">
              {formatNumber(m.completedOnTime)} of {formatNumber(m.completedWithDue)} tasks with a
              due date were finished by it.
            </p>
          )}
        </Panel>

        <Panel title="Assigned tasks" subtitle="Open, soonest due first" className="lg:col-span-2">
          <ResourceBoundary state={open} skeletonLines={3}>
            {(page) => <TaskLines rows={page.rows} empty="Nothing open right now." />}
          </ResourceBoundary>
        </Panel>
        <Panel title="Recently completed">
          <ResourceBoundary state={done} skeletonLines={3}>
            {(page) => <TaskLines rows={page.rows} empty="No completed tasks yet." />}
          </ResourceBoundary>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirming}
        title={m.isActive ? `Deactivate ${m.fullName}?` : `Reactivate ${m.fullName}?`}
        confirmLabel={m.isActive ? 'Deactivate' : 'Reactivate'}
        danger={m.isActive}
        busy={busy}
        error={error}
        onConfirm={() => void toggleActive()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {m.isActive
            ? 'They lose all access straight away. Their tasks, notes and history are kept. Reassign their open tasks so nothing is missed.'
            : 'They can sign in again with the same access level.'}
        </p>
      </ConfirmDialog>
    </>
  )
}

export default function EmployeeProfileScreen() {
  const { id = '' } = useParams()
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const member = useResource(() => getTeamMember(id), `employee-${id}-${version}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={member} skeletonLines={6}>
        {(m) => (
          <Profile
            member={m}
            onChanged={(n) => {
              setNotice(n)
              setVersion((v) => v + 1)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
