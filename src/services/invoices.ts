import type { ListQuery, Page } from '@/types/customers'
import type {
  BillingProfile,
  DisplayStatus,
  Invoice,
  InvoiceInput,
  InvoiceListItem,
  InvoiceSort,
  InvoiceStatus,
  InvoiceSummary,
  Payment,
  PaymentInput,
  PaymentMethodCode,
  PaymentSort,
  PaymentTerms,
} from '@/types/invoices'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromListRow = (r: Row): InvoiceListItem => ({
  id: String(r.id),
  invoiceNumber: str(r.invoice_number),
  reference: String(r.reference),
  customerId: String(r.customer_id),
  customerName: String(r.customer_name),
  issueDate: str(r.issue_date),
  dueDate: str(r.due_date),
  status: String(r.status) as InvoiceStatus,
  displayStatus: String(r.display_status) as DisplayStatus,
  total: num(r.total),
  paid: num(r.paid),
  balance: num(r.balance),
  isOverdue: Boolean(r.is_overdue),
})

export interface InvoiceFilters {
  status: DisplayStatus | ''
  customerId: string
  /** Inclusive issue-date bounds; empty = no bound. */
  from: string
  to: string
}

export const listInvoices = (
  query: ListQuery<InvoiceSort>,
  filters: InvoiceFilters,
  client?: DbClient,
) =>
  guarded<Page<InvoiceListItem>>('Invoices', client, async (c) => {
    let q = c.from('invoice_list').select('*', { count: 'exact' })
    // As people mean it: "unpaid" excludes overdue; "overdue" spans unpaid and part paid.
    if (filters.status === 'overdue') q = q.eq('is_overdue', true)
    else if (filters.status === 'sent' || filters.status === 'partially_paid')
      q = q.eq('display_status', filters.status)
    else if (filters.status) q = q.eq('status', filters.status)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    if (filters.from) q = q.gte('issue_date', filters.from)
    if (filters.to) q = q.lte('issue_date', filters.to)
    const or = orIlike(['reference', 'customer_name', 'order_reference'], query.search)
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Invoices'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromListRow) })
  })

export const getInvoiceSummary = (client?: DbClient) =>
  guarded<InvoiceSummary>('Invoice totals', client, async (c) => {
    const { data, error } = await c.from('invoice_status_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Invoice totals'))
    const r = (data ?? {}) as Row
    return ok({
      drafts: num(r.drafts),
      issued: num(r.issued),
      paid: num(r.paid),
      unpaid: num(r.unpaid),
      overdue: num(r.overdue),
      outstanding: num(r.outstanding),
      overdueAmount: num(r.overdue_amount),
    })
  })

export const getInvoice = (id: string, client?: DbClient) =>
  guarded<Invoice>('Invoice', client, async (c) => {
    const head = await c.from('invoice_list').select('*').eq('id', id).maybeSingle()
    if (head.error && head.error.code !== '22P02') return err(mapReadError(head.error, 'Invoice'))
    if (head.error || !head.data) {
      return err({ code: 'not_found', message: 'This invoice could not be found.' })
    }
    const r = head.data as Row
    const [items, customer] = await Promise.all([
      c
        .from('invoice_items')
        .select('id, product_id, description, quantity, unit_price')
        .eq('invoice_id', id)
        .order('position')
        .order('id'),
      c
        .from('customers')
        .select(
          'name, company_name, email, phone, registration_number, street_address, suburb, city, province, postal_code',
        )
        .eq('id', String(r.customer_id))
        .maybeSingle(),
    ])
    // Without its lines the invoice would show the wrong picture, so that is a failure.
    if (items.error) return err(mapReadError(items.error, 'Invoice'))
    const cu = (customer.data ?? {}) as Row
    return ok({
      ...fromListRow(r),
      orderId: str(r.order_id),
      orderReference: str(r.order_reference),
      propertyId: str(r.property_id),
      propertyName: str(r.property_name),
      paymentTerms: String(r.payment_terms) as PaymentTerms,
      discountPercent: num(r.discount_percent),
      vatRate: num(r.vat_rate),
      subtotal: num(r.subtotal),
      discount: num(r.discount),
      tax: num(r.tax),
      notes: str(r.notes),
      cancelReason: str(r.cancel_reason),
      sentAt: str(r.sent_at),
      customerEmail: str(r.customer_email),
      items: ((items.data ?? []) as Row[]).map((i) => ({
        id: String(i.id),
        productId: str(i.product_id),
        description: String(i.description),
        quantity: num(i.quantity),
        unitPrice: num(i.unit_price),
      })),
      billTo: {
        name: str(cu.name) ?? String(r.customer_name),
        companyName: str(cu.company_name),
        email: str(cu.email),
        phone: str(cu.phone),
        registrationNumber: str(cu.registration_number),
        address: [
          str(cu.street_address),
          str(cu.suburb),
          [str(cu.city), str(cu.postal_code)].filter(Boolean).join(' ') || null,
          str(cu.province),
        ].filter((x): x is string => Boolean(x)),
      },
    })
  })

