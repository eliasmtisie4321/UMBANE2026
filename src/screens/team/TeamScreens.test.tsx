import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as customerService from '@/services/customers'
import * as maintenanceService from '@/services/maintenance'
import * as notificationService from '@/services/notifications'
import * as orderService from '@/services/orders'
import * as propertyService from '@/services/properties'
import * as supportService from '@/services/support'
import * as taskService from '@/services/tasks'
import * as teamService from '@/services/team'
import type { UserRole } from '@/types/auth'
import type { Task, TaskListItem, TeamMember } from '@/types/team'
import { err, ok } from '@/utils/result'

vi.mock('@/services/team')
vi.mock('@/services/tasks')
vi.mock('@/services/maintenance')
vi.mock('@/services/notifications')
vi.mock('@/services/properties')
vi.mock('@/services/customers')
vi.mock('@/services/orders')
vi.mock('@/services/support')

const team = vi.mocked(teamService)
const tasks = vi.mocked(taskService)

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 's1',
  employeeCode: 'EMP-004',
  fullName: 'Sipho Khumalo',
  email: 'sipho@umbane.co.za',
  phone: '+27823104412',
  role: 'staff',
  department: 'field_operations',
  jobTitle: 'Senior Technician',
  employmentStatus: 'active',
  isActive: true,
  startDate: '2023-03-15',
  reportsTo: 'u1',
  reportsToName: 'Test User',
  activeTasks: 3,
  overdueTasks: 1,
  completedThisMonth: 4,
  completedTasks: 9,
  completedWithDue: 6,
  completedOnTime: 4,
  ...over,
})
const row = (over: Partial<TaskListItem> = {}): TaskListItem => ({
  id: 'k1',
  reference: 'TSK-00412',
  title: 'Inspect Midrand breaker',
  category: 'field_maintenance',
  status: 'in_progress',
  displayStatus: 'in_progress',
  priority: 'high',
  startDate: null,
  dueDate: '2026-11-28',
  isOverdue: false,
  assignedTo: 'u1',
  assigneeName: 'Test User',
  customerId: 'c1',
  customerName: 'Thabo Mokoena',
  propertyId: 'p1',
  propertyName: 'Sandton Heights 14B',
  ticketId: null,
  ticketReference: null,
  completedAt: null,
  lastActivityAt: '2026-11-25T08:00:00Z',
  ...over,
})
const task = (over: Partial<Task> = {}): Task => ({
  ...row(),
  description: '3-phase breaker trip check.',
  proofRequired: true,
  createdBy: 'm1',
  createdByName: 'Mia Manager',
  createdAt: '2026-11-24T08:00:00Z',
  startedAt: '2026-11-25T07:00:00Z',
  completedBy: null,
  completedByName: null,
  cancelReason: null,
  updateCount: 0,
  photoCount: 0,
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  team.listTeam.mockResolvedValue(
    ok([
      member(),
      member({
        id: 's2',
        employeeCode: 'EMP-011',
        fullName: 'Thandiwe Moyo',
        department: 'customer_support',
        jobTitle: 'Support Lead',
        employmentStatus: 'on_leave',
        activeTasks: 0,
        overdueTasks: 0,
      }),
      member({ id: 's3', employeeCode: 'EMP-002', fullName: 'Old Hand', isActive: false }),
    ]),
  )
  team.getTeamMember.mockImplementation(() => Promise.resolve(ok(member())))
  team.listInvitations.mockResolvedValue(
    ok([
      {
        id: 'i1',
        email: 'lerato@umbane.co.za',
        fullName: 'Lerato Dlamini',
        role: 'staff',
        department: 'sales_billing',
        jobTitle: null,
        createdAt: '2026-11-20T08:00:00Z',
        state: 'sent',
        expiresAt: '2026-11-27T08:00:00Z',
        sentAt: '2026-11-20T08:01:00Z',
        sentVia: 'Gmail / Google Workspace (hr@umbane.co.za)',
        lastError: null,
      },
    ]),
  )
  tasks.getTaskSummary.mockResolvedValue(
    ok({
      pending: 14,
      inProgress: 18,
      overdue: 4,
      completedThisMonth: 28,
      completed: 90,
      cancelled: 2,
    }),
  )
  tasks.listTasks.mockResolvedValue(ok({ rows: [row()], total: 1 }))
  tasks.getTask.mockImplementation(() => Promise.resolve(ok(task())))
  tasks.listTaskUpdates.mockResolvedValue(ok([]))
  tasks.listTaskEvents.mockResolvedValue(ok([]))
  tasks.listTaskFiles.mockResolvedValue(ok([]))
  tasks.taskFileUrls.mockResolvedValue(ok({}))
  vi.mocked(maintenanceService.listStaffOptions).mockResolvedValue(
    ok([
      { id: 'u1', name: 'Test User' },
      { id: 's1', name: 'Sipho Khumalo' },
    ]),
  )
  vi.mocked(propertyService.searchCustomerOptions).mockResolvedValue(ok([]))
  vi.mocked(orderService.getCustomerPropertyOptions).mockResolvedValue(
    ok([{ id: 'p1', name: 'Sandton Heights 14B', detail: '' }]),
  )
  vi.mocked(customerService.getCustomerTickets).mockResolvedValue(
    ok([
      {
        id: 'a0200000-0000-0000-0000-000000000001',
        reference: 'TKT-2026-00418',
        subject: 'Breaker trip',
        status: 'open',
        priority: 'urgent',
        createdAt: 'x',
      },
    ]),
  )
})

