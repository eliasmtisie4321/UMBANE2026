import type { UserRole } from './auth'

export const DEPARTMENTS = [
  { value: 'field_operations', label: 'Field Operations' },
  { value: 'customer_support', label: 'Customer Support' },
  { value: 'sales_billing', label: 'Sales & Billing' },
  { value: 'administration', label: 'Administration' },
  { value: 'marketing', label: 'Marketing' },
] as const
export type Department = (typeof DEPARTMENTS)[number]['value']

export const EMPLOYMENT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'training', label: 'Training' },
] as const
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]['value']

/** The roles a team member can have; clients are customers, not staff. */
export const STAFF_ROLES = [
  { value: 'staff', label: 'Staff' },
  { value: 'manager', label: 'Manager' },
  { value: 'administrator', label: 'Administrator' },
] as const
export type StaffRole = Exclude<UserRole, 'client'>

export interface TeamMember {
  id: string
  employeeCode: string | null
  fullName: string
  email: string | null
  phone: string | null
  role: StaffRole
  department: Department | null
  jobTitle: string | null
  employmentStatus: EmploymentStatus
  isActive: boolean
  startDate: string | null
  reportsTo: string | null
  reportsToName: string | null
  activeTasks: number
  overdueTasks: number
  completedThisMonth: number
  completedTasks: number
  completedWithDue: number
  completedOnTime: number
}

export interface EmployeeInput {
  fullName: string
  phone: string | null
  role: StaffRole
  department: Department | null
  jobTitle: string | null
  startDate: string | null
  reportsTo: string | null
}

export interface EmployeeUpdate extends EmployeeInput {
  employmentStatus: EmploymentStatus
}

export interface InviteInput extends EmployeeInput {
  email: string
}

export type InviteResult = { status: 'linked'; profileId: string } | { status: 'invited' }

export interface Invitation {
  id: string
  email: string
  fullName: string
  role: StaffRole
  department: Department | null
  jobTitle: string | null
  createdAt: string
}

// Tasks ------------------------------------------------------------------------------------------
export const TASK_STATUSES = [
  { value: 'todo', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]['value']
/** As shown: an open task past its due date is overdue. */
export type TaskDisplayStatus = TaskStatus | 'overdue'
export const TASK_DISPLAY_STATUSES = [
  ...TASK_STATUSES,
  { value: 'overdue', label: 'Overdue' },
] as const

export const TASK_CATEGORIES = [
  { value: 'field_maintenance', label: 'Field maintenance' },
  { value: 'meter_installation', label: 'Meter installation' },
  { value: 'billing_audit', label: 'Billing and tariff audit' },
  { value: 'customer_support', label: 'Customer support' },
  { value: 'sales_follow_up', label: 'Sales follow-up' },
  { value: 'other', label: 'Other' },
] as const
export type TaskCategory = (typeof TASK_CATEGORIES)[number]['value']

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low'
export type TaskSort = 'due_date' | 'created_at' | 'last_activity_at'

export interface TaskListItem {
  id: string
  reference: string
  title: string
  category: TaskCategory
  status: TaskStatus
  displayStatus: TaskDisplayStatus
  priority: TaskPriority
  startDate: string | null
  dueDate: string | null
  isOverdue: boolean
  assignedTo: string | null
  assigneeName: string | null
  customerId: string | null
  customerName: string | null
  propertyId: string | null
  propertyName: string | null
  ticketId: string | null
  ticketReference: string | null
  completedAt: string | null
  lastActivityAt: string
}

export interface Task extends TaskListItem {
  description: string | null
  proofRequired: boolean
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  startedAt: string | null
  completedBy: string | null
  completedByName: string | null
  cancelReason: string | null
  updateCount: number
  photoCount: number
}

export interface TaskSummary {
  pending: number
  inProgress: number
  overdue: number
  completedThisMonth: number
  completed: number
  cancelled: number
}

export interface TaskUpdate {
  id: string
  body: string
  authorName: string | null
  createdAt: string
}

export type TaskEventKind = 'created' | 'status' | 'assigned' | 'priority' | 'due' | 'attachment'

export interface TaskEvent {
  id: string
  kind: TaskEventKind
  fromValue: string | null
  toValue: string | null
  actorName: string | null
  createdAt: string
}

export interface TaskInput {
  title: string
  description: string | null
  category: TaskCategory
  priority: TaskPriority
  assignedTo: string | null
  startDate: string | null
  dueDate: string | null
  proofRequired: boolean
  customerId: string | null
  propertyId: string | null
  ticketId: string | null
  /** Only when creating: a task starts Pending or In Progress. */
  status?: 'todo' | 'in_progress'
}
