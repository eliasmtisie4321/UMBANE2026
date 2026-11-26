import type { AuditEntry } from '@/types/settings'
import { formatDateTime, humanize } from './format'

const THING: Record<string, string> = {
  businesses: 'the business settings',
  profiles: 'a user',
  staff_invitations: 'an invitation',
  access_requests: 'an account request',
  automations: 'an automation',
  message_templates: 'an email template',
  ticket_categories: 'a ticket category',
  product_categories: 'a product category',
  customers: 'a customer',
  properties: 'a property',
  electricity_meters: 'a meter',
  meter_readings: 'a meter reading',
  meter_maintenance: 'a maintenance job',
  leads: 'a lead',
  orders: 'an order',
  sales: 'a sale',
  invoices: 'an invoice',
  invoice_items: 'an invoice line',
  payments: 'a payment',
  products: 'a product',
  inventory_transactions: 'a stock movement',
  support_tickets: 'a support ticket',
  ticket_messages: 'a ticket message',
  ticket_attachments: 'a ticket file',
  staff_tasks: 'a task',
  task_updates: 'a task update',
  task_attachments: 'a task file',
}

const VERB: Record<string, string> = { INSERT: 'added', UPDATE: 'changed', DELETE: 'deleted' }

/** Where a record can be opened in the app, if anywhere. */
const PAGE: Record<string, string> = {
  customers: '/customers/',
  properties: '/properties/',
  electricity_meters: '/electricity-meters/',
  invoices: '/invoices/',
  orders: '/sales-orders/',
  leads: '/leads/',
  products: '/inventory/',
  support_tickets: '/support-tickets/',
  staff_tasks: '/tasks/',
  profiles: '/team/',
}

export const auditLink = (e: AuditEntry) =>
  e.table && e.recordId && PAGE[e.table] && e.action !== 'DELETE'
    ? PAGE[e.table] + e.recordId
    : null

/** "Sam Staff changed a customer" / "The system removed old records". */
export function describeAudit(e: AuditEntry): string {
  const who = e.actorName ?? (e.actorId ? 'A former user' : 'The system')
  if (e.action === 'SECURITY') {
    const event = String((e.details ?? {}).event ?? '')
    if (event === 'password_changed') return `${who} changed their password`
    if (event === 'signed_out_other_sessions') return `${who} signed out of their other devices`
    return `${who}: security event`
  }
  if (e.action === 'ERASE') return `${who} erased a customer’s personal details`
  if (e.action === 'RETENTION') return 'The system removed records past their keeping period'
  const what =
    (e.table && THING[e.table]) ??
    (e.table ? `a ${humanize(e.table).toLowerCase()} record` : 'a record')
  return `${who} ${VERB[e.action] ?? e.action.toLowerCase()} ${what}`
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The lines shown under an entry: "Phone: 082 000 0001 → 082 000 0222", reasons, counts. */
export function auditDetails(e: AuditEntry): string[] {
  const d = e.details ?? {}
  if (d.erased === true) return ['Details removed when the customer was erased.']
  if (e.action === 'ERASE') return [`Reason: ${show(d.reason)}`]
  if (e.action === 'RETENTION') {
    return Object.entries(d)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${humanize(k)}: ${v} removed`)
  }
  const changes = d.changes as Record<string, [unknown, unknown]> | undefined
  if (changes) {
    return Object.entries(changes).map(
      ([k, [from, to]]) => `${humanize(k)}: ${show(from)} → ${show(to)}`,
    )
  }
  const row = d.row as Record<string, unknown> | undefined
  if (row) {
    const name =
      row.full_name ??
      row.name ??
      row.invoice_number ??
      row.reference ??
      row.sku ??
      row.serial_number ??
      row.label ??
      row.email
    return name ? [String(name)] : []
  }
  return []
}