const open = (route: string, role: UserRole = 'administrator') =>
  renderAt(<App />, signedInAs(role), route)

describe('team page', () => {
  it('shows the team, departments, workload and invitations to an administrator', async () => {
    open('/team')
    const table = await screen.findByRole('table', { name: 'Employees' })
    const tr = within(table).getByRole('link', { name: 'Sipho Khumalo' }).closest('tr')!
    for (const text of ['EMP-004', 'Field Operations', 'Senior Technician', '1 overdue', 'Active'])
      expect(within(tr).getByText(text)).toBeInTheDocument()
    expect(within(table).getByText('On Leave')).toBeInTheDocument()
    expect(within(table).getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByText('Lerato Dlamini')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add Employee/ })).toHaveAttribute('href', '/team/new')
  })

  it('filters by status and searches', async () => {
    open('/team?status=inactive')
    const table = await screen.findByRole('table', { name: 'Employees' })
    expect(within(table).getByText('Old Hand')).toBeInTheDocument()
    expect(within(table).queryByText('Sipho Khumalo')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Status'), '')
    await userEvent.type(screen.getByLabelText('Search team'), 'support lead')
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Employees' })).getByText('Thandiwe Moyo'),
      ).toBeInTheDocument(),
    )
    expect(
      within(screen.getByRole('table', { name: 'Employees' })).queryByText('Old Hand'),
    ).toBeNull()
  })

  it('shows how each invitation was sent', async () => {
    open('/team')
    expect(await screen.findByText('Sent')).toBeInTheDocument()
    expect(
      screen.getByText('Through Gmail / Google Workspace (hr@umbane.co.za)'),
    ).toBeInTheDocument()
  })

  it('cancels an invitation on the server, which also removes the unused sign-in', async () => {
    team.invitationAction.mockResolvedValue(ok({ state: 'cancelled' }))
    open('/team')
    await userEvent.click(
      await screen.findByRole('button', { name: /Cancel invitation for lerato@umbane.co.za/ }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel invitation' }),
    )
    expect(
      await screen.findByText('Invitation for lerato@umbane.co.za cancelled.'),
    ).toBeInTheDocument()
    expect(team.invitationAction).toHaveBeenCalledWith('cancel', 'i1')
    expect(team.cancelInvitation).not.toHaveBeenCalled()
  })

  it('still cancels when the server cannot be reached', async () => {
    team.invitationAction.mockResolvedValue(err({ code: 'unknown', message: 'unreachable' }))
    team.cancelInvitation.mockResolvedValue(ok({ id: 'i1' }))
    open('/team')
    await userEvent.click(
      await screen.findByRole('button', { name: /Cancel invitation for lerato@umbane.co.za/ }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel invitation' }),
    )
    expect(
      await screen.findByText('Invitation for lerato@umbane.co.za cancelled.'),
    ).toBeInTheDocument()
    expect(team.cancelInvitation).toHaveBeenCalledWith('i1')
  })

  it('resends an invitation', async () => {
    team.invitationAction.mockResolvedValue(
      ok({ state: 'sent', via: 'Gmail / Google Workspace (hr@umbane.co.za)' }),
    )
    open('/team')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resend invitation to lerato@umbane.co.za' }),
    )
    expect(
      await screen.findByText(
        'Invitation sent to lerato@umbane.co.za through Gmail / Google Workspace (hr@umbane.co.za).',
      ),
    ).toBeInTheDocument()
    expect(team.invitationAction).toHaveBeenCalledWith('resend', 'i1')
  })

  it('shows a manager the team without invitations or adding people', async () => {
    open('/team', 'manager')
    await screen.findByRole('table', { name: 'Employees' })
    expect(screen.queryByRole('link', { name: /Add Employee/ })).toBeNull()
    expect(team.listInvitations).not.toHaveBeenCalled()
    open('/team/new', 'manager')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })

  it('keeps staff out of the team pages but gives them their tasks', async () => {
    open('/team', 'staff')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Team' })).toBeNull()
  })
})

