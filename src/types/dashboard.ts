export type PeriodMonths = 3 | 6 | 12

export interface Totals {
  customers: number
  properties: number
  activeMeters: number
}

export interface InvoiceSummary {
  outstandingAmount: number
  outstandingCount: number
  overdueCount: number
}

export interface TicketSummary {
  open: number
  highPriority: number
  openOverSevenDays: number
}

export interface LowStockItem {
  productId: string
  sku: string
  name: string
  stockOnHand: number
  threshold: number
}

export interface LowStock {
  count: number
  items: LowStockItem[]
}

export interface RevenuePoint {
  month: string
  total: number
}

export interface Revenue {
  points: RevenuePoint[]
  total: number
  previousTotal: number
}

export interface RecentPayment {
  id: string
  amount: number
  paidAt: string
  reference: string | null
  invoiceNumber: string | null
  customerName: string | null
}

export interface RecentInvoice {
  id: string
  invoiceNumber: string
  status: string
  total: number
  balance: number
  dueDate: string | null
  isOverdue: boolean
}

export interface ActivityEntry {
  id: string
  action: string
  table: string | null
  actorName: string | null
  createdAt: string
}
