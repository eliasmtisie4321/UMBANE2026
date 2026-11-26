import {
  LEAD_SOURCES,
  LEAD_STAGES,
  type ActivityInput,
  type ActivityKind,
  type Lead,
  type LeadInput,
  type LeadSource,
  type LeadStage,
  type Order,
  type OrderInput,
  type PaymentMethod,
  type SalesActivity,
} from '@/types/sales'
import { businessToday } from './consumption'
import { isRealDate } from './meterForm'
import {
  centsToRand,
  orderTotals,
  parseCents,
  parsePercent,
  parseQuantity,
  type OrderTotals,
} from './orderMath'
import { normalizePhone } from './phone'
import { isValidEmail } from './validation'

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())
const AMOUNT_HELP = 'Enter an amount in rand, for example 1500.50 (no commas).'
/** numeric(12,2) in the database. */
const MAX_CENTS = 999_999_999_999n
const MAX_UNIT_CENTS = 999_999_999n

// Leads ------------------------------------------------------------------------------------------
export interface LeadFormValues {
  name: string
  companyName: string
  email: string
  phone: string
  source: LeadSource | ''
  serviceInterest: string
  estimatedValue: string
  expectedClose: string
  followUpOn: string
  assignedTo: string
  stage: LeadStage
  notes: string
}
export type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>

export const emptyLeadForm: LeadFormValues = {
  name: '',
  companyName: '',
  email: '',
  phone: '',
  source: '',
  serviceInterest: '',
  estimatedValue: '',
  expectedClose: '',
  followUpOn: '',
  assignedTo: '',
  stage: 'new',
  notes: '',
}

export function validateLeadForm(v: LeadFormValues): LeadFormErrors {
  const e: LeadFormErrors = {}
  if (v.name.trim().length < 2) e.name = 'Enter the contact’s name.'
  else if (v.name.length > 160) e.name = 'Keep the name under 160 characters.'
  if (v.companyName.length > 160) e.companyName = 'Keep the company name under 160 characters.'
  const email = v.email.trim()
  const phone = v.phone.trim()
  if (email && !isValidEmail(email)) e.email = 'Enter a valid email address.'
  if (phone && !normalizePhone(phone)) e.phone = 'Enter a valid phone number, e.g. 082 441 9082.'
  if (!email && !phone) e.phone = 'Enter a phone number or an email address.'
  if (!LEAD_SOURCES.some((s) => s.value === v.source))
    e.source = 'Choose where this lead came from.'
  if (v.serviceInterest.length > 160) e.serviceInterest = 'Keep this under 160 characters.'
  const value = v.estimatedValue.trim() ? parseCents(v.estimatedValue) : 0n
  if (value === null || value > MAX_CENTS) e.estimatedValue = AMOUNT_HELP
  if (v.expectedClose && !isRealDate(v.expectedClose)) e.expectedClose = 'Enter a valid date.'
  if (v.followUpOn && !isRealDate(v.followUpOn)) e.followUpOn = 'Enter a valid date.'
  if (!LEAD_STAGES.some((s) => s.value === v.stage)) e.stage = 'Choose a stage.'
  if (v.notes.length > 2000) e.notes = 'Keep the notes under 2,000 characters.'
  return e
}

export const toLeadInput = (v: LeadFormValues, closed = false): LeadInput => {
  const cents = v.estimatedValue.trim() ? parseCents(v.estimatedValue) : null
  return {
    name: v.name.trim(),
    companyName: orNull(v.companyName),
    email: orNull(v.email)?.toLowerCase() ?? null,
    phone: v.phone.trim() ? normalizePhone(v.phone) : null,
    source: v.source as LeadSource,
    serviceInterest: orNull(v.serviceInterest),
    estimatedValue: cents === null ? null : centsToRand(cents),
    expectedClose: v.expectedClose || null,
    followUpOn: v.followUpOn || null,
    assignedTo: v.assignedTo || null,
    notes: orNull(v.notes),
    stage: closed ? null : v.stage,
  }
}