describe('adding employees', () => {
  async function fill() {
    await userEvent.type(await screen.findByLabelText('Full name'), 'Lerato Khumalo')
    await userEvent.type(screen.getByLabelText('Work email'), 'Lerato@Umbane.co.za')
    await userEvent.type(screen.getByLabelText('Phone (optional)'), '083 123 4567')
    await userEvent.selectOptions(screen.getByLabelText('Department'), 'customer_support')
    await userEvent.selectOptions(screen.getByLabelText('Access level'), 'manager')
  }

  it('saves the invitation and emails it through the business’s email account', async () => {
    team.inviteStaff.mockResolvedValue(ok({ status: 'invited', invitationId: 'i9' }))
    team.invitationAction.mockResolvedValue(
      ok({ state: 'sent', via: 'Gmail / Google Workspace (hr@umbane.co.za)' }),
    )
    open('/team/new')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /Add Employee/ }))
    expect(await screen.findByRole('heading', { name: 'Invitation' })).toBeInTheDocument()
    expect(await screen.findByText(/through Gmail \/ Google Workspace/)).toBeInTheDocument()
    expect(screen.getByText('lerato@umbane.co.za')).toBeInTheDocument()
    expect(team.invitationAction).toHaveBeenCalledWith('send', 'i9')
    expect(team.inviteStaff).toHaveBeenCalledWith({
      email: 'lerato@umbane.co.za',
      fullName: 'Lerato Khumalo',
      phone: '+27831234567',
      role: 'manager',
      department: 'customer_support',
      jobTitle: null,
      startDate: null,
      reportsTo: null,
    })
  })

  it('explains a failed invitation email and offers the link instead', async () => {
    team.inviteStaff.mockResolvedValue(ok({ status: 'invited', invitationId: 'i9' }))
    team.invitationAction.mockImplementation(async (action) =>
      action === 'link'
        ? ok({ state: 'link', link: 'https://x.supabase.co/auth/v1/verify?token=abc' })
        : ok({ state: 'failed', error: 'No Email account is connected.' }),
    )
    open('/team/new')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /Add Employee/ }))
    expect(
      await screen.findByText(/could not be emailed: No Email account is connected/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy Invitation Link' }))
    expect(
      await screen.findByText('https://x.supabase.co/auth/v1/verify?token=abc'),
    ).toBeInTheDocument()
  })

  it('goes straight to the profile when they already have an account', async () => {
    team.inviteStaff.mockResolvedValue(ok({ status: 'linked', profileId: 's1' }))
    open('/team/new')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /Add Employee/ }))
    expect(
      await screen.findByText('Lerato Khumalo has been added to the team.'),
    ).toBeInTheDocument()
  })

  it('shows a taken email on the email field', async () => {
    team.inviteStaff.mockResolvedValue(
      err({
        code: 'validation',
        field: 'email',
        message: 'This email already belongs to someone with access.',
      }),
    )
    open('/team/new')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /Add Employee/ }))
    expect(await screen.findByText(/already belongs to someone/)).toBeInTheDocument()
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('checks the form first', async () => {
    open('/team/new')
    await userEvent.click(await screen.findByRole('button', { name: /Add Employee/ }))
    expect(screen.getByText('Enter their work email address.')).toBeInTheDocument()
    expect(team.inviteStaff).not.toHaveBeenCalled()
  })
})

