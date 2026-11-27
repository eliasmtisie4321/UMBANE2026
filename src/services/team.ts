import type {
  Department,
  EmployeeUpdate,
  EmploymentStatus,
  Invitation,
  InviteInput,
  InviteResult,
  InvitationState,
  StaffRole,
  TeamMember,
} from '@/types/team'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'
import type { ServerApi } from './messages'
import { getSupabase } from './supabase'
import type { Result } from '@/types/api'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromRow = (r: Row): TeamMember => ({
  id: String(r.id),
  employeeCode: str(r.employee_code),
  fullName: str(r.full_name) || str(r.email) || 'Unnamed',
  email: str(r.email),
  phone: str(r.phone),
  role: String(r.role) as StaffRole,
  department: str(r.department) as Department | null,
  jobTitle: str(r.job_title),
  employmentStatus: (str(r.employment_status) ?? 'active') as EmploymentStatus,
  isActive: Boolean(r.is_active),
  startDate: str(r.start_date),
  reportsTo: str(r.reports_to),
  reportsToName: str(r.reports_to_name),
  activeTasks: num(r.active_tasks),
  overdueTasks: num(r.overdue_tasks),
  completedThisMonth: num(r.completed_this_month),
  completedTasks: num(r.completed_tasks),
  completedWithDue: num(r.completed_with_due),
  completedOnTime: num(r.completed_on_time),
})

/** Everyone on the team (not clients), in employee-number order. */
export const listTeam = (client?: DbClient) =>
  guarded<TeamMember[]>('Team', client, async (c) => {
    const { data, error } = await c
      .from('team_list')
      .select('*')
      .order('employee_number', { nullsFirst: false })
      .order('full_name')
      .limit(500)
    if (error) return err(mapReadError(error, 'Team'))
    return ok(((data ?? []) as Row[]).map(fromRow))
  })

export const getTeamMember = (id: string, client?: DbClient) =>
  guarded<TeamMember>('Employee', client, async (c) => {
    const { data, error } = await c.from('team_list').select('*').eq('id', id).maybeSingle()
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Employee'))
    if (error || !data) {
      return err({ code: 'not_found', message: 'This team member could not be found.' })
    }
    return ok(fromRow(data as Row))
  })

const saveProfile = (id: string, patch: Row, client?: DbClient) =>
  guarded<{ id: string }>(
    'employee',
    client,
    async (c) => {
      const { data, error } = await c.from('profiles').update(patch).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'employee'))
      if (!data || data.length === 0) {
        return err({ code: 'forbidden', message: 'Only an administrator can change this.' })
      }
      return ok({ id })
    },
    mapWriteError,
  )

/** Administrators only; the database refuses anyone else and keeps the employee number. */
export const updateEmployee = (id: string, input: EmployeeUpdate, client?: DbClient) =>
  saveProfile(
    id,
    {
      full_name: input.fullName,
      phone: input.phone,
      role: input.role,
      department: input.department,
      job_title: input.jobTitle,
      employment_status: input.employmentStatus,
      start_date: input.startDate,
      reports_to: input.reportsTo,
    },
    client,
  )

/** Deactivating removes all access at once; history stays. Nobody can deactivate themselves. */
export const setEmployeeActive = (id: string, active: boolean, client?: DbClient) =>
  saveProfile(id, { is_active: active }, client)

export const inviteStaff = (input: InviteInput, client?: DbClient) =>
  guarded<InviteResult>(
    'invitation',
    client,
    async (c) => {
      const { data, error } = await c.rpc('invite_staff', {
        p_email: input.email,
        p_full_name: input.fullName,
        p_role: input.role,
        p_phone: input.phone,
        p_department: input.department,
        p_job_title: input.jobTitle,
        p_start_date: input.startDate,
        p_reports_to: input.reportsTo,
      })
      if (error) return err(mapWriteError(error, 'invitation'))
      const r = (data ?? {}) as Row
      return ok(
        r.status === 'linked'
          ? { status: 'linked', profileId: String(r.profile_id) }
          : { status: 'invited', invitationId: String(r.invitation_id ?? '') },
      )
    },
    mapWriteError,
  )

/** Invitations not yet accepted or cancelled (waiting, sent, failed or expired). Administrators only. */
export const listInvitations = (client?: DbClient) =>
  guarded<Invitation[]>('Invitations', client, async (c) => {
    const { data, error } = await c
      .from('staff_invitation_list')
      .select(
        'id, email, full_name, role, department, job_title, created_at, state, expires_at, sent_at, sent_via, last_error',
      )
      .in('state', ['pending', 'sent', 'failed', 'expired'])
      .order('created_at', { ascending: false })
    if (error) return err(mapReadError(error, 'Invitations'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        email: String(r.email),
        fullName: String(r.full_name),
        role: String(r.role) as StaffRole,
        department: str(r.department) as Department | null,
        jobTitle: str(r.job_title),
        createdAt: String(r.created_at),
        state: (str(r.state) ?? 'pending') as InvitationState,
        expiresAt: str(r.expires_at),
        sentAt: str(r.sent_at),
        sentVia: str(r.sent_via),
        lastError: str(r.last_error),
      })),
    )
  })

export const cancelInvitation = (id: string, client?: DbClient) =>
  guarded<{ id: string }>(
    'invitation',
    client,
    async (c) => {
      const { error } = await c
        .from('staff_invitations')
        .update({ status: 'cancelled' })
        .eq('id', id)
      if (error) return err(mapWriteError(error, 'invitation'))
      return ok({ id })
    },
    mapWriteError,
  )

// Sending invitations (the server: /api/team/invitations) ------------------------------------------
export type InvitationAction = 'send' | 'resend' | 'link' | 'cancel'

export type InvitationOutcome =
  | { state: 'sent'; via: string | null }
  | { state: 'failed'; error: string }
  | { state: 'cancelled' }
  | { state: 'link'; link: string }

const defaultServer = (): ServerApi => ({
  token: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init),
})

/**
 * Sends (or sends again) an invitation through the business's connected email account, copies a
 * fresh invitation link, or cancels it. Administrators only; the server checks.
 */
export async function invitationAction(
  action: InvitationAction,
  invitationId: string,
  server: ServerApi = defaultServer(),
): Promise<Result<InvitationOutcome>> {
  const failed = (message: string) => err({ code: 'unknown', message })
  try {
    const token = await server.token()
    if (!token) return err({ code: 'unauthenticated', message: 'Please sign in again.' })
    const res = await server.fetch('/api/team/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, invitationId }),
    })
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      return failed('The server could not be reached. Please try again.')
    }
    const b = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      if (b.error === 'closed') return failed('This invitation was already accepted or cancelled.')
      if (b.error === 'forbidden') return failed('Only administrators can send invitations.')
      if (b.error === 'not_configured')
        return failed('Invitations are not set up on the server yet (APP_URL).')
      return failed(
        typeof b.message === 'string'
          ? b.message
          : 'The invitation could not be sent. Please try again.',
      )
    }
    if (action === 'link' && typeof b.link === 'string') return ok({ state: 'link', link: b.link })
    if (b.state === 'cancelled') return ok({ state: 'cancelled' })
    if (b.state === 'sent')
      return ok({ state: 'sent', via: typeof b.via === 'string' ? b.via : null })
    return ok({
      state: 'failed',
      error: typeof b.error === 'string' ? b.error : 'It could not be sent.',
    })
  } catch {
    return failed('The server could not be reached. Please try again.')
  }
}
