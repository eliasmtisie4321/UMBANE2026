import type {
  Department,
  EmployeeUpdate,
  EmploymentStatus,
  Invitation,
  InviteInput,
  InviteResult,
  StaffRole,
  TeamMember,
} from '@/types/team'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

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
          : { status: 'invited' },
      )
    },
    mapWriteError,
  )

/** Invitations still waiting for the person to accept. Administrators only. */
export const listInvitations = (client?: DbClient) =>
  guarded<Invitation[]>('Invitations', client, async (c) => {
    const { data, error } = await c
      .from('staff_invitations')
      .select('id, email, full_name, role, department, job_title, created_at')
      .eq('status', 'pending')
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
