export const NOTIFICATION_CATEGORIES = [
  {
    value: 'tickets',
    label: 'Support tickets',
    description: 'New tickets, replies, assignments, status changes and urgent tickets.',
    clients: true,
  },
  {
    value: 'tasks',
    label: 'Tasks',
    description: 'Tasks given to you, finished or cancelled, due soon or overdue.',
    clients: false,
  },
  {
    value: 'invoices',
    label: 'Invoices',
    description: 'Invoices that become overdue.',
    clients: false,
  },
  {
    value: 'inventory',
    label: 'Inventory',
    description: 'Products that drop to their reorder level or run out.',
    clients: false,
  },
  {
    value: 'customers',
    label: 'Customers',
    description: 'New customers added.',
    clients: false,
  },
  {
    value: 'maintenance',
    label: 'Maintenance',
    description: 'Meter inspections, repairs and calibrations coming up.',
    clients: false,
  },
  {
    value: 'general',
    label: 'Other',
    description: 'Anything else from Umbane.',
    clients: true,
  },
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['value']

export interface NotificationPreference {
  category: NotificationCategory
  inApp: boolean
  email: boolean
}

export const AUTOMATION_KEYS = [
  'overdue_invoices',
  'low_stock',
  'new_customer',
  'urgent_ticket',
  'task_reminders',
  'maintenance_reminders',
  'payment_reminder',
  'overdue_notice',
  'ticket_status_email',
] as const
export type AutomationKey = (typeof AUTOMATION_KEYS)[number]

export interface SettingField {
  name: string
  label: string
  hint: string
  min: number
  max: number
  /** Shown after the number, e.g. "days". */
  unit: string
}

export interface AutomationInfo {
  key: AutomationKey
  name: string
  /** Who hears about it. */
  audience: 'team' | 'customers'
  /** Runs each morning (and on "Run now"), or the moment something changes. */
  timing: 'daily' | 'instant'
  trigger: (s: Record<string, number>) => string
  action: string
  fields: SettingField[]
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)

export const AUTOMATIONS: AutomationInfo[] = [
  {
    key: 'overdue_invoices',
    name: 'Overdue invoice alerts',
    audience: 'team',
    timing: 'daily',
    trigger: (s) =>
      s.days_overdue === 0
        ? 'An invoice passes its due date unpaid'
        : `An invoice is ${days(s.days_overdue)} past its due date and still unpaid`,
    action: 'Notify the managers and the person who issued it',
    fields: [
      {
        name: 'days_overdue',
        label: 'Days after the due date',
        hint: '0 alerts on the first day it is overdue.',
        min: 0,
        max: 60,
        unit: 'days',
      },
    ],
  },
  {
    key: 'low_stock',
    name: 'Low stock alerts',
    audience: 'team',
    timing: 'instant',
    trigger: () => 'A product drops to its reorder level, or runs out',
    action: 'Notify the managers (once a day per product at most)',
    fields: [],
  },
  {
    key: 'new_customer',
    name: 'New customer alerts',
    audience: 'team',
    timing: 'instant',
    trigger: () => 'A customer is added',
    action: 'Notify the managers',
    fields: [],
  },
  {
    key: 'urgent_ticket',
    name: 'Urgent ticket alerts',
    audience: 'team',
    timing: 'instant',
    trigger: () => 'A support ticket is opened as urgent or raised to urgent',
    action: 'Notify the managers',
    fields: [],
  },
  {
    key: 'task_reminders',
    name: 'Task reminders',
    audience: 'team',
    timing: 'daily',
    trigger: (s) =>
      `A task is due ${s.days_before === 0 ? 'today' : `within ${days(s.days_before)}`}, or becomes overdue`,
    action: 'Remind the person doing it; when overdue, also the person who set it',
    fields: [
      {
        name: 'days_before',
        label: 'Days before the due date',
        hint: '1 reminds the day before; 0 on the day.',
        min: 0,
        max: 14,
        unit: 'days',
      },
    ],
  },
  {
    key: 'maintenance_reminders',
    name: 'Maintenance reminders',
    audience: 'team',
    timing: 'daily',
    trigger: (s) =>
      `Meter maintenance is scheduled ${s.days_before === 0 ? 'today' : `within ${days(s.days_before)}`}`,
    action: 'Remind the technician, or the managers if nobody is assigned',
    fields: [
      {
        name: 'days_before',
        label: 'Days before the visit',
        hint: '1 reminds the day before; 0 on the day.',
        min: 0,
        max: 14,
        unit: 'days',
      },
    ],
  },
  {
    key: 'payment_reminder',
    name: 'Payment reminders to customers',
    audience: 'customers',
    timing: 'daily',
    trigger: (s) =>
      `An invoice is due within ${days(s.days_before)}${s.min_balance > 0 ? ` with more than R ${s.min_balance.toLocaleString('en-US')} still owed` : ' and still unpaid'}`,
    action: 'Email the customer the "Payment reminder" template',
    fields: [
      {
        name: 'days_before',
        label: 'Days before the due date',
        hint: 'Sent once per invoice.',
        min: 1,
        max: 30,
        unit: 'days',
      },
      {
        name: 'min_balance',
        label: 'Only when more than',
        hint: 'Skip small balances. 0 reminds about any amount.',
        min: 0,
        max: 10_000_000,
        unit: 'rand',
      },
    ],
  },
  {
    key: 'overdue_notice',
    name: 'Overdue notices to customers',
    audience: 'customers',
    timing: 'daily',
    trigger: (s) => `An invoice is ${days(s.days_overdue)} past its due date and still unpaid`,
    action: 'Email the customer the "Invoice overdue" template',
    fields: [
      {
        name: 'days_overdue',
        label: 'Days after the due date',
        hint: 'Sent once per invoice.',
        min: 1,
        max: 90,
        unit: 'days',
      },
    ],
  },
  {
    key: 'ticket_status_email',
    name: 'Ticket updates to customers',
    audience: 'customers',
    timing: 'instant',
    trigger: () => 'The team starts work on, resolves or closes a support ticket',
    action:
      'Email the customer the "Support ticket update" template (customers who sign in get it in the app instead)',
    fields: [],
  },
]

export const automationInfo = (key: string) => AUTOMATIONS.find((a) => a.key === key)

export type RunStatus = 'success' | 'partial' | 'failed' | 'nothing_to_do'

export interface Automation {
  id: string
  key: AutomationKey
  enabled: boolean
  settings: Record<string, number>
  lastRunAt: string | null
  lastStatus: RunStatus | null
  lastMessage: string | null
  updatedAt: string
}

export interface AutomationRun {
  id: string
  number: number
  trigger: 'schedule' | 'manual'
  startedAt: string
  finishedAt: string | null
  status: RunStatus | null
  checked: number
  done: number
  skipped: number
  failed: number
  error: string | null
}

export type ActionOutcome = 'pending' | 'notified' | 'emailed' | 'skipped' | 'failed'

export interface AutomationAction {
  id: string
  runId: string | null
  targetType: 'invoice' | 'product' | 'customer' | 'ticket' | 'task' | 'maintenance'
  targetId: string | null
  targetLabel: string | null
  outcome: ActionOutcome
  detail: string | null
  createdAt: string
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  success: 'Succeeded',
  partial: 'Partly failed',
  failed: 'Failed',
  nothing_to_do: 'Nothing to do',
}

export const OUTCOME_LABEL: Record<ActionOutcome, string> = {
  pending: 'In progress',
  notified: 'Notified',
  emailed: 'Email queued',
  skipped: 'Skipped',
  failed: 'Failed',
}
