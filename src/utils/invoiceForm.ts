import type {
  BillingProfile,
  Invoice,
  InvoiceInput,
  PaymentInput,
  PaymentMethodCode,
  PaymentTerms,
} from '@/types/invoices'
import { PAYMENT_TERMS } from '@/types/invoices'
import { businessToday } from './consumption'
import { isRealDate } from './meterForm'
import { centsToRand, parseCents, parsePercent } from './orderMath'
import { normalizePhone } from './phone'
import {
  blankLine,
  itemsToLines,
  toDiscount,
  toItems,
  validateLines,
  type LineErrors,
  type OrderLine,
} from './salesForm'
import { isValidEmail } from './validation'

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

// Invoice ----------------------------------------------------------------------------------------
export interface InvoiceFormValues {
  customerId: string
  propertyId: string
  orderId: string | null
  paymentTerms: PaymentTerms
  /** Empty: worked out from the terms when issued. */
  dueDate: string
  discountPercent: string
  vatRate: string
  notes: string
  lines: OrderLine[]
}

export interface InvoiceFormErrors extends LineErrors {
  customerId?: string
  dueDate?: string
  discountPercent?: string
  notes?: string
}

export const emptyInvoiceForm = (
  terms: PaymentTerms = 'net30',
  vatRegistered = true,
): InvoiceFormValues => ({
  customerId: '',
  propertyId: '',
  orderId: null,
  paymentTerms: terms,
  dueDate: '',
  discountPercent: '0',
  vatRate: vatRegistered ? '15' : '0',
  notes: '',
  lines: [blankLine(1)],
})

export function validateInvoiceForm(
  v: InvoiceFormValues,
  today = businessToday(),
): InvoiceFormErrors {
  const e: InvoiceFormErrors = { ...validateLines(v) }
  if (!v.customerId) e.customerId = 'Choose the customer.'
  if (v.dueDate && !isRealDate(v.dueDate)) e.dueDate = 'Enter a valid date.'
  else if (v.dueDate && v.dueDate < today) e.dueDate = 'The due date cannot be in the past.'
  if (!PAYMENT_TERMS.some((t) => t.value === v.paymentTerms)) e.dueDate = 'Choose payment terms.'
  if (parsePercent(v.discountPercent.trim() || '0') === null)
    e.discountPercent = 'Enter a discount from 0 to 100.'
  if (v.notes.length > 2000) e.notes = 'Keep the notes under 2,000 characters.'
  return e
}

export const toInvoiceInput = (v: InvoiceFormValues): InvoiceInput => ({
  customerId: v.customerId,
  propertyId: v.propertyId || null,
  orderId: v.orderId,
  paymentTerms: v.paymentTerms,
  dueDate: v.dueDate || null,
  discountPercent: toDiscount(v.discountPercent),
  vatRate: Number(v.vatRate),
  notes: orNull(v.notes),
  items: toItems(v.lines),
})

export const invoiceToForm = (i: Invoice): InvoiceFormValues => ({
  customerId: i.customerId,
  propertyId: i.propertyId ?? '',
  orderId: i.orderId,
  paymentTerms: i.paymentTerms,
  dueDate: i.dueDate ?? '',
  discountPercent: String(i.discountPercent),
  vatRate: String(i.vatRate),
  notes: i.notes ?? '',
  lines: itemsToLines(i.items),
})

// Payment ----------------------------------------------------------------------------------------
export interface PaymentFormValues {
  amount: string
  paidOn: string
  method: PaymentMethodCode
  reference: string
  notes: string
}
export type PaymentFormErrors = Partial<Record<keyof PaymentFormValues, string>>

export const paymentFormFor = (balance: number): PaymentFormValues => ({
  amount: balance.toFixed(2),
  paidOn: businessToday(),
  method: 'eft',
  reference: '',
  notes: '',
})

