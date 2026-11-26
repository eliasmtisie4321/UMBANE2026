import { labelOf, TICKET_PRIORITIES } from '@/types/support'
import {
  TASK_STATUSES,
  type Department,
  type EmployeeUpdate,
  type EmploymentStatus,
  type InviteInput,
  type StaffRole,
  type Task,
  type TaskCategory,
  type TaskEvent,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
  type TeamMember,
} from '@/types/team'
import { formatDate } from './format'
import { isRealDate } from './meterForm'
import { normalizePhone } from './phone'
import { isValidEmail } from './validation'

// Employees ---------------------------------------------------------------------------------------
export interface EmployeeFormValues {
  email: string
  fullName: string
  phone: string
  role: StaffRole
  department: Department | ''
  jobTitle: string
  employmentStatus: EmploymentStatus
  startDate: string
  reportsTo: string
}

export const emptyEmployeeForm: EmployeeFormValues = {
  email: '',
  fullName: '',
  phone: '',
  role: 'staff',
  department: '',
  jobTitle: '',
  employmentStatus: 'active',
  startDate: '',
  reportsTo: '',
}

export type EmployeeFormErrors = Partial<Record<keyof EmployeeFormValues, string>>

export function validateEmployeeForm(
  v: EmployeeFormValues,
  mode: 'invite' | 'edit',
): EmployeeFormErrors {
  const e: EmployeeFormErrors = {}
  if (mode === 'invite') {
    if (!v.email.trim()) e.email = 'Enter their work email address.'
    else if (!isValidEmail(v.email.trim())) e.email = 'Enter a valid email address.'
  }
  const name = v.fullName.trim()
  if (name.length < 2) e.fullName = 'Enter their full name.'
  else if (name.length > 120) e.fullName = 'Keep the name to 120 characters.'
  if (v.phone.trim() && !normalizePhone(v.phone)) e.phone = 'Enter a South African number.'
  if (v.jobTitle.trim().length > 80) e.jobTitle = 'Keep the job title to 80 characters.'
  if (v.startDate && !isRealDate(v.startDate)) e.startDate = 'Enter a real date.'
  return e
}

const details = (v: EmployeeFormValues) => ({
  fullName: v.fullName.trim(),
  phone: v.phone.trim() ? normalizePhone(v.phone) : null,
  role: v.role,
  department: v.department || null,
  jobTitle: v.jobTitle.trim() || null,
  startDate: v.startDate || null,
  reportsTo: v.reportsTo || null,
})

export const toInviteInput = (v: EmployeeFormValues): InviteInput => ({
  ...details(v),
  email: v.email.trim().toLowerCase(),
})

export const toEmployeeUpdate = (v: EmployeeFormValues): EmployeeUpdate => ({
  ...details(v),
  employmentStatus: v.employmentStatus,
})

export const memberToForm = (m: TeamMember): EmployeeFormValues => ({
  email: m.email ?? '',
  fullName: m.fullName,
  phone: m.phone ?? '',
  role: m.role,
  department: m.department ?? '',
  jobTitle: m.jobTitle ?? '',
  employmentStatus: m.employmentStatus,
  startDate: m.startDate ?? '',
  reportsTo: m.reportsTo ?? '',
})

/** Share of completed tasks with a due date that were finished by it; null before there are any. */
export const onTimeRate = (m: Pick<TeamMember, 'completedWithDue' | 'completedOnTime'>) =>
  m.completedWithDue === 0 ? null : Math.round((m.completedOnTime / m.completedWithDue) * 100)

// Tasks -------------------------------------------------------------------------------------------
export const TASK_TITLE_MAX = 150
export const TASK_TEXT_MAX = 5000
export const UPDATE_MAX = 2000

export interface TaskFormValues {
  title: string
  description: string
  category: TaskCategory
  priority: TaskPriority
  assignedTo: string
  startDate: string
  dueDate: string
  proofRequired: boolean
  customerId: string
  propertyId: string
  ticketId: string
  status: 'todo' | 'in_progress'
}

export const emptyTaskForm: TaskFormValues = {
  title: '',
  description: '',
  category: 'field_maintenance',
  priority: 'normal',
  assignedTo: '',
  startDate: '',
  dueDate: '',
  proofRequired: false,
  customerId: '',
  propertyId: '',
  ticketId: '',
  status: 'todo',
}

