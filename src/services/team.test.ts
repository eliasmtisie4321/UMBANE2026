import { describe, expect, it, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { TaskInput } from '@/types/team'
import type { StorageApi } from './storageFiles'
import {
  createTask,
  getTask,
  getTaskSummary,
  listTasks,
  postTaskUpdate,
  setTaskStatus,
  updateTask,
  uploadTaskFile,
} from './tasks'
import {
  cancelInvitation,
  getTeamMember,
  inviteStaff,
  listInvitations,
  listTeam,
  setEmployeeActive,
  updateEmployee,
} from './team'

const invite = {
  email: 'lerato@umbane.co.za',
  fullName: 'Lerato Khumalo',
  phone: '+27831234567',
  role: 'staff' as const,
  department: 'customer_support' as const,
  jobTitle: 'Support Agent',
  startDate: '2026-12-01',
  reportsTo: null,
}

describe('team', () => {
  it('maps the team list with workload', async () => {
    const { client, log } = fake({
      team_list: {
        data: [
          {
            id: 'a3',
            employee_code: 'EMP-003',
            full_name: 'Sam Staff',
            email: 's@x',
            role: 'staff',
            department: 'field_operations',
            employment_status: 'on_leave',
            is_active: true,
            active_tasks: 2,
            completed_on_time: '3',
            completed_with_due: 4,
          },
        ],
      },
    })
    const r = await listTeam(client)
    expect(log[0].ops).toContain('order("employee_number",{"nullsFirst":false})')
    expect(r.ok && r.data[0]).toMatchObject({
      employeeCode: 'EMP-003',
      employmentStatus: 'on_leave',
      activeTasks: 2,
      completedOnTime: 3,
    })
  })

  it('treats a missing or malformed member as not found', async () => {
    const r = await getTeamMember('x', fake({ team_list: { error: { code: '22P02' } } }).client)
    expect(r.ok ? null : r.error.code).toBe('not_found')
  })

  it('invites through the database, which says whether they were added at once', async () => {
    const linked = fake({ 'rpc:invite_staff': { data: { status: 'linked', profile_id: 'p9' } } })
    const r = await inviteStaff(invite, linked.client)
    expect(r.ok && r.data).toEqual({ status: 'linked', profileId: 'p9' })
    expect(linked.log[0].ops[0]).toContain('"p_email":"lerato@umbane.co.za"')
    expect(linked.log[0].ops[0]).toContain('"p_department":"customer_support"')
    const waiting = fake({
      'rpc:invite_staff': { data: { status: 'invited', invitation_id: 'i9' } },
    })
    expect(await inviteStaff(invite, waiting.client)).toEqual({
      ok: true,
      data: { status: 'invited', invitationId: 'i9' },
    })
  })

  it.each([
    ['staff_email_taken', 'email', /already belongs/],
    ['staff_already_invited', 'email', /already been invited/],
    ['staff_invitations_phone_check', 'phone', /South African/],
  ])('explains %s on its field', async (message, field, text) => {
    const r = await inviteStaff(
      invite,
      fake({ 'rpc:invite_staff': { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('saves employment details, and says so when nothing could be changed', async () => {
    const { client, log } = fake({ profiles: { data: [{ id: 'a3' }] } })
    await updateEmployee('a3', { ...invite, employmentStatus: 'training' }, client)
    expect(log[0].ops[0]).toContain('"employment_status":"training"')
    expect(log[0].ops[0]).not.toContain('email')
    const blocked = await setEmployeeActive('a3', false, fake({ profiles: { data: [] } }).client)
    expect(blocked.ok ? null : blocked.error.code).toBe('forbidden')
  })

  it('explains a self-lockout', async () => {
    const r = await setEmployeeActive(
      'me',
      false,
      fake({ profiles: { error: { code: '23514', message: 'staff_self_lockout' } } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(/cannot deactivate yourself/)
  })

  it('lists open invitations (not accepted or cancelled) and cancels one', async () => {
    const list = fake({ staff_invitation_list: { data: [] } })
    await listInvitations(list.client)
    expect(list.log[0].ops).toContain('in("state",["pending","sent","failed","expired"])')
    const c = fake({ staff_invitations: {} })
    await cancelInvitation('i1', c.client)
    expect(c.log[0].ops[0]).toBe('update({"status":"cancelled"})')
  })
})

const task: TaskInput = {
  title: 'Replace faceplate',
  description: null,
  category: 'field_maintenance',
  priority: 'high',
  assignedTo: 's1',
  startDate: null,
  dueDate: '2026-12-01',
  proofRequired: true,
  customerId: null,
  propertyId: null,
  ticketId: 't1',
}

describe('tasks', () => {
  it('filters active, overdue, by person, ticket and category', async () => {
    const q = { search: 'MTR', sort: 'due_date' as const, ascending: true, page: 1, pageSize: 25 }
    const a = fake({ task_list: { data: [], count: 0 } })
    await listTasks(
      q,
      {
        status: 'active',
        category: 'billing_audit',
        priority: '',
        assignee: 'unassigned',
        ticketId: 't1',
      },
      a.client,
    )
    for (const op of [
      'in("status",["todo","in_progress"])',
      'eq("category","billing_audit")',
      'is("assigned_to",null)',
      'eq("ticket_id","t1")',
      'order("due_date",{"ascending":true,"nullsFirst":false})',
    ])
      expect(a.log[0].ops).toContain(op)
    expect(a.log[0].ops.join()).toMatch(/reference\.ilike.*title\.ilike/)
    const b = fake({ task_list: { data: [], count: 0 } })
    await listTasks(
      q,
      { status: 'overdue', category: '', priority: 'urgent', assignee: 's1' },
      b.client,
    )
    expect(b.log[0].ops).toContain('eq("is_overdue",true)')
    expect(b.log[0].ops).toContain('eq("assigned_to","s1")')
  })

  it('maps a task, keeping its display status and proof rule', async () => {
    const { client } = fake({
      task_list: {
        data: {
          id: 'k1',
          reference: 'TSK-00001',
          title: 'T',
          category: 'other',
          status: 'todo',
          display_status: 'overdue',
          priority: 'normal',
          is_overdue: true,
          proof_required: true,
          photo_count: 0,
          last_activity_at: 'x',
          created_at: 'y',
        },
      },
    })
    const r = await getTask('k1', client)
    expect(r.ok && r.data).toMatchObject({
      displayStatus: 'overdue',
      isOverdue: true,
      proofRequired: true,
      photoCount: 0,
    })
  })

  it('creates with a starting status, and never sends one when editing', async () => {
    const c = fake({ staff_tasks: { data: { id: 'k1' } } })
    await createTask({ ...task, status: 'todo' }, c.client)
    expect(c.log[0].ops[0]).toContain('"status":"todo"')
    expect(c.log[0].ops[0]).not.toContain('created_by')
    const u = fake({ staff_tasks: { data: [{ id: 'k1' }] } })
    await updateTask('k1', { ...task, status: 'in_progress' }, u.client)
    expect(u.log[0].ops[0]).not.toContain('status')
  })

  it('sends a reason only when cancelling', async () => {
    const { client, log } = fake({ staff_tasks: { data: [{ id: 'k1' }] } })
    await setTaskStatus('k1', 'cancelled', ' Customer moved ', client)
    await setTaskStatus('k1', 'done', null, client)
    expect(log[0].ops[0]).toBe('update({"status":"cancelled","cancel_reason":"Customer moved"})')
    expect(log[1].ops[0]).toBe('update({"status":"done"})')
  })

  it.each([
    ['task_proof_required', /photo of the finished work/],
    ['task_manager_only', /Only a manager/],
    ['task_closed', /reopen it first/],
  ])('explains %s', async (message, text) => {
    const r = await setTaskStatus(
      'k1',
      'done',
      null,
      fake({ staff_tasks: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('posts an update without an author: the database takes the person signed in', async () => {
    const { client, log } = fake({ task_updates: { data: { id: 'u1' } } })
    await postTaskUpdate('k1', ' Faceplate replaced ', client)
    expect(log[0].ops[0]).toBe('insert({"task_id":"k1","body":"Faceplate replaced"})')
  })

  it('uploads proof to the task bucket and refuses other file types', async () => {
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
    const from = vi.fn(() => ({ upload }))
    const storage = { from } as unknown as StorageApi
    const { client, log } = fake({ task_attachments: { data: { id: 'f1' } } })
    const r = await uploadTaskFile({ id: 'k1', businessId: 'b1' }, new File(['x'], 'After.JPG'), {
      client,
      storage,
    })
    expect(r.ok).toBe(true)
    expect(from).toHaveBeenCalledWith('task-attachments')
    expect(upload.mock.calls[0][0]).toMatch(/^b1\/k1\/[^/]+-After\.jpg$/)
    expect(log[0].ops[0]).toContain('"task_id":"k1"')
    const csv = await uploadTaskFile({ id: 'k1', businessId: 'b1' }, new File(['x'], 'log.csv'), {
      storage,
    })
    expect(csv.ok).toBe(false)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('shows zeros before any task exists', async () => {
    const r = await getTaskSummary(fake({ task_summary: { data: null } }).client)
    expect(r.ok && r.data).toEqual({
      pending: 0,
      inProgress: 0,
      overdue: 0,
      completedThisMonth: 0,
      completed: 0,
      cancelled: 0,
    })
  })
})