describe('employee profile', () => {
  it('shows employment, work and tasks, and deactivates', async () => {
    team.setEmployeeActive.mockResolvedValue(ok({ id: 's1' }))
    open('/team/s1')
    expect(await screen.findByRole('heading', { name: 'Sipho Khumalo' })).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(
      screen.getByText('4 of 6 tasks with a due date were finished by it.'),
    ).toBeInTheDocument()
    expect(await screen.findAllByRole('link', { name: 'Inspect Midrand breaker' })).toHaveLength(2)
    expect(tasks.listTasks.mock.calls[0][1]).toMatchObject({ status: 'active', assignee: 's1' })
    expect(screen.getByRole('link', { name: /Assign Task/ })).toHaveAttribute(
      'href',
      '/tasks/new?assignee=s1',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    )
    expect(await screen.findByText('Sipho Khumalo can no longer sign in.')).toBeInTheDocument()
    expect(team.setEmployeeActive).toHaveBeenCalledWith('s1', false)
  })

  it('does not offer to deactivate yourself, or let you change your own access level', async () => {
    team.getTeamMember.mockResolvedValue(ok(member({ id: 'u1', fullName: 'Test User' })))
    open('/team/u1')
    expect(await screen.findByRole('heading', { name: 'Test User' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
    open('/team/u1/edit')
    expect(await screen.findByLabelText('Access level')).toBeDisabled()
  })

  it('lets a manager see a profile but not edit it', async () => {
    open('/team/s1', 'manager')
    expect(await screen.findByRole('heading', { name: 'Sipho Khumalo' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit Employee/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
  })

  it('saves employment details', async () => {
    team.updateEmployee.mockResolvedValue(ok({ id: 's1' }))
    open('/team/s1/edit')
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'on_leave')
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/ }))
    expect(await screen.findByText('Employee details saved.')).toBeInTheDocument()
    expect(team.updateEmployee.mock.calls[0]).toMatchObject([
      's1',
      { employmentStatus: 'on_leave', role: 'staff', department: 'field_operations' },
    ])
  })
})

describe('tasks', () => {
  it('lets a manager filter everyone’s tasks', async () => {
    open('/tasks', 'manager')
    const table = await screen.findByRole('table', { name: 'Tasks' })
    const tr = within(table).getByRole('link', { name: 'Inspect Midrand breaker' }).closest('tr')!
    for (const text of ['Test User', 'Thabo Mokoena', 'Sandton Heights 14B', 'High', 'In Progress'])
      expect(within(tr).getByText(text)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Assigned to'), 'me')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'overdue')
    await waitFor(() =>
      expect(tasks.listTasks.mock.calls.at(-1)![1]).toEqual({
        status: 'overdue',
        category: '',
        priority: '',
        assignee: 'u1',
      }),
    )
  })

  it('shows staff only their own work, without creating tasks', async () => {
    open('/tasks?assignee=unassigned', 'staff')
    expect(await screen.findByRole('heading', { name: 'My Tasks' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Create Task/ })).toBeNull()
    expect(screen.queryByLabelText('Assigned to')).toBeNull()
    expect(tasks.listTasks.mock.calls.at(-1)![1]).toMatchObject({ assignee: '' })
    open('/tasks/new', 'staff')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })

  it('creates a task from a ticket, with its customer and property filled in', async () => {
    const ticketId = 'a0200000-0000-0000-0000-000000000001'
    vi.mocked(supportService.getTicket).mockResolvedValue(
      ok({
        id: ticketId,
        reference: 'TKT-2026-00418',
        subject: 'Breaker trip',
        category: 'meter_fault',
        status: 'open',
        priority: 'urgent',
        customerId: 'c1',
        customerName: 'Thabo Mokoena',
        propertyName: 'Sandton Heights 14B',
        propertyId: 'p1',
        assignedTo: null,
        assigneeName: null,
        createdAt: 'x',
        lastActivityAt: 'x',
        messageCount: 0,
        attachmentCount: 0,
        description: null,
        propertyAddress: null,
        meterId: null,
        meterSerial: null,
        customerPhone: null,
        customerEmail: null,
        resolution: null,
        assignedAt: null,
        statusChangedAt: 'x',
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
      }),
    )
    tasks.createTask.mockResolvedValue(ok({ id: 'k9' }))
    open(`/tasks/new?ticket=${ticketId}`, 'manager')
    expect(await screen.findByLabelText('Title')).toHaveValue('Breaker trip')
    await waitFor(() => expect(screen.getByLabelText('Support ticket')).toHaveValue(ticketId))
    await userEvent.selectOptions(await screen.findByLabelText('Assigned to'), 's1')
    await userEvent.click(screen.getByLabelText(/Needs a photo/))
    await userEvent.click(screen.getByRole('button', { name: /Create Task/ }))
    expect(await screen.findByText(/Task created and assigned/)).toBeInTheDocument()
    expect(tasks.createTask.mock.calls[0][0]).toMatchObject({
      title: 'Breaker trip',
      priority: 'urgent',
      category: 'customer_support',
      customerId: 'c1',
      propertyId: 'p1',
      ticketId,
      assignedTo: 's1',
      proofRequired: true,
      status: 'todo',
    })
  })

  it('checks the task form first', async () => {
    open('/tasks/new', 'manager')
    await userEvent.click(await screen.findByLabelText('In Progress'))
    await userEvent.click(screen.getByRole('button', { name: /Create Task/ }))
    expect(screen.getByText('Give the task a short title.')).toBeInTheDocument()
    expect(screen.getByText(/Choose who is doing it/)).toBeInTheDocument()
    expect(tasks.createTask).not.toHaveBeenCalled()
  })
})

describe('working a task', () => {
  it('lets the assignee post progress, and asks for a photo before completing', async () => {
    tasks.postTaskUpdate.mockResolvedValue(ok({ id: 'u1' }))
    open('/tasks/k1', 'staff')
    expect(
      await screen.findByRole('heading', { name: 'Inspect Midrand breaker' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/needs a photo of the finished work before/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel Task/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull()
    await userEvent.type(screen.getByLabelText('Add an update'), 'Breaker reset, load tested.')
    await userEvent.click(screen.getByRole('button', { name: 'Post Update' }))
    expect(await screen.findByText('Progress update added.')).toBeInTheDocument()
    expect(tasks.postTaskUpdate).toHaveBeenCalledWith('k1', 'Breaker reset, load tested.')
    await userEvent.click(screen.getByRole('button', { name: /Mark Complete/ }))
    expect(
      within(screen.getByRole('dialog')).getByText(/needs a photo of the finished work first/),
    ).toBeInTheDocument()
  })

  it('starts a pending task and completes one that has its photo', async () => {
    tasks.getTask.mockResolvedValue(
      ok(task({ status: 'todo', displayStatus: 'todo', photoCount: 1 })),
    )
    tasks.setTaskStatus.mockResolvedValue(ok({ id: 'k1' }))
    tasks.uploadTaskFile.mockResolvedValue(ok({ id: 'f1' }))
    open('/tasks/k1', 'staff')
    await userEvent.click(await screen.findByRole('button', { name: /Start Work/ }))
    expect(await screen.findByText('Work started.')).toBeInTheDocument()
    expect(tasks.setTaskStatus).toHaveBeenCalledWith('k1', 'in_progress')
    await userEvent.click(screen.getByRole('button', { name: /Mark Complete/ }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark complete' }),
    )
    expect(await screen.findByText('Task completed.')).toBeInTheDocument()
    expect(tasks.setTaskStatus).toHaveBeenLastCalledWith('k1', 'done')
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'after.jpg'))
    expect(await screen.findByText('1 file attached.')).toBeInTheDocument()
    expect(tasks.uploadTaskFile.mock.calls[0][0]).toEqual({ id: 'k1', businessId: 'b1' })
  })

  it('shows the database refusing a completion', async () => {
    tasks.getTask.mockResolvedValue(ok(task({ proofRequired: false })))
    tasks.setTaskStatus.mockResolvedValue(
      err({ code: 'validation', message: 'Only a manager can change, cancel or reopen a task.' }),
    )
    open('/tasks/k1', 'staff')
    await userEvent.click(await screen.findByRole('button', { name: /Mark Complete/ }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark complete' }),
    )
    expect(
      await within(screen.getByRole('dialog')).findByText(/Only a manager/),
    ).toBeInTheDocument()
  })

  it('gives someone else’s task no actions', async () => {
    tasks.getTask.mockResolvedValue(ok(task({ assignedTo: 's9', assigneeName: 'Someone Else' })))
    open('/tasks/k1', 'staff')
    await screen.findByRole('heading', { name: 'Inspect Midrand breaker' })
    expect(screen.queryByRole('button', { name: /Mark Complete/ })).toBeNull()
    expect(screen.queryByLabelText('Add an update')).toBeNull()
  })

  it('lets a manager cancel with a reason, and reopen', async () => {
    tasks.setTaskStatus.mockResolvedValue(ok({ id: 'k1' }))
    open('/tasks/k1', 'manager')
    await userEvent.click(await screen.findByRole('button', { name: /Cancel Task/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Customer moved out')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }))
    expect(await screen.findByText('Task cancelled.')).toBeInTheDocument()
    expect(tasks.setTaskStatus).toHaveBeenCalledWith('k1', 'cancelled', 'Customer moved out')
  })

  it('lets a manager reopen a completed task', async () => {
    tasks.getTask.mockResolvedValue(
      ok(
        task({
          status: 'done',
          displayStatus: 'done',
          completedAt: '2026-11-26T09:00:00Z',
          completedByName: 'Test User',
        }),
      ),
    )
    tasks.setTaskStatus.mockResolvedValue(ok({ id: 'k1' }))
    open('/tasks/k1', 'manager')
    expect(await screen.findByText(/by Test User/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Reopen/ }))
    expect(await screen.findByText('Task reopened.')).toBeInTheDocument()
    expect(tasks.setTaskStatus).toHaveBeenCalledWith('k1', 'in_progress')
  })
})