export const leadToForm = (l: Lead): LeadFormValues => ({
  name: l.name,
  companyName: l.companyName ?? '',
  email: l.email ?? '',
  phone: l.phone ?? '',
  source: l.source ?? '',
  serviceInterest: l.serviceInterest ?? '',
  estimatedValue: l.estimatedValue === null ? '' : String(l.estimatedValue),
  expectedClose: l.expectedClose ?? '',
  followUpOn: l.followUpOn ?? '',
  assignedTo: l.assignedTo ?? '',
  stage: LEAD_STAGES.find((s) => s.value === l.status)?.value ?? 'new',
  notes: l.notes ?? '',
})

// Orders -----------------------------------------------------------------------------------------
export interface OrderLine {
  /** Stable key for React; not sent. */
  key: number
  productId: string | null
  description: string
  quantity: string
  unitPrice: string
}

export interface OrderFormValues {
  customerId: string
  propertyId: string
  leadId: string | null
  assignedTo: string
  orderDate: string
  paymentMethod: PaymentMethod | ''
  discountPercent: string
  vatRate: string
  notes: string
  lines: OrderLine[]
}

export interface OrderFormErrors {
  customerId?: string
  orderDate?: string
  discountPercent?: string
  notes?: string
  lines?: string
  /** Per line key. */
  line: Record<number, Partial<Record<'description' | 'quantity' | 'unitPrice', string>>>
}

export const blankLine = (key: number): OrderLine => ({
  key,
  productId: null,
  description: '',
  quantity: '1',
  unitPrice: '',
})

export const emptyOrderForm = (): OrderFormValues => ({
  customerId: '',
  propertyId: '',
  leadId: null,
  assignedTo: '',
  orderDate: businessToday(),
  paymentMethod: '',
  discountPercent: '0',
  vatRate: '15',
  notes: '',
  lines: [blankLine(1)],
})

export function validateOrderForm(v: OrderFormValues, today = businessToday()): OrderFormErrors {
  const e: OrderFormErrors = { line: {} }
  if (!v.customerId) e.customerId = 'Choose the customer.'
  if (!isRealDate(v.orderDate)) e.orderDate = 'Enter the order date.'
  else if (v.orderDate > today) e.orderDate = 'The order date cannot be in the future.'
  if (parsePercent(v.discountPercent.trim() || '0') === null)
    e.discountPercent = 'Enter a discount from 0 to 100.'
  if (v.notes.length > 2000) e.notes = 'Keep the notes under 2,000 characters.'
  Object.assign(e, validateLines(v))
  return e
}

export interface LineErrors {
  lines?: string
  /** Per line key. */
  line: Record<number, Partial<Record<'description' | 'quantity' | 'unitPrice', string>>>
}

/** The lines of an order or invoice, and whether their total fits the database. */
export function validateLines(v: {
  lines: OrderLine[]
  discountPercent: string
  vatRate: string
}): LineErrors {
  const e: LineErrors = { line: {} }
  if (v.lines.length === 0) e.lines = 'Add at least one product or service.'
  else if (v.lines.length > 100) e.lines = 'At most 100 lines are allowed.'
  for (const l of v.lines) {
    const le: LineErrors['line'][number] = {}
    const text = l.description.trim()
    if (text.length < 2) le.description = 'Describe the product or service.'
    else if (text.length > 300) le.description = 'Keep this under 300 characters.'
    if (parseQuantity(l.quantity) === null) le.quantity = 'Whole number, 1 to 100,000.'
    const price = parseCents(l.unitPrice)
    if (price === null || price > MAX_UNIT_CENTS) le.unitPrice = 'Amount in rand, e.g. 1500.50.'
    if (Object.keys(le).length > 0) e.line[l.key] = le
  }
  if (Object.keys(e.line).length === 0 && !e.lines && totalsOf(v).total > 9_999_999_999.99)
    e.lines = 'The total is too large.'
  return e
}

export const hasOrderErrors = (e: LineErrors & object): boolean =>
  Object.keys(e.line).length > 0 ||
  Object.entries(e).some(([k, x]) => k !== 'line' && x !== undefined)

/** Live totals while typing; lines that are not complete yet count as nothing. */
export function totalsOf(v: {
  lines: OrderLine[]
  discountPercent: string
  vatRate: string
}): OrderTotals {
  const lines = v.lines.flatMap((l) => {
    const quantity = parseQuantity(l.quantity)
    const unitCents = parseCents(l.unitPrice)
    return quantity === null || unitCents === null ? [] : [{ quantity, unitCents }]
  })
  return orderTotals(lines, parsePercent(v.discountPercent.trim() || '0') ?? 0n, Number(v.vatRate))
}

