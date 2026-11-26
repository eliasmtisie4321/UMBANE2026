import type {
  Customer,
  CustomerInput,
  CustomerListItem,
  CustomerSort,
  CustomerStatus,
  ListQuery,
  Page,
  RelatedOrder,
  RelatedProperty,
  RelatedTicket,
  Segment,
} from '@/types/customers'
import type { RecentInvoice } from '@/types/dashboard'
import { err, ok } from '@/utils/result'
import { orIlike, phoneIlike } from '@/utils/search'
import { embeddedCount, guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function fromRow(r: Row): Customer {
  return {
    id: String(r.id),
    name: String(r.name),
    email: str(r.email),
    phone: str(r.phone),
    altPhone: str(r.alt_phone),
    customerType: r.customer_type === 'business' ? 'business' : 'individual',
    segment: str(r.segment) as Segment | null,
    idNumber: str(r.id_number),
    companyName: str(r.company_name),
    registrationNumber: str(r.registration_number),
    streetAddress: str(r.street_address),
    suburb: str(r.suburb),
    city: str(r.city),
    province: str(r.province),
    postalCode: str(r.postal_code),
    notes: str(r.notes),
    status: String(r.status) as CustomerStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    erasedAt: str(r.erased_at),
  }
}

/** business_id is not sent: the database fills it from the signed-in user. */
function toRow(i: CustomerInput) {
  return {
    name: i.name,
    email: i.email,
    phone: i.phone,
    alt_phone: i.altPhone,
    customer_type: i.customerType,
    segment: i.segment,
    id_number: i.idNumber,
    company_name: i.companyName,
    registration_number: i.registrationNumber,
    street_address: i.streetAddress,
    suburb: i.suburb,
    city: i.city,
    province: i.province,
    postal_code: i.postalCode,
    notes: i.notes,
    status: i.status,
  }
}

export interface CustomerFilters {
  status: CustomerStatus | ''
  segment: Segment | ''
}

export const listCustomers = (
  query: ListQuery<CustomerSort>,
  filters: CustomerFilters,
  client?: DbClient,
) =>
  guarded<Page<CustomerListItem>>('Customers', client, async (c) => {
    let q = c
      .from('customers')
      .select(
        'id, name, email, phone, customer_type, segment, company_name, status, created_at, properties(count)',
        { count: 'exact' },
      )
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.segment) q = q.eq('segment', filters.segment)
    const clauses = [
      orIlike(['name', 'email', 'company_name'], query.search),
      phoneIlike('phone', query.search),
    ].filter((x): x is string => x !== null)
    if (clauses.length > 0) q = q.or(clauses.join(','))

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('id') // stable order, so rows never repeat or vanish between pages
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Customers'))
    return ok({
      total: count ?? 0,
      rows: (data ?? []).map((r: Row) => ({
        id: String(r.id),
        name: String(r.name),
        email: str(r.email),
        phone: str(r.phone),
        customerType:
          r.customer_type === 'business' ? ('business' as const) : ('individual' as const),
        segment: str(r.segment) as Segment | null,
        companyName: str(r.company_name),
        status: String(r.status) as CustomerStatus,
        propertyCount: embeddedCount(r.properties),
        createdAt: String(r.created_at),
      })),
    })
  })

export const getCustomer = (id: string, client?: DbClient) =>
  guarded<Customer>('Customer', client, async (c) => {
    const { data, error } = await c.from('customers').select('*').eq('id', id).maybeSingle()
    if (error) return err(mapReadError(error, 'Customer'))
    if (!data) return err({ code: 'not_found', message: 'This customer could not be found.' })
    return ok(fromRow(data as Row))
  })

export const createCustomer = (input: CustomerInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'customer',
    client,
    async (c) => {
      const { data, error } = await c.from('customers').insert(toRow(input)).select('id').single()
      if (error) return err(mapWriteError(error, 'customer'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

const NOT_UPDATED = {
  code: 'not_found' as const,
  message:
    'This customer could not be updated. It may have been removed, or you may not have permission.',
}

export const updateCustomer = (id: string, input: CustomerInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'customer',
    client,
    async (c) => {
      const { data, error } = await c
        .from('customers')
        .update(toRow(input))
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'customer'))
      // Row Level Security hides rows from an update instead of raising an error, so zero rows
      // means "not found or not allowed".
      if (!data || data.length === 0) return err(NOT_UPDATED)
      return ok({ id })
    },
    mapWriteError,
  )

export const setCustomerStatus = (id: string, status: CustomerStatus, client?: DbClient) =>
  guarded<{ id: string }>(
    'customer',
    client,
    async (c) => {
      const { data, error } = await c.from('customers').update({ status }).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'customer'))
      if (!data || data.length === 0) return err(NOT_UPDATED)
      return ok({ id })
    },
    mapWriteError,
  )

export const getCustomerProperties = (customerId: string, client?: DbClient) =>
  guarded<RelatedProperty[]>('Properties', client, async (c) => {
    const { data, error } = await c
      .from('properties')
      .select('id, reference, name, address, city, status, electricity_meters(count)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return err(mapReadError(error, 'Properties'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        reference: str(r.reference),
        name: str(r.name),
        address: String(r.address),
        city: str(r.city),
        status: String(r.status),
        meterCount: embeddedCount(r.electricity_meters),
      })),
    )
  })

export const getCustomerInvoices = (customerId: string, client?: DbClient) =>
  guarded<RecentInvoice[]>('Invoices', client, async (c) => {
    const { data, error } = await c
      .from('invoice_balances')
      .select('id, invoice_number, status, total, balance, due_date, is_overdue')
      .eq('customer_id', customerId)
      .order('due_date', { ascending: false, nullsFirst: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Invoices'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        invoiceNumber: String(r.invoice_number),
        status: String(r.status),
        total: num(r.total),
        balance: num(r.balance),
        dueDate: str(r.due_date),
        isOverdue: Boolean(r.is_overdue),
      })),
    )
  })

export const getCustomerOrders = (customerId: string, client?: DbClient) =>
  guarded<RelatedOrder[]>('Orders', client, async (c) => {
    const { data, error } = await c
      .from('orders')
      .select('id, status, total, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Orders'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        status: String(r.status),
        total: num(r.total),
        createdAt: String(r.created_at),
      })),
    )
  })

export const getCustomerTickets = (customerId: string, client?: DbClient) =>
  guarded<RelatedTicket[]>('Support tickets', client, async (c) => {
    const { data, error } = await c
      .from('support_tickets')
      .select('id, reference, subject, status, priority, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Support tickets'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        reference: String(r.reference),
        subject: String(r.subject),
        status: String(r.status),
        priority: String(r.priority),
        createdAt: String(r.created_at),
      })),
    )
  })
