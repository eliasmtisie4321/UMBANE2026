import { AlertTriangle, ClipboardList, UserCheck, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { StatTile } from '@/components/dashboard/StatTile'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { Notice, SearchField } from '@/components/data/ListPanel'
import { primaryLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { EmployeeStatusBadge } from '@/components/team/TeamBadges'
import { Select, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getTaskSummary } from '@/services/tasks'
import { InvitationRow } from '@/components/team/InvitationRow'
import { cancelInvitation, invitationAction, listInvitations, listTeam } from '@/services/team'
import { ROLE_LABEL } from '@/types/auth'
import { labelOf } from '@/types/support'
import { DEPARTMENTS, type Invitation, type TeamMember } from '@/types/team'
import { formatNumber } from '@/utils/format'
import { patchParams, readEnum } from '@/utils/listParams'
import { formatPhone } from '@/utils/phone'

const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'training', label: 'Training' },
  { value: 'inactive', label: 'Inactive' },
]
const STATUS_VALUES = ['active', 'on_leave', 'training', 'inactive'] as const

const matchesStatus = (m: TeamMember, s: string) =>
  !s || (s === 'inactive' ? !m.isActive : m.isActive && m.employmentStatus === s)

export default function TeamScreen() {
  const { profile } = useAuth()
  const isAdmin = profile !== null && canAccess(profile.role, '/team/new')
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const department = readEnum(
    params,
    'department',
    DEPARTMENTS.map((d) => d.value),
  )
  const status = readEnum(params, 'status', STATUS_VALUES)
  const [version, setVersion] = useState(0)
  const team = useResource(() => listTeam(), `team-${version}`)
  const tasks = useResource(() => getTaskSummary(), 'task-summary')
  const invites = useResource(
    () => (isAdmin ? listInvitations() : Promise.resolve({ ok: true as const, data: [] })),
    `invites-${isAdmin}-${version}`,
  )
  const [cancelling, setCancelling] = useState<Invitation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (patch: Record<string, string | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  async function cancel() {
    if (!cancelling) return
    setBusy(true)
    setError(null)
    // The server also removes the unused sign-in account the invitation link made.
    const viaServer = await invitationAction('cancel', cancelling.id)
    const result = viaServer.ok ? viaServer : await cancelInvitation(cancelling.id)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setNotice(`Invitation for ${cancelling.email} cancelled.`)
    setCancelling(null)
    setVersion((v) => v + 1)
  }

  const members = team.data ?? []
  const active = members.filter((m) => m.isActive)
  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who is on the team, where they work, and what they are working on."
        actions={
          <>
            <Link to="/tasks" className={secondaryLink}>
              <ClipboardList size={16} aria-hidden="true" /> Task Management
            </Link>
            {isAdmin && (
              <Link to="/team/new" className={primaryLink}>
                <UserPlus size={16} aria-hidden="true" /> Add Employee
              </Link>
            )}
          </>
        }
      />
      {notice && <Notice>{notice}</Notice>}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Team members"
          icon={Users}
          state={team}
          map={(t) => ({
            value: formatNumber(t.filter((m) => m.isActive).length),
            detail: `${formatNumber(t.length - t.filter((m) => m.isActive).length)} inactive`,
          })}
        />
        <StatTile
          label="Available"
          icon={UserCheck}
          state={team}
          map={(t) => {
            const on = t.filter((m) => m.isActive)
            const away = on.filter((m) => m.employmentStatus !== 'active').length
            return {
              value: formatNumber(on.length - away),
              detail: `${formatNumber(away)} on leave or in training`,
            }
          }}
        />
        <StatTile
          label="Open tasks"
          icon={ClipboardList}
          state={tasks}
          map={(s) => ({
            value: formatNumber(s.pending + s.inProgress),
            detail: `${formatNumber(s.inProgress)} in progress`,
          })}
        />
        <StatTile
          label="Overdue tasks"
          icon={AlertTriangle}
          state={tasks}
          map={(s) => ({
            value: formatNumber(s.overdue),
            detail: 'past their due date',
            tone: s.overdue > 0 ? 'error' : 'neutral',
          })}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Departments" subtitle="Active team members and their open tasks">
          <ResourceBoundary state={team} skeletonLines={4}>
            {() => (
              <ul className="divide-y divide-outline-variant">
                {[...DEPARTMENTS, { value: null, label: 'No department' }].map((d) => {
                  const people = active.filter((m) => m.department === d.value)
                  if (d.value === null && people.length === 0) return null
                  const away = people.filter((m) => m.employmentStatus !== 'active').length
                  const open = people.reduce((n, m) => n + m.activeTasks, 0)
                  return (
                    <li key={d.label} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-body-md font-medium text-on-surface">{d.label}</span>
                      <span className="text-label-md text-on-surface-variant">
                        {formatNumber(people.length)} {people.length === 1 ? 'person' : 'people'}
                        {away > 0 && `, ${formatNumber(away)} away`} · {formatNumber(open)} open{' '}
                        {open === 1 ? 'task' : 'tasks'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </ResourceBoundary>
        </Panel>
        {isAdmin && (
          <Panel
            title="Waiting to join"
            subtitle="Invitations not yet accepted: send, resend, copy the link or cancel"
          >
            <ResourceBoundary
              state={invites}
              isEmpty={(r) => r.length === 0}
              empty="No invitations are waiting."
            >
              {(rows) => (
                <ul className="divide-y divide-outline-variant">
                  {rows.map((i) => (
                    <InvitationRow
                      key={i.id}
                      invitation={i}
                      onChanged={(text) => {
                        setNotice(text)
                        setVersion((v) => v + 1)
                      }}
                      onCancel={() => {
                        setError(null)
                        setCancelling(i)
                      }}
                    />
                  ))}
                </ul>
              )}
            </ResourceBoundary>
          </Panel>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_12rem]">
        <SearchField
          id="team-search"
          label="Search team"
          placeholder="Name, email or job title"
          value={params.get('q') ?? ''}
          onChange={(v) => update({ q: v || undefined })}
        />
        <Select
          id="team-department"
          label="Department"
          options={[{ value: '', label: 'All departments' }, ...DEPARTMENTS]}
          value={department}
          onChange={(e) => update({ department: e.target.value || undefined })}
        />
        <Select
          id="team-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value || undefined })}
        />
      </div>

      <Panel title="Employees">
        <ResourceBoundary state={team} skeletonLines={6}>
          {(all) => {
            const rows = all.filter(
              (m) =>
                (!department || m.department === department) &&
                matchesStatus(m, status) &&
                (!q ||
                  [m.fullName, m.email, m.jobTitle, m.employeeCode].some((v) =>
                    v?.toLowerCase().includes(q),
                  )),
            )
            if (rows.length === 0) {
              return (
                <p className="py-6 text-center text-body-md text-on-surface-variant">
                  Nobody matches these filters.
                </p>
              )
            }
            return (
              <Table>
                <caption className="sr-only">Employees</caption>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Contact</Th>
                    <Th>Department</Th>
                    <Th>Job title</Th>
                    <Th>Access</Th>
                    <Th className="text-right">Open tasks</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <Link
                          to={`/team/${m.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {m.fullName}
                        </Link>
                        {m.employeeCode && (
                          <span className="block font-mono text-label-sm text-on-surface-variant">
                            {m.employeeCode}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="block">{m.email}</span>
                        {m.phone && (
                          <span className="block text-label-md text-on-surface-variant">
                            {formatPhone(m.phone)}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {m.department ? labelOf(DEPARTMENTS, m.department) : '-'}
                      </Td>
                      <Td>{m.jobTitle ?? '-'}</Td>
                      <Td className="whitespace-nowrap">{ROLE_LABEL[m.role]}</Td>
                      <Td className="text-right tabular-nums">
                        {formatNumber(m.activeTasks)}
                        {m.overdueTasks > 0 && (
                          <span className="block text-label-md text-error">
                            {formatNumber(m.overdueTasks)} overdue
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <EmployeeStatusBadge status={m.employmentStatus} isActive={m.isActive} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }}
        </ResourceBoundary>
      </Panel>

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this invitation?"
        confirmLabel="Cancel invitation"
        cancelLabel="Keep it"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void cancel()}
        onCancel={() => setCancelling(null)}
      >
        {cancelling && (
          <p>
            {cancelling.fullName} will not be added, and the invitation link stops working. The
            history keeps a record that it was cancelled.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
