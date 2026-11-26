import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppError, Result } from '@/types/api'
import { err } from '@/utils/result'
import { getSupabase } from './supabase'

/** The slice of the Supabase client the data services use; tests pass a fake. */
export type DbClient = Pick<SupabaseClient, 'from' | 'rpc'>

export interface DbError {
  code?: string
  message?: string
  details?: string
}

export const resolveClient = (client?: DbClient): DbClient => client ?? getSupabase()

/** Read failures. Raw database text is never shown to users. */
export function mapReadError(e: DbError, what: string): AppError {
  if (e.code === '42501') {
    return { code: 'forbidden', message: 'You do not have access to this information.' }
  }
  if (e.code === 'PGRST205' || e.code === '42P01') {
    return {
      code: 'unknown',
      message: `${what} is unavailable until the latest database update is applied.`,
    }
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  return { code: 'unknown', message: `Could not load ${what}. Please try again.` }
}

/** Unique indexes from the migrations, mapped to the form field and message a person can act on. */
const UNIQUE_VIOLATIONS: Record<string, { field: string; message: string }> = {
  customers_business_email_uniq: {
    field: 'email',
    message: 'A customer with this email address already exists.',
  },
  customers_business_id_number_uniq: {
    field: 'idNumber',
    message: 'A customer with this ID number already exists.',
  },
  customers_business_registration_uniq: {
    field: 'registrationNumber',
    message: 'A customer with this registration number already exists.',
  },
  properties_business_reference_uniq: {
    field: 'reference',
    message: 'A property with this reference already exists.',
  },
  products_business_sku_ci_uniq: {
    field: 'sku',
    message: 'A product with this SKU already exists.',
  },
  products_business_id_sku_key: {
    field: 'sku',
    message: 'A product with this SKU already exists.',
  },
  meters_business_serial_ci_uniq: {
    field: 'serialNumber',
    message: 'A meter with this serial number already exists.',
  },
  electricity_meters_business_id_serial_number_key: {
    field: 'serialNumber',
    message: 'A meter with this serial number already exists.',
  },
  meter_readings_meter_id_reading_date_key: {
    field: 'readingDate',
    message: 'This meter already has a reading on this date.',
  },
  properties_customer_address_uniq: {
    field: 'address',
    message: 'This customer already has a property at this address.',
  },
}

/** Rules raised by database triggers (migration 0006), as text a person can act on. */
const RULES: Record<string, { field?: string; message: string }> = {
  reading_below_previous: {
    field: 'readingValue',
    message: 'This is below the previous reading. Check the value and the date.',
  },
  reading_above_next: {
    field: 'readingValue',
    message: 'This is above a later reading. Check the value and the date.',
  },
  reading_in_future: { field: 'readingDate', message: 'A reading cannot be in the future.' },
  reading_before_install: {
    field: 'readingDate',
    message: 'This is before the meter was installed.',
  },
  reading_after_retirement: {
    field: 'readingDate',
    message: 'This is after the meter was taken out of service.',
  },
  meter_installed_in_future: {
    field: 'installedOn',
    message: 'The installation date cannot be in the future.',
  },
  meter_installed_after_reading: {
    field: 'installedOn',
    message: 'This meter already has readings before that date.',
  },
  meter_retired_in_future: { field: 'retiredOn', message: 'The date cannot be in the future.' },
  meter_retired_before_reading: {
    field: 'retiredOn',
    message: 'This meter has a reading after that date.',
  },
  meters_retired_after_install: {
    field: 'retiredOn',
    message: 'This is before the meter was installed.',
  },
  meter_retired: {
    message: 'This meter has already been taken out of service. Refresh the page.',
  },
  assignee_not_staff: { field: 'assignedTo', message: 'Choose a current team member.' },
  lead_transition: { message: 'A lead cannot start as converted or lost.' },
  lead_converted: { message: 'This lead has already been converted. Refresh the page.' },
  lead_not_approved: {
    message: 'Move the lead to Qualified, Proposal or Negotiation before converting it.',
  },
  lead_customer_exists: {
    message: 'A matching customer already exists. Link the lead to that customer instead.',
  },
  order_transition: {
    message: 'The order’s status has changed, so this step is not possible. Refresh the page.',
  },
  order_locked: { message: 'Only a pending order can be edited. Refresh the page.' },
  order_empty: { message: 'Add at least one product or service first.' },
  order_too_many_items: { message: 'An order can have at most 100 lines.' },
  order_date_future: { field: 'orderDate', message: 'The order date cannot be in the future.' },
  order_property_mismatch: { message: 'The property does not belong to this customer.' },
  order_lead_mismatch: { message: 'The lead was not converted into this customer.' },
  invoice_transition: {
    message: 'The invoice’s status has changed, so this step is not possible. Refresh the page.',
  },
  invoice_locked: {
    message: 'An issued invoice cannot be changed. To correct it, cancel it and issue a new one.',
  },
  invoice_empty: { message: 'Add at least one product or service first.' },
  invoice_too_many_items: { message: 'An invoice can have at most 100 lines.' },
  invoice_date_future: { message: 'The issue date cannot be in the future.' },
  invoice_property_mismatch: { message: 'The property does not belong to this customer.' },
  invoice_order_mismatch: { message: 'The order does not belong to this customer.' },
  invoice_vat_not_registered: {
    message: 'Your business is not VAT registered, so this invoice cannot charge VAT.',
  },
  invoice_has_payments: {
    message: 'This invoice has payments. A manager must remove them before it can be cancelled.',
  },
  invoice_cancel_manager: {
    message: 'Only a manager or administrator can cancel an issued invoice.',
  },
  invoice_not_payable: {
    message: 'Payments can only be recorded on an issued invoice that is not yet paid.',
  },
  payment_exceeds_balance: { field: 'amount', message: 'This is more than the balance due.' },
  payment_in_future: { field: 'paidOn', message: 'A payment cannot be in the future.' },
  payment_before_issue: { field: 'paidOn', message: 'This is before the invoice was issued.' },
  order_not_invoiceable: { message: 'Only a confirmed or fulfilled order can be invoiced.' },
  order_already_invoiced: {
    message: 'This order already has an invoice. Open it from the invoice list.',
  },
  businesses_vat_number_check: {
    field: 'vatNumber',
    message: 'A South African VAT number has 10 digits and starts with 4.',
  },
  stock_insufficient: {
    field: 'quantity',
    message: 'There is not enough stock for this. Receive stock first, then try again.',
  },
  stock_not_tracked: { message: 'This product is a service, so it has no stock to move.' },
  stock_quantity_sign: { field: 'quantity', message: 'Enter a positive number of units.' },
  stock_sold_by_order: { message: 'Sales take stock out when their order is fulfilled.' },
  stock_reason_required: { field: 'note', message: 'Say why the stock is being adjusted.' },
  stock_direct_edit: { message: 'Stock changes only through stock movements.' },
  stock_not_zero: {
    field: 'trackStock',
    message: 'Bring the stock to zero with an adjustment before turning off stock tracking.',
  },
  products_sku_format: {
    field: 'sku',
    message: 'Use 2 to 40 letters, numbers, dots, dashes or slashes, e.g. UMB-CT-400.',
  },
  ticket_description_required: { field: 'description', message: 'Describe the problem.' },
  ticket_property_mismatch: {
    field: 'propertyId',
    message: 'The property does not belong to this customer.',
  },
  ticket_meter_mismatch: {
    field: 'meterId',
    message: 'The meter is not at this customer’s property.',
  },
  ticket_needs_assignee: { message: 'Assign the ticket to someone first.' },
  ticket_open_assigned: { message: 'Remove the assignee to put the ticket back to Open.' },
  ticket_resolution_required: {
    field: 'resolution',
    message: 'Say what was done, or why the ticket is closed.',
  },
  ticket_closed: {
    message: 'This ticket is closed, so it can no longer change. Open a new ticket instead.',
  },
  ticket_fixed_fields: { message: 'The customer and reference of a ticket cannot change.' },
  ticket_attachment_limit: { message: 'A ticket can have at most 20 files.' },
  ticket_attachments_type_check: {
    message: 'Only photos (JPG, PNG, WebP), PDF, CSV and text files can be attached.',
  },
  ticket_attachments_size_check: { message: 'Files can be at most 10 MB.' },
  attachment_not_uploaded: { message: 'The file did not finish uploading. Please try again.' },
  attachment_path_mismatch: { message: 'The file could not be attached. Please try again.' },
  tickets_subject_length: { field: 'subject', message: 'Keep the title to 150 characters.' },
  tickets_description_length: {
    field: 'description',
    message: 'Keep the description to 5000 characters.',
  },
  tickets_resolution_length: { field: 'resolution', message: 'Keep this to 2000 characters.' },
  ticket_messages_body_length: { field: 'body', message: 'Keep the message to 5000 characters.' },
  task_transition: { message: 'A new task starts as Pending or In Progress.' },
  task_needs_assignee: {
    field: 'assignedTo',
    message: 'Assign the task to someone first.',
  },
  task_manager_only: {
    message: 'Only a manager can change, cancel or reopen a task. You can start and complete it.',
  },
  task_fixed_fields: { message: 'The reference and creator of a task cannot change.' },
  task_closed: {
    message: 'This task is completed or cancelled. A manager must reopen it first.',
  },
  task_proof_required: {
    message: 'This task needs a photo of the finished work. Attach one, then complete it.',
  },
  task_cancel_reason: { field: 'cancelReason', message: 'Say why the task is cancelled.' },
  task_ticket_mismatch: {
    field: 'ticketId',
    message: 'The ticket belongs to a different customer.',
  },
  task_property_mismatch: {
    field: 'propertyId',
    message: 'The property belongs to a different customer.',
  },
  task_attachment_limit: { message: 'A task can have at most 20 files.' },
  task_attachments_content_type_check: {
    message: 'Only photos (JPG, PNG, WebP) and PDF files can be attached to a task.',
  },
  task_attachments_size_bytes_check: { message: 'Files can be at most 10 MB.' },
  tasks_dates: { field: 'dueDate', message: 'The due date cannot be before the start date.' },
  tasks_title_length: { field: 'title', message: 'Keep the title to 150 characters.' },
  tasks_description_length: {
    field: 'description',
    message: 'Keep the description to 5000 characters.',
  },
  staff_email_taken: {
    field: 'email',
    message:
      'This email already belongs to someone with access. Each person needs their own email.',
  },
  staff_already_invited: {
    field: 'email',
    message: 'This email has already been invited. Cancel that invitation to send a new one.',
  },
  staff_role_client: { field: 'role', message: 'Customers are not added as team members.' },
  staff_invitations_email_check: { field: 'email', message: 'Enter a valid email address.' },
  staff_invitations_phone_check: { field: 'phone', message: 'Enter a South African number.' },
  staff_self_lockout: {
    message: 'You cannot deactivate yourself or change your own role. Ask another administrator.',
  },
  staff_fixed_fields: { message: 'An employee number never changes.' },
  profiles_not_own_manager: { field: 'reportsTo', message: 'Nobody can report to themselves.' },
  invitation_closed: { message: 'This invitation has already been accepted or cancelled.' },
  maintenance_assignee_not_staff: {
    field: 'assignedTo',
    message: 'Choose a current team member.',
  },
}

/** Write failures: duplicates, constraint violations, permissions. */
export function mapWriteError(e: DbError, what: string): AppError {
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  if (e.code === '23505') {
    const known = Object.entries(UNIQUE_VIOLATIONS).find(([name]) => text.includes(name))
    return known
      ? { code: 'conflict', message: known[1].message, field: known[1].field }
      : { code: 'conflict', message: `This ${what} already exists.` }
  }
  if (e.code === '23514') {
    // Longest name first: "meter_retired" is also the start of other rule names.
    const rule = Object.keys(RULES)
      .sort((a, b) => b.length - a.length)
      .find((name) => text.includes(name))
    if (rule) return { code: 'validation', ...RULES[rule] }
  }
  if (['23514', '22P02', '23502', '22003'].includes(e.code ?? '')) {
    return {
      code: 'validation',
      message: 'Some of the details are not valid. Check the form and try again.',
    }
  }
  if (e.code === '23503') {
    return {
      code: 'validation',
      message: 'A linked record no longer exists. Refresh the page and try again.',
    }
  }
  if (e.code === '42501') {
    return { code: 'forbidden', message: 'You do not have permission to do this.' }
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  return { code: 'unknown', message: `Could not save the ${what}. Please try again.` }
}

type Mapper = (e: DbError, what: string) => AppError

/** Runs a query function, turning thrown errors into a Result with the right message. */
export async function guarded<T>(
  what: string,
  client: DbClient | undefined,
  fn: (c: DbClient) => Promise<Result<T>>,
  map: Mapper = mapReadError,
): Promise<Result<T>> {
  try {
    return await fn(resolveClient(client))
  } catch (e) {
    return err(map(e as DbError, what))
  }
}

export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** PostgREST returns a joined many-to-one row as an object, but tolerate an array too. */
export const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

/** The `count` from an embedded `table(count)` select, which arrives as [{ count: n }]. */
export const embeddedCount = (v: unknown): number => {
  const first = Array.isArray(v) ? v[0] : v
  return num((first as { count?: unknown } | undefined)?.count)
}
