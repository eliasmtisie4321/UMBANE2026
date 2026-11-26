export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation'
export type LeadStatus = LeadStage | 'converted' | 'lost'
export type LeadSource = 'web' | 'referral' | 'tender' | 'outreach' | 'partner' | 'other'

export const LEAD_STAGES: Array<{ value: LeadStage; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
]

export const LEAD_STATUSES: Array<{ value: LeadStatus; label: string }> = [
  ...LEAD_STAGES,
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
]

/** Stages a lead must have reached before it can become a customer (enforced by the database). */
export const APPROVED_STAGES: readonly LeadStatus[] = ['qualified', 'proposal', 'negotiation']

export const LEAD_SOURCES: Array<{ value: LeadSource; label: string }> = [
  { value: 'web', label: 'Inbound web' },
  { value: 'referral', label: 'Referral' },
  { value: 'tender', label: 'Municipal tender' },
  { value: 'outreach', label: 'Direct outreach' },
  { value: 'partner', label: 'Partner network' },
  { value: 'other', label: 'Other' },
]

export interface Lead {
  id: string
  reference: string
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: LeadSource | null
  serviceInterest: string | null
  status: LeadStatus
  estimatedValue: number | null
  expectedClose: string | null
  followUpOn: string | null
  followUpOverdue: boolean
  assignedTo: string | null
  assignedName: string | null
  notes: string | null
  lostReason: string | null
  closedOn: string | null
  customerId: string | null
  customerName: string | null
  createdAt: string
  isOpen: boolean
}

export type LeadSort = 'created_at' | 'name' | 'estimated_value' | 'follow_up_on'

export interface LeadInput {
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: LeadSource
  serviceInterest: string | null
  estimatedValue: number | null
  expectedClose: string | null
  followUpOn: string | null
  assignedTo: string | null
  notes: string | null
  /** Null leaves the stage alone (a closed lead's status is not edited through the form). */
  stage: LeadStage | null
}

export interface LeadStageTotal {
  status: LeadStatus
  count: number
  value: number
}

export interface LeadMatch {
  id: string
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  matchedOn: 'email' | 'phone' | 'company'
}

export type OrderStatus = 'pending' | 'confirmed' | 'fulfilled' | 'cancelled'
export type PaymentMethod = 'eft' | 'account' | 'card' | 'debit_order'

export const ORDER_STATUSES: Array<{ value: OrderStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'eft', label: 'EFT bank transfer' },
  { value: 'account', label: '30-day account' },
  { value: 'card', label: 'Card' },
  { value: 'debit_order', label: 'Monthly debit order' },
]

export const VAT_RATES = [
  { value: '15', label: 'Standard (15%)' },
  { value: '0', label: 'No VAT (0%)' },
]

export interface OrderListItem {
  id: string
  reference: string
  customerId: string
  customerName: string
  orderDate: string
  status: OrderStatus
  total: number
  itemCount: number
  firstItem: string | null
  assignedName: string | null
}

export interface OrderItem {
  id: string
  productId: string | null
  sku: string | null
  description: string
  quantity: number
  unitPrice: number
}

export interface Order extends OrderListItem {
  propertyId: string | null
  propertyName: string | null
  leadId: string | null
  paymentMethod: PaymentMethod | null
  discountPercent: number
  vatRate: number
  subtotal: number
  discount: number
  tax: number
  notes: string | null
  cancelReason: string | null
  assignedTo: string | null
  createdAt: string
  items: OrderItem[]
}

export type OrderSort = 'order_date' | 'total' | 'status' | 'number'

export interface OrderInput {
  customerId: string
  propertyId: string | null
  leadId: string | null
  assignedTo: string | null
  orderDate: string
  paymentMethod: PaymentMethod | null
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

export interface SalesSummary {
  pendingCount: number
  pendingValue: number
  confirmedCount: number
  confirmedValue: number
  fulfilledCount: number
  cancelledCount: number
}

export interface ProductOption {
  id: string
  sku: string
  name: string
  unitPrice: number
  trackStock: boolean
  stockOnHand: number
}

export interface TimelineEntry {
  id: string
  fromStatus: string | null
  toStatus: string
  note: string | null
  actorName: string | null
  createdAt: string
}

export type ActivityKind = 'call' | 'email' | 'meeting' | 'site_visit' | 'task'

export const ACTIVITY_KINDS: Array<{ value: ActivityKind; label: string }> = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'site_visit', label: 'Site visit' },
  { value: 'task', label: 'Task' },
]

/** What an activity is about. */
export type ActivitySubject = { leadId: string } | { orderId: string }
/** Records with a status history. */
export type HistorySubject = ActivitySubject | { invoiceId: string }

export interface SalesActivity {
  id: string
  leadId: string | null
  orderId: string | null
  kind: ActivityKind
  subject: string
  dueOn: string | null
  assignedTo: string | null
  assignedName: string | null
  outcome: string | null
  completedAt: string | null
  isOverdue: boolean
  subjectName: string | null
  subjectReference: string | null
}

export interface ActivityInput {
  kind: ActivityKind
  subject: string
  dueOn: string | null
  assignedTo: string | null
  outcome: string | null
  done: boolean
}
