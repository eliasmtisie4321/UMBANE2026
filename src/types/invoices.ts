export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'cancelled'
/** What people see: an unpaid invoice past its due date shows as overdue. */
export type DisplayStatus = InvoiceStatus | 'overdue'
export type PaymentTerms = 'receipt' | 'net7' | 'net14' | 'net30'
export type PaymentMethodCode = 'eft' | 'card' | 'cash' | 'debit_order' | 'other'

export const DISPLAY_STATUSES: Array<{ value: DisplayStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const PAYMENT_TERMS: Array<{ value: PaymentTerms; label: string }> = [
  { value: 'receipt', label: 'Due on receipt' },
  { value: 'net7', label: 'Net 7 days' },
  { value: 'net14', label: 'Net 14 days' },
  { value: 'net30', label: 'Net 30 days' },
]

export const PAYMENT_METHOD_CODES: Array<{ value: PaymentMethodCode; label: string }> = [
  { value: 'eft', label: 'EFT bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'debit_order', label: 'Debit order' },
  { value: 'other', label: 'Other' },
]

export interface InvoiceListItem {
  id: string
  invoiceNumber: string | null
  reference: string
  customerId: string
  customerName: string
  issueDate: string | null
  dueDate: string | null
  status: InvoiceStatus
  displayStatus: DisplayStatus
  total: number
  paid: number
  balance: number
  isOverdue: boolean
}

export type InvoiceSort = 'issue_date' | 'due_date' | 'total' | 'balance' | 'created_at'

export interface InvoiceItem {
  id: string
  productId: string | null
  description: string
  quantity: number
  unitPrice: number
}

export interface BillTo {
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  registrationNumber: string | null
  address: string[]
}

export interface Invoice extends InvoiceListItem {
  orderId: string | null
  orderReference: string | null
  propertyId: string | null
  propertyName: string | null
  paymentTerms: PaymentTerms
  discountPercent: number
  vatRate: number
  subtotal: number
  discount: number
  tax: number
  notes: string | null
  cancelReason: string | null
  sentAt: string | null
  customerEmail: string | null
  items: InvoiceItem[]
  billTo: BillTo
}

export interface InvoiceInput {
  customerId: string
  propertyId: string | null
  orderId: string | null
  paymentTerms: PaymentTerms
  /** Null: worked out from the terms when the invoice is issued. */
  dueDate: string | null
  discountPercent: number
  vatRate: number
  notes: string | null
  items: Array<{
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
  }>
}

export interface InvoiceSummary {
  drafts: number
  issued: number
  paid: number
  unpaid: number
  overdue: number
  outstanding: number
  overdueAmount: number
}

export interface Payment {
  id: string
  referenceNumber: string
  invoiceId: string
  invoiceNumber: string | null
  customerId: string
  customerName: string
  amount: number
  method: PaymentMethodCode
  reference: string | null
  notes: string | null
  paidOn: string
  recordedByName: string | null
}

export type PaymentSort = 'paid_at' | 'amount' | 'number'

export interface PaymentInput {
  invoiceId: string
  amount: number
  /** YYYY-MM-DD, South African date. */
  paidOn: string
  method: PaymentMethodCode
  reference: string | null
  notes: string | null
}

export interface BillingProfile {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  registrationNumber: string | null
  vatRegistered: boolean
  vatNumber: string | null
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null
  bankBranchCode: string | null
  paymentInstructions: string | null
  invoiceFooter: string | null
  defaultPaymentTerms: PaymentTerms
}
