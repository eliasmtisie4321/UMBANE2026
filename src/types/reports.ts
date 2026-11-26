/**
 * Report data as the report_* database functions return it (keys converted to camelCase).
 * Definitions of every figure are in docs/REPORTS.md.
 */

export interface ReportRange {
  /** Inclusive South African calendar dates, YYYY-MM-DD. */
  from: string
  to: string
}

/** One slice of a breakdown. `key` is null when the category was not filled in. */
export interface Slice {
  key: string | null
  count: number
}

export interface OverviewMonth {
  month: string
  collected: number
  kwh: number
}

export interface OverviewReport {
  collected: number
  collectedPrior: number
  invoiced: number
  invoicedPaid: number
  kwh: number
  kwhPrior: number
  customers: number
  newCustomers: number
  properties: number
  metersInService: number
  orders: number
  orderValue: number
  products: number
  stockValue: number
  ticketsOpened: number
  ticketsResolved: number
  tasksCompleted: number
  months: OverviewMonth[]
}

export interface CustomerRow {
  id: string
  name: string
  customerType: string
  segment: string | null
  province: string | null
  status: string
  createdOn: string
  properties: number
  meters: number
  billed: number
  paid: number
  balance: number
  lastActivity: string | null
}

export interface GrowthMonth {
  month: string
  new: number
  total: number
}

export interface CustomerReport {
  total: number
  new: number
  byStatus: Record<string, number>
  bySegment: Slice[]
  byProvince: Slice[]
  byType: Slice[]
  months: GrowthMonth[]
  billed: number
  paid: number
  rowCount: number
  rows: CustomerRow[]
}

export interface PropertyRow {
  id: string
  name: string | null
  address: string
  reference: string | null
  propertyType: string | null
  province: string | null
  city: string | null
  status: string
  units: number | null
  createdOn: string
  customerName: string
  meters: number
  kwh: number
}

export interface PropertyReport {
  total: number
  new: number
  units: number
  metersInService: number
  withoutMeter: number
  kwh: number
  byStatus: Record<string, number>
  byType: Slice[]
  byProvince: Slice[]
  months: GrowthMonth[]
  rowCount: number
  rows: PropertyRow[]
}

export interface ReadingRow {
  id: string
  readingDate: string
  meterId: string
  serialNumber: string
  propertyName: string
  previousDate: string | null
  previousValue: number | null
  readingValue: number
  consumption: number | null
  isEstimate: boolean
  flag: 'high' | 'low' | null
}

export interface ElectricityReport {
  kwh: number
  estimatedKwh: number
  kwhPrior: number
  kwhLastYear: number
  days: number
  meters: number
  metersReporting: number
  months: Array<{ month: string; kwh: number }>
  byProperty: Array<{ id: string; name: string; kwh: number; meters: number }>
  byMeterType: Array<{ key: string | null; kwh: number; meters: number }>
  byMeter: Array<{
    id: string
    serialNumber: string
    propertyName: string
    meterType: string | null
    kwh: number
    estimatedKwh: number
  }>
  properties: Array<{ id: string; name: string }>
  rowCount: number
  rows: ReadingRow[]
}

export interface InvoiceReportRow {
  id: string
  invoiceNumber: string
  orderReference: string | null
  customerName: string
  issueDate: string
  dueDate: string | null
  total: number
  paid: number
  balance: number
  status: string
  lastPaidOn: string | null
  method: string | null
}

export interface SalesReport {
  orders: number
  orderValue: number
  orderValuePrior: number
  ordersByStatus: Array<{ key: string; count: number; value: number }>
  topItems: Array<{ name: string; quantity: number; value: number }>
  invoices: number
  invoiced: number
  paidCount: number
  paidAmount: number
  unpaidCount: number
  unpaidBalance: number
  overdueCount: number
  overdueBalance: number
  outstanding: number
  avgSettlementDays: number | null
  months: Array<{
    month: string
    orderValue: number
    orders: number
    invoiced: number
    collected: number
  }>
  rowCount: number
  rows: InvoiceReportRow[]
}

export interface PaymentReportRow {
  id: string
  referenceNumber: string
  paidOn: string
  customerName: string
  invoiceNumber: string
  invoiceId: string
  method: string
  amount: number
  reference: string | null
  recordedByName: string | null
}

export interface RevenueReport {
  collected: number
  payments: number
  collectedPrior: number
  collectedYear: number
  invoiced: number
  outstanding: number
  outstandingCount: number
  months: Array<{ month: string; collected: number; invoiced: number }>
  byMethod: Array<{ key: string; amount: number; count: number }>
  bySegment: Array<{ key: string | null; amount: number; count: number }>
  topCustomers: Array<{ id: string; name: string; amount: number }>
  rowCount: number
  rows: PaymentReportRow[]
}

export interface ProductReportRow {
  id: string
  sku: string
  name: string
  category: string | null
  isActive: boolean
  trackStock: boolean
  stockOnHand: number
  costPrice: number | null
  unitPrice: number
  stockValue: number | null
  stockStatus: 'in' | 'low' | 'out' | 'service'
  lowStockThreshold: number
  inbound: number
  outbound: number
  lastOut: string | null
}

export interface InventoryReport {
  products: number
  units: number
  stockValue: number
  low: number
  out: number
  unvalued: number
  inbound: number
  outbound: number
  byType: Array<{ key: string; units: number; count: number }>
  months: Array<{ month: string; inbound: number; outbound: number }>
  byCategory: Array<{ key: string | null; products: number; units: number; value: number }>
  fast: Array<{ id: string; sku: string; name: string; outbound: number; stockOnHand: number }>
  slow: Array<{
    id: string
    sku: string
    name: string
    outbound: number
    stockOnHand: number
    lastOut: string | null
  }>
  rowCount: number
  rows: ProductReportRow[]
}

export interface TicketReportRow {
  id: string
  reference: string
  subject: string
  customerName: string
  category: string
  priority: string
  status: string
  assigneeName: string | null
  createdAt: string
  firstResponseAt: string | null
  resolvedAt: string | null
}

export interface SupportReport {
  opened: number
  resolved: number
  openNow: number
  urgentOpen: number
  unassignedOpen: number
  avgFirstResponseHours: number | null
  avgResolutionHours: number | null
  byStatus: Record<string, number>
  byCategory: Slice[]
  byPriority: Slice[]
  byAssignee: Array<{
    id: string | null
    name: string | null
    tickets: number
    resolved: number
    avgResolutionHours: number | null
  }>
  months: Array<{ month: string; opened: number; resolved: number }>
  rowCount: number
  rows: TicketReportRow[]
}

export interface TeamReportRow {
  id: string
  fullName: string
  jobTitle: string | null
  department: string | null
  employmentStatus: string
  isActive: boolean
  role: string
  assigned: number
  assignedDone: number
  completed: number
  withDue: number
  onTime: number
  pending: number
  overdue: number
  fieldOpen: number
  ticketsResolved: number
}

export interface TeamReport {
  employees: number
  byEmployment: Record<string, number>
  assigned: number
  assignedDone: number
  completed: number
  withDue: number
  onTime: number
  pending: number
  overdue: number
  ticketsResolved: number
  unassignedOpen: number
  byDepartment: Array<{
    key: string | null
    people: number
    completed: number
    withDue: number
    onTime: number
    pending: number
    overdue: number
  }>
  months: Array<{ month: string; created: number; completed: number }>
  rowCount: number
  rows: TeamReportRow[]
}