export function validatePaymentForm(
  v: PaymentFormValues,
  limits: { balance: number; issueDate: string | null },
  today = businessToday(),
): PaymentFormErrors {
  const e: PaymentFormErrors = {}
  const cents = parseCents(v.amount)
  if (cents === null || cents === 0n) e.amount = 'Enter the amount received, e.g. 1500.50.'
  else if (centsToRand(cents) > limits.balance)
    e.amount = `This is more than the balance of R ${limits.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`
  if (!isRealDate(v.paidOn)) e.paidOn = 'Enter the date it was received.'
  else if (v.paidOn > today) e.paidOn = 'A payment cannot be in the future.'
  else if (limits.issueDate && v.paidOn < limits.issueDate)
    e.paidOn = 'This is before the invoice was issued.'
  if (v.reference.length > 80) e.reference = 'Keep the reference under 80 characters.'
  if (v.notes.length > 500) e.notes = 'Keep the notes under 500 characters.'
  return e
}

export const toPaymentInput = (invoiceId: string, v: PaymentFormValues): PaymentInput => ({
  invoiceId,
  amount: centsToRand(parseCents(v.amount) ?? 0n),
  paidOn: v.paidOn,
  method: v.method,
  reference: orNull(v.reference),
  notes: orNull(v.notes),
})

// Billing profile --------------------------------------------------------------------------------
export type BillingFormValues = Record<
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'registrationNumber'
  | 'vatNumber'
  | 'bankName'
  | 'bankAccountName'
  | 'bankAccountNumber'
  | 'bankBranchCode'
  | 'paymentInstructions'
  | 'invoiceFooter',
  string
> & { vatRegistered: boolean; defaultPaymentTerms: PaymentTerms }
export type BillingFormErrors = Partial<Record<keyof BillingFormValues, string>>

export const billingToForm = (p: BillingProfile): BillingFormValues => ({
  name: p.name,
  email: p.email ?? '',
  phone: p.phone ?? '',
  address: p.address ?? '',
  registrationNumber: p.registrationNumber ?? '',
  vatRegistered: p.vatRegistered,
  vatNumber: p.vatNumber ?? '',
  bankName: p.bankName ?? '',
  bankAccountName: p.bankAccountName ?? '',
  bankAccountNumber: p.bankAccountNumber ?? '',
  bankBranchCode: p.bankBranchCode ?? '',
  paymentInstructions: p.paymentInstructions ?? '',
  invoiceFooter: p.invoiceFooter ?? '',
  defaultPaymentTerms: p.defaultPaymentTerms,
})

const digits = (s: string) => s.replace(/[\s-]/g, '')

export function validateBillingForm(v: BillingFormValues): BillingFormErrors {
  const e: BillingFormErrors = {}
  if (!v.name.trim()) e.name = 'Enter the business name.'
  if (v.email.trim() && !isValidEmail(v.email)) e.email = 'Enter a valid email address.'
  if (v.phone.trim() && !normalizePhone(v.phone)) e.phone = 'Enter a valid phone number.'
  if (v.vatRegistered && !/^4\d{9}$/.test(digits(v.vatNumber)))
    e.vatNumber = 'A South African VAT number has 10 digits and starts with 4.'
  if (v.bankAccountNumber.trim() && !/^\d{6,16}$/.test(digits(v.bankAccountNumber)))
    e.bankAccountNumber = 'Use 6 to 16 digits.'
  if (v.bankBranchCode.trim() && !/^\d{6}$/.test(digits(v.bankBranchCode)))
    e.bankBranchCode = 'Branch codes have 6 digits.'
  if (v.registrationNumber.length > 40) e.registrationNumber = 'Keep this under 40 characters.'
  for (const k of ['paymentInstructions', 'invoiceFooter'] as const)
    if (v[k].length > 500) e[k] = 'Keep this under 500 characters.'
  return e
}

export const toBillingProfile = (v: BillingFormValues): BillingProfile => ({
  name: v.name.trim(),
  email: orNull(v.email),
  phone: v.phone.trim() ? normalizePhone(v.phone) : null,
  address: orNull(v.address),
  registrationNumber: orNull(v.registrationNumber),
  vatRegistered: v.vatRegistered,
  vatNumber: v.vatRegistered ? digits(v.vatNumber) : orNull(digits(v.vatNumber)),
  bankName: orNull(v.bankName),
  bankAccountName: orNull(v.bankAccountName),
  bankAccountNumber: orNull(digits(v.bankAccountNumber)),
  bankBranchCode: orNull(digits(v.bankBranchCode)),
  paymentInstructions: orNull(v.paymentInstructions),
  invoiceFooter: orNull(v.invoiceFooter),
  defaultPaymentTerms: v.defaultPaymentTerms,
})
