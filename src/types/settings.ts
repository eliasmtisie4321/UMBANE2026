import type { UserRole } from './auth'

export interface BusinessProfile {
  name: string
  description: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
}

export interface TicketCategory {
  id: string
  key: string
  label: string
  isActive: boolean
  position: number
}

export interface ProductCategory {
  id: string
  name: string
  isActive: boolean
}

export interface AuditEntry {
  id: string
  action: string
  table: string | null
  recordId: string | null
  actorId: string | null
  actorName: string | null
  details: Record<string, unknown> | null
  createdAt: string
}

export interface AuditFilter {
  /** Inclusive dates, YYYY-MM-DD; empty for no limit. */
  from: string
  to: string
  area: string
  action: string
  page: number
}

export interface RetentionPeriods {
  readNotificationsDays: number
  notificationsDays: number
  automationHistoryDays: number
  processedAccessRequestsDays: number
  auditDays: number
}

/** The record types the audit log covers, grouped as people think of them. */
export const AUDIT_AREAS: Array<{ value: string; label: string; tables: string[] }> = [
  {
    value: 'people',
    label: 'People and access',
    tables: ['profiles', 'staff_invitations', 'access_requests'],
  },
  {
    value: 'settings',
    label: 'Settings',
    tables: [
      'businesses',
      'automations',
      'message_templates',
      'ticket_categories',
      'product_categories',
    ],
  },
  { value: 'customers', label: 'Customers and properties', tables: ['customers', 'properties'] },
  {
    value: 'meters',
    label: 'Meters and readings',
    tables: ['electricity_meters', 'meter_readings', 'meter_maintenance'],
  },
  { value: 'sales', label: 'Leads, orders and sales', tables: ['leads', 'orders', 'sales'] },
  {
    value: 'money',
    label: 'Invoices and payments',
    tables: ['invoices', 'invoice_items', 'payments'],
  },
  { value: 'stock', label: 'Products and stock', tables: ['products', 'inventory_transactions'] },
  {
    value: 'work',
    label: 'Tickets and tasks',
    tables: [
      'support_tickets',
      'ticket_messages',
      'ticket_attachments',
      'staff_tasks',
      'task_updates',
      'task_attachments',
    ],
  },
]

export const AUDIT_ACTIONS = [
  { value: 'INSERT', label: 'Added' },
  { value: 'UPDATE', label: 'Changed' },
  { value: 'DELETE', label: 'Deleted' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'ERASE', label: 'Erased' },
  { value: 'RETENTION', label: 'Clean-up' },
]

/** What each role may do, as docs/PERMISSIONS.md describes and the database enforces. */
export const ROLE_MATRIX: Array<{ area: string; rights: Record<UserRole, string> }> = [
  {
    area: 'Dashboard',
    rights: {
      administrator: 'Everything',
      manager: 'Everything',
      staff: 'Their own work',
      client: 'Their own account',
    },
  },
  {
    area: 'Customers and properties',
    rights: {
      administrator: 'Manage, erase',
      manager: 'Manage',
      staff: 'Add and edit',
      client: 'Their own',
    },
  },
  {
    area: 'Meters and readings',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Record readings',
      client: 'Their own',
    },
  },
  {
    area: 'Leads, orders and sales',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Add and edit',
      client: 'Their own orders',
    },
  },
  {
    area: 'Invoices and payments',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Create and record',
      client: 'Their own',
    },
  },
  {
    area: 'Inventory',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Add and move stock',
      client: '-',
    },
  },
  {
    area: 'Support tickets',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Work on',
      client: 'Open and follow their own',
    },
  },
  {
    area: 'Team and tasks',
    rights: {
      administrator: 'Add people, change roles, deactivate',
      manager: 'Give tasks',
      staff: 'Their own tasks',
      client: '-',
    },
  },
  {
    area: 'Communications',
    rights: {
      administrator: 'Send, edit templates',
      manager: 'Send, edit templates',
      staff: 'Send and log',
      client: '-',
    },
  },
  {
    area: 'Reports',
    rights: { administrator: 'All reports', manager: 'All reports', staff: '-', client: '-' },
  },
  {
    area: 'Automations',
    rights: { administrator: 'Switch and set', manager: 'Switch and set', staff: '-', client: '-' },
  },
  {
    area: 'Business profile, invoice and tax settings',
    rights: { administrator: 'Edit', manager: 'View', staff: '-', client: '-' },
  },
  {
    area: 'Ticket and product categories',
    rights: {
      administrator: 'Manage',
      manager: 'Manage',
      staff: 'Use',
      client: 'Choose for tickets',
    },
  },
  {
    area: 'Audit log, data and privacy',
    rights: { administrator: 'Full access', manager: '-', staff: '-', client: '-' },
  },
]