/** Creates (id null) or edits a draft with its lines. Totals are the database's to set. */
export const saveInvoice = (id: string | null, input: InvoiceInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'invoice',
    client,
    async (c) => {
      const { data, error } = await c.rpc('save_invoice', {
        p_invoice_id: id,
        p_customer_id: input.customerId,
        p_items: input.items.map((i) => ({
          product_id: i.productId,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unitPrice,
        })),
        p_property_id: input.propertyId,
        p_order_id: input.orderId,
        p_payment_terms: input.paymentTerms,
        p_due_date: input.dueDate,
        p_discount_percent: input.discountPercent,
        p_vat_rate: input.vatRate,
        p_notes: input.notes,
      })
      if (error) return err(mapWriteError(error, 'invoice'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

/** A draft invoice with the order's lines. */
export const invoiceOrder = (orderId: string, client?: DbClient) =>
  guarded<{ id: string }>(
    'invoice',
    client,
    async (c) => {
      const { data, error } = await c.rpc('invoice_order', { p_order_id: orderId })
      if (error) return err(mapWriteError(error, 'invoice'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

const patchInvoice = (id: string, patch: Row, client?: DbClient) =>
  guarded<{ id: string }>(
    'invoice',
    client,
    async (c) => {
      const { data, error } = await c.from('invoices').update(patch).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'invoice'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This invoice could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

/** Issues a draft: the database numbers it and sets its dates. */
export const issueInvoice = (id: string, issueDate: string, client?: DbClient) =>
  patchInvoice(id, { status: 'sent', issue_date: issueDate }, client)

export const cancelInvoice = (id: string, reason: string, client?: DbClient) =>
  patchInvoice(id, { status: 'cancelled', cancel_reason: reason }, client)

// Payments ---------------------------------------------------------------------------------------
const fromPaymentRow = (r: Row): Payment => ({
  id: String(r.id),
  referenceNumber: String(r.reference_number),
  invoiceId: String(r.invoice_id),
  invoiceNumber: str(r.invoice_number),
  customerId: String(r.customer_id),
  customerName: String(r.customer_name),
  amount: num(r.amount),
  method: String(r.method) as PaymentMethodCode,
  reference: str(r.reference),
  notes: str(r.notes),
  paidOn: String(r.paid_on),
  recordedByName: str(r.recorded_by_name),
})

export interface PaymentFilters {
  method: PaymentMethodCode | ''
  from: string
  to: string
}

export const listPayments = (
  query: ListQuery<PaymentSort>,
  filters: PaymentFilters,
  client?: DbClient,
) =>
  guarded<Page<Payment>>('Payments', client, async (c) => {
    let q = c.from('payment_list').select('*', { count: 'exact' })
    if (filters.method) q = q.eq('method', filters.method)
    if (filters.from) q = q.gte('paid_on', filters.from)
    if (filters.to) q = q.lte('paid_on', filters.to)
    const or = orIlike(
      ['reference_number', 'invoice_number', 'customer_name', 'reference'],
      query.search,
    )
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Payments'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromPaymentRow) })
  })

export const getInvoicePayments = (invoiceId: string, client?: DbClient) =>
  guarded<Payment[]>('Payments', client, async (c) => {
    const { data, error } = await c
      .from('payment_list')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('paid_at')
      .order('number')
    if (error) return err(mapReadError(error, 'Payments'))
    return ok((data ?? []).map(fromPaymentRow))
  })

export const recordPayment = (input: PaymentInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'payment',
    client,
    async (c) => {
      const { data, error } = await c
        .from('payments')
        .insert({
          invoice_id: input.invoiceId,
          amount: input.amount,
          // Midday in South Africa, so the date is the same whichever time zone reads it.
          paid_at: `${input.paidOn}T12:00:00+02:00`,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
        })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'payment'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

/** Managers and administrators only; zero rows deleted means not permitted. */
export const removePayment = (id: string, client?: DbClient) =>
  guarded<void>(
    'payment',
    client,
    async (c) => {
      const { data, error } = await c.from('payments').delete().eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'payment'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message:
            'This payment could not be removed. Only a manager or administrator can do this.',
        })
      }
      return ok(undefined)
    },
    mapWriteError,
  )

// Billing profile --------------------------------------------------------------------------------
export const getBillingProfile = (client?: DbClient) =>
  guarded<BillingProfile>('Billing details', client, async (c) => {
    const { data, error } = await c.rpc('billing_profile').maybeSingle()
    if (error) return err(mapReadError(error, 'Billing details'))
    if (!data) return err({ code: 'not_found', message: 'Your business could not be found.' })
    const r = data as Row
    return ok({
      name: String(r.name),
      email: str(r.email),
      phone: str(r.phone),
      address: str(r.address),
      registrationNumber: str(r.registration_number),
      vatRegistered: r.vat_registered !== false,
      vatNumber: str(r.vat_number),
      bankName: str(r.bank_name),
      bankAccountName: str(r.bank_account_name),
      bankAccountNumber: str(r.bank_account_number),
      bankBranchCode: str(r.bank_branch_code),
      paymentInstructions: str(r.payment_instructions),
      invoiceFooter: str(r.invoice_footer),
      defaultPaymentTerms: (str(r.default_payment_terms) ?? 'net30') as PaymentTerms,
    })
  })

/** Administrators only (enforced by the database; zero rows means not permitted). */
export const updateBillingProfile = (businessId: string, p: BillingProfile, client?: DbClient) =>
  guarded<void>(
    'billing details',
    client,
    async (c) => {
      const { data, error } = await c
        .from('businesses')
        .update({
          name: p.name,
          email: p.email,
          phone: p.phone,
          address: p.address,
          registration_number: p.registrationNumber,
          vat_registered: p.vatRegistered,
          vat_number: p.vatNumber,
          bank_name: p.bankName,
          bank_account_name: p.bankAccountName,
          bank_account_number: p.bankAccountNumber,
          bank_branch_code: p.bankBranchCode,
          payment_instructions: p.paymentInstructions,
          invoice_footer: p.invoiceFooter,
          default_payment_terms: p.defaultPaymentTerms,
        })
        .eq('id', businessId)
        .select('id')
      if (error) return err(mapWriteError(error, 'billing details'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message: 'Only an administrator can change the billing details.',
        })
      }
      return ok(undefined)
    },
    mapWriteError,
  )