export const toOrderInput = (v: OrderFormValues): OrderInput => ({
  customerId: v.customerId,
  propertyId: v.propertyId || null,
  leadId: v.leadId,
  assignedTo: v.assignedTo || null,
  orderDate: v.orderDate,
  paymentMethod: v.paymentMethod || null,
  discountPercent: centsToRand(parsePercent(v.discountPercent.trim() || '0') ?? 0n),
  vatRate: Number(v.vatRate),
  notes: orNull(v.notes),
  items: toItems(v.lines),
})

export const toItems = (lines: OrderLine[]) =>
  lines.map((l) => ({
    productId: l.productId,
    description: l.description.trim(),
    quantity: parseQuantity(l.quantity) ?? 0,
    unitPrice: centsToRand(parseCents(l.unitPrice) ?? 0n),
  }))

export const toDiscount = (text: string) => centsToRand(parsePercent(text.trim() || '0') ?? 0n)

export const itemsToLines = (
  items: Array<{
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
  }>,
): OrderLine[] =>
  items.map((i, n) => ({
    key: n + 1,
    productId: i.productId,
    description: i.description,
    quantity: String(i.quantity),
    unitPrice: String(i.unitPrice),
  }))

export const orderToForm = (o: Order): OrderFormValues => ({
  customerId: o.customerId,
  propertyId: o.propertyId ?? '',
  leadId: o.leadId,
  assignedTo: o.assignedTo ?? '',
  orderDate: o.orderDate,
  paymentMethod: o.paymentMethod ?? '',
  discountPercent: String(o.discountPercent),
  vatRate: String(o.vatRate),
  notes: o.notes ?? '',
  lines: o.items.map((i, n) => ({
    key: n + 1,
    productId: i.productId,
    description: i.description,
    quantity: String(i.quantity),
    unitPrice: String(i.unitPrice),
  })),
})

// Activities -------------------------------------------------------------------------------------
export interface ActivityFormValues {
  kind: ActivityKind
  subject: string
  dueOn: string
  assignedTo: string
  outcome: string
  done: boolean
}
export type ActivityFormErrors = Partial<Record<keyof ActivityFormValues, string>>

export const emptyActivityForm: ActivityFormValues = {
  kind: 'call',
  subject: '',
  dueOn: '',
  assignedTo: '',
  outcome: '',
  done: false,
}

export function validateActivityForm(v: ActivityFormValues): ActivityFormErrors {
  const e: ActivityFormErrors = {}
  if (v.subject.trim().length < 3) e.subject = 'Say what this is about.'
  else if (v.subject.length > 200) e.subject = 'Keep this under 200 characters.'
  if (v.dueOn && !isRealDate(v.dueOn)) e.dueOn = 'Enter a valid date.'
  if (v.outcome.length > 1000) e.outcome = 'Keep the outcome under 1,000 characters.'
  return e
}

export const toActivityInput = (v: ActivityFormValues): ActivityInput => ({
  kind: v.kind,
  subject: v.subject.trim(),
  dueOn: v.dueOn || null,
  assignedTo: v.assignedTo || null,
  outcome: orNull(v.outcome),
  done: v.done,
})

export const activityToForm = (a: SalesActivity): ActivityFormValues => ({
  kind: a.kind,
  subject: a.subject,
  dueOn: a.dueOn ?? '',
  assignedTo: a.assignedTo ?? '',
  outcome: a.outcome ?? '',
  done: a.completedAt !== null,
})

/** Clears the errors of edited line fields; lines added or removed clear the list-level error. */
export function clearLineErrors<E extends LineErrors>(
  e: E,
  key: number | null,
  fields: string[],
): E {
  if (key === null) return { ...e, lines: undefined }
  const line = { ...e.line, [key]: { ...e.line[key] } }
  for (const f of fields) delete line[key][f as keyof (typeof line)[number]]
  return { ...e, line, lines: undefined }
}

/** The element id of the first line field with an error, for focusing. */
export function firstLineErrorId(lines: OrderLine[], errors: LineErrors): string | null {
  const bad = lines.find((l) => errors.line[l.key])
  return bad ? `line-${bad.key}-${Object.keys(errors.line[bad.key])[0]}` : null
}
