import { describe, expect, it } from 'vitest'
import { checkFiles, TASK_FILES } from './files'
import {
  describeTaskEvent,
  emptyEmployeeForm,
  emptyTaskForm,
  onTimeRate,
  taskActions,
  toEmployeeUpdate,
  toInviteInput,
  toTaskInput,
  validateEmployeeForm,
  validateTaskForm,
  validateUpdate,
} from './teamForm'

describe('employee form', () => {
  const good = {
    ...emptyEmployeeForm,
    email: ' Lerato@Umbane.co.za ',
    fullName: ' Lerato Khumalo ',
    phone: '083 123 4567',
  }

  it('needs an email and a name to invite, and checks the phone', () => {
    expect(Object.keys(validateEmployeeForm(emptyEmployeeForm, 'invite')).sort()).toEqual([
      'email',
      'fullName',
    ])
    expect(validateEmployeeForm(good, 'invite')).toEqual({})
    expect(validateEmployeeForm({ ...good, phone: '12' }, 'invite').phone).toBeTruthy()
    expect(validateEmployeeForm({ ...good, email: 'nope' }, 'invite').email).toMatch(/valid/)
  })

  it('does not ask for the email when editing', () => {
    expect(validateEmployeeForm({ ...good, email: '' }, 'edit')).toEqual({})
  })

  it('sends a tidy invitation, and an update with the employment status', () => {
    expect(toInviteInput(good)).toEqual({
      email: 'lerato@umbane.co.za',
      fullName: 'Lerato Khumalo',
      phone: '+27831234567',
      role: 'staff',
      department: null,
      jobTitle: null,
      startDate: null,
      reportsTo: null,
    })
    expect(toEmployeeUpdate({ ...good, employmentStatus: 'on_leave' })).toMatchObject({
      employmentStatus: 'on_leave',
    })
    expect('email' in toEmployeeUpdate(good)).toBe(false)
  })

  it('works out the on-time rate only once there is something to measure', () => {
    expect(onTimeRate({ completedWithDue: 0, completedOnTime: 0 })).toBeNull()
    expect(onTimeRate({ completedWithDue: 3, completedOnTime: 2 })).toBe(67)
  })
})

describe('task form', () => {
  it('needs a title and sensible dates', () => {
    expect(validateTaskForm(emptyTaskForm).title).toBeTruthy()
    const e = validateTaskForm({
      ...emptyTaskForm,
      title: 'Audit',
      startDate: '2026-12-10',
      dueDate: '2026-12-01',
    })
    expect(e).toEqual({ dueDate: 'The due date cannot be before the start date.' })
    expect(
      validateTaskForm({ ...emptyTaskForm, title: 'x', dueDate: '2026-02-30' }).dueDate,
    ).toMatch(/real date/)
  })

  it('cannot start work without someone to do it', () => {
    expect(
      validateTaskForm({ ...emptyTaskForm, title: 'Fix', status: 'in_progress' }).assignedTo,
    ).toBeTruthy()
  })

  it('sends the starting status only when creating', () => {
    const v = { ...emptyTaskForm, title: ' Fix ', assignedTo: 's1', status: 'in_progress' as const }
    expect(toTaskInput(v, 'create')).toMatchObject({
      title: 'Fix',
      status: 'in_progress',
      assignedTo: 's1',
      customerId: null,
    })
    expect('status' in toTaskInput(v, 'edit')).toBe(false)
  })

  it('checks progress updates', () => {
    expect(validateUpdate('  ')).toBeTruthy()
    expect(validateUpdate('x'.repeat(2001))).toMatch(/2000/)
    expect(validateUpdate('Done')).toBeNull()
  })

  it('accepts photos and PDFs on tasks, nothing else', () => {
    const r = checkFiles(
      [new File(['x'], 'after.jpg'), new File(['x'], 'log.csv'), new File(['x'], 'card.pdf')],
      0,
      TASK_FILES,
    )
    expect(r.accepted.map((f) => f.name)).toEqual(['after.jpg', 'card.pdf'])
    expect(r.problems).toEqual(['log.csv: this type of file cannot be attached.'])
  })
})

describe('what a person can do with a task', () => {
  const manager = { id: 'm1', isManager: true }
  const assignee = { id: 's1', isManager: false }
  const other = { id: 's2', isManager: false }

  it('lets the assignee start, pause, complete and post, but not cancel or edit', () => {
    expect(taskActions({ status: 'todo', assignedTo: 's1' }, assignee)).toEqual({
      start: true,
      pause: false,
      complete: true,
      cancel: false,
      reopen: false,
      edit: false,
      post: true,
    })
    expect(taskActions({ status: 'in_progress', assignedTo: 's1' }, assignee).pause).toBe(true)
  })

  it('gives someone else nothing', () => {
    expect(Object.values(taskActions({ status: 'todo', assignedTo: 's1' }, other))).not.toContain(
      true,
    )
  })

  it('lets a manager cancel, edit and reopen, and only work an assigned task', () => {
    const open = taskActions({ status: 'todo', assignedTo: null }, manager)
    expect(open).toMatchObject({ cancel: true, edit: true, start: false, complete: false })
    expect(taskActions({ status: 'done', assignedTo: 's1' }, manager)).toMatchObject({
      reopen: true,
      edit: false,
      post: false,
      complete: false,
    })
  })
})

describe('task history', () => {
  const e = { id: '1', fromValue: null, toValue: null, actorName: null, createdAt: 'x' }
  it('describes each change in words', () => {
    expect(describeTaskEvent({ ...e, kind: 'status', toValue: 'done' })).toBe(
      'Status changed to Completed',
    )
    expect(describeTaskEvent({ ...e, kind: 'due', fromValue: '2026-12-01', toValue: null })).toBe(
      'Due date changed from 1 Dec 2026 to no date',
    )
    expect(describeTaskEvent({ ...e, kind: 'assigned', toValue: 'Sam Staff' })).toBe(
      'Assigned to Sam Staff',
    )
    expect(describeTaskEvent({ ...e, kind: 'created' })).toBe('Task created')
  })
})