export type TaskFormErrors = Partial<Record<keyof TaskFormValues, string>>

export function validateTaskForm(v: TaskFormValues): TaskFormErrors {
  const e: TaskFormErrors = {}
  const title = v.title.trim()
  if (!title) e.title = 'Give the task a short title.'
  else if (title.length > TASK_TITLE_MAX)
    e.title = `Keep the title to ${TASK_TITLE_MAX} characters.`
  if (v.description.trim().length > TASK_TEXT_MAX)
    e.description = `Keep the description to ${TASK_TEXT_MAX} characters.`
  if (v.startDate && !isRealDate(v.startDate)) e.startDate = 'Enter a real date.'
  if (v.dueDate && !isRealDate(v.dueDate)) e.dueDate = 'Enter a real date.'
  else if (v.dueDate && v.startDate && isRealDate(v.startDate) && v.dueDate < v.startDate)
    e.dueDate = 'The due date cannot be before the start date.'
  if (v.status === 'in_progress' && !v.assignedTo)
    e.assignedTo = 'Choose who is doing it, or start it as Pending.'
  return e
}

export const toTaskInput = (v: TaskFormValues, mode: 'create' | 'edit'): TaskInput => ({
  title: v.title.trim(),
  description: v.description.trim() || null,
  category: v.category,
  priority: v.priority,
  assignedTo: v.assignedTo || null,
  startDate: v.startDate || null,
  dueDate: v.dueDate || null,
  proofRequired: v.proofRequired,
  customerId: v.customerId || null,
  propertyId: v.propertyId || null,
  ticketId: v.ticketId || null,
  ...(mode === 'create' ? { status: v.status } : {}),
})

export const taskToForm = (t: Task): TaskFormValues => ({
  title: t.title,
  description: t.description ?? '',
  category: t.category,
  priority: t.priority,
  assignedTo: t.assignedTo ?? '',
  startDate: t.startDate ?? '',
  dueDate: t.dueDate ?? '',
  proofRequired: t.proofRequired,
  customerId: t.customerId ?? '',
  propertyId: t.propertyId ?? '',
  ticketId: t.ticketId ?? '',
  status: t.status === 'in_progress' ? 'in_progress' : 'todo',
})

export function validateUpdate(body: string): string | null {
  if (!body.trim()) return 'Write what has been done.'
  if (body.trim().length > UPDATE_MAX) return `Keep the update to ${UPDATE_MAX} characters.`
  return null
}

/** The moves offered to a person on a task. The database refuses anything else. */
export function taskActions(
  t: Pick<Task, 'status' | 'assignedTo'>,
  who: { id: string; isManager: boolean },
) {
  const mine = t.assignedTo === who.id
  const canWork = (who.isManager || mine) && t.assignedTo !== null
  return {
    start: canWork && t.status === 'todo',
    pause: canWork && t.status === 'in_progress',
    complete: canWork && (t.status === 'todo' || t.status === 'in_progress'),
    cancel: who.isManager && (t.status === 'todo' || t.status === 'in_progress'),
    reopen: who.isManager && (t.status === 'done' || t.status === 'cancelled'),
    edit: who.isManager && (t.status === 'todo' || t.status === 'in_progress'),
    post: (who.isManager || mine) && (t.status === 'todo' || t.status === 'in_progress'),
  }
}

const dateText = (v: string | null) => (v && isRealDate(v) ? formatDate(v) : 'no date')

export function describeTaskEvent(e: TaskEvent): string {
  switch (e.kind) {
    case 'created':
      return 'Task created'
    case 'status':
      return `Status changed to ${labelOf(TASK_STATUSES, e.toValue)}`
    case 'assigned':
      return e.toValue ? `Assigned to ${e.toValue}` : 'Unassigned'
    case 'priority':
      return `Priority changed from ${labelOf(TICKET_PRIORITIES, e.fromValue)} to ${labelOf(TICKET_PRIORITIES, e.toValue)}`
    case 'due':
      return `Due date changed from ${dateText(e.fromValue)} to ${dateText(e.toValue)}`
    case 'attachment':
      return `File attached: ${e.toValue ?? ''}`
  }
}

export const statusLabel = (s: TaskStatus | 'overdue') =>
  s === 'overdue' ? 'Overdue' : labelOf(TASK_STATUSES, s)
