import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as messageService from '@/services/messages'
import * as notificationService from '@/services/notifications'
import * as reportService from '@/services/reports'
import type { UserRole } from '@/types/auth'
import type {
  CustomerReport,
  ElectricityReport,
  InventoryReport,
  OverviewReport,
  PropertyReport,
  RevenueReport,
  SalesReport,
  SupportReport,
  TeamReport,
} from '@/types/reports'
import * as csv from '@/utils/csv'
import * as pdf from '@/utils/reportPdf'
import { err, ok } from '@/utils/result'

vi.mock('@/services/reports')
vi.mock('@/services/messages')
vi.mock('@/services/notifications')
vi.mock('@/utils/reportPdf', async (original) => ({
  ...(await original<typeof import('@/utils/reportPdf')>()),
  buildReportPdf: vi.fn(),
}))
vi.mock('@/utils/csv', async (original) => ({
  ...(await original<typeof import('@/utils/csv')>()),
  downloadFile: vi.fn(),
}))

const r = vi.mocked(reportService)
const months = [{ month: '2024-02-01' }, { month: '2024-03-01' }]

const overview: OverviewReport = {
  collected: 1250,
  collectedPrior: 1000,
  invoiced: 1550,
  invoicedPaid: 1250,
  kwh: 510,
  kwhPrior: 0,
  customers: 2,
  newCustomers: 2,
  properties: 2,
  metersInService: 2,
  orders: 1,
  orderValue: 1150,
  products: 2,
  stockValue: 600,
  ticketsOpened: 2,
  ticketsResolved: 1,
  tasksCompleted: 2,
  months: months.map((m) => ({ ...m, collected: 625, kwh: 255 })),
}
const customers: CustomerReport = {
  total: 2,
  new: 2,
  byStatus: { active: 1, inactive: 1 },
  bySegment: [
    { key: 'residential', count: 1 },
    { key: null, count: 1 },
  ],
  byProvince: [{ key: 'Gauteng', count: 2 }],
  byType: [{ key: 'individual', count: 2 }],
  months: months.map((m, i) => ({ ...m, new: i + 1, total: i + 1 })),
  billed: 1550,
  paid: 1250,
  rowCount: 2,
  rows: [
    {
      id: 'c1',
      name: 'Kagiso Mahlangu',
      customerType: 'individual',
      segment: 'residential',
      province: 'Gauteng',
      status: 'active',
      createdOn: '2024-03-10',
      properties: 1,
      meters: 1,
      billed: 1150,
      paid: 1150,
      balance: 0,
      lastActivity: '2024-03-31',
    },
    {
      id: 'c2',
      name: '=Formula Trading',
      customerType: 'business',
      segment: null,
      province: null,
      status: 'inactive',
      createdOn: '2024-03-31',
      properties: 1,
      meters: 1,
      billed: 400,
      paid: 100,
      balance: 300,
      lastActivity: null,
    },
  ],
}
const properties: PropertyReport = {
  total: 2,
  new: 2,
  units: 41,
  metersInService: 2,
  withoutMeter: 1,
  kwh: 510,
  byStatus: { active: 2 },
  byType: [{ key: 'residential', count: 2 }],
  byProvince: [{ key: 'Gauteng', count: 2 }],
  months: months.map((m) => ({ ...m, new: 1, total: 1 })),
  rowCount: 1,
  rows: [
    {
      id: 'p1',
      name: 'Report House',
      address: '1 Report Road',
      reference: 'PROP-1',
      propertyType: 'residential',
      province: 'Gauteng',
      city: 'Johannesburg',
      status: 'active',
      units: 1,
      createdOn: '2024-03-12',
      customerName: 'Kagiso Mahlangu',
      meters: 1,
      kwh: 310,
    },
  ],
}
const electricity: ElectricityReport = {
  kwh: 510,
  estimatedKwh: 200,
  kwhPrior: 400,
  kwhLastYear: 0,
  days: 31,
  meters: 2,
  metersReporting: 2,
  months: months.map((m) => ({ ...m, kwh: 255 })),
  byProperty: [{ id: 'p1', name: 'Report House', kwh: 310, meters: 1 }],
  byMeterType: [{ key: 'smart_prepaid', kwh: 310, meters: 1 }],
  byMeter: [
    {
      id: 'm1',
      serialNumber: 'MTR-9041',
      propertyName: 'Report House',
      meterType: 'smart_prepaid',
      kwh: 310,
      estimatedKwh: 0,
    },
  ],
  properties: [{ id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Report House' }],
  rowCount: 1,
  rows: [
    {
      id: 'r1',
      readingDate: '2024-03-26',
      meterId: 'm1',
      serialNumber: 'MTR-9041',
      propertyName: 'Report House',
      previousDate: '2024-03-16',
      previousValue: 5000,
      readingValue: 5200,
      consumption: 200,
      isEstimate: true,
      flag: null,
    },
  ],
}
const sales: SalesReport = {
  orders: 1,
  orderValue: 1150,
  orderValuePrior: 0,
  ordersByStatus: [{ key: 'confirmed', count: 1, value: 1150 }],
  topItems: [{ name: 'Smart meter', quantity: 2, value: 1000 }],
  invoices: 2,
  invoiced: 1550,
  paidCount: 1,
  paidAmount: 1150,
  unpaidCount: 0,
  unpaidBalance: 0,
  overdueCount: 1,
  overdueBalance: 300,
  outstanding: 300,
  avgSettlementDays: 26,
  months: months.map((m) => ({ ...m, orderValue: 575, orders: 1, invoiced: 775, collected: 625 })),
  rowCount: 1,
  rows: [
    {
      id: 'i1',
      invoiceNumber: 'INV-2024-00001',
      orderReference: 'ORD-00001',
      customerName: 'Kagiso Mahlangu',
      issueDate: '2024-03-05',
      dueDate: '2024-04-04',
      total: 1150,
      paid: 1150,
      balance: 0,
      status: 'paid',
      lastPaidOn: '2024-03-31',
      method: 'eft',
    },
  ],
}
const revenue: RevenueReport = {
  collected: 1250,
  payments: 2,
  collectedPrior: 0,
  collectedYear: 1250,
  invoiced: 1550,
  outstanding: 300,
  outstandingCount: 1,
  months: months.map((m) => ({ ...m, collected: 625, invoiced: 775 })),
  byMethod: [
    { key: 'eft', amount: 1150, count: 1 },
    { key: 'card', amount: 100, count: 1 },
  ],
  bySegment: [{ key: 'residential', amount: 1250, count: 2 }],
  topCustomers: [{ id: 'c1', name: 'Kagiso Mahlangu', amount: 1150 }],
  rowCount: 1,
  rows: [
    {
      id: 'pay1',
      referenceNumber: 'PAY-00001',
      paidOn: '2024-03-31',
      customerName: 'Kagiso Mahlangu',
      invoiceNumber: 'INV-2024-00001',
      invoiceId: 'i1',
      method: 'eft',
      amount: 1150,
      reference: 'INV-2024-00001',
      recordedByName: 'Mia Manager',
    },
  ],
}
const inventory: InventoryReport = {
  products: 2,
  units: 6,
  stockValue: 600,
  low: 0,
  out: 1,
  unvalued: 0,
  inbound: 10,
  outbound: 3,
  byType: [{ key: 'received', units: 10, count: 1 }],
  months: months.map((m) => ({ ...m, inbound: 5, outbound: 2 })),
  byCategory: [{ key: 'Meters', products: 2, units: 6, value: 600 }],
  fast: [{ id: 'pr1', sku: 'SKU-1', name: 'Meter Kit', outbound: 3, stockOnHand: 6 }],
  slow: [
    { id: 'pr2', sku: 'SKU-2', name: 'Spare Part', outbound: 0, stockOnHand: 4, lastOut: null },
  ],
  rowCount: 1,
  rows: [
    {
      id: 'pr1',
      sku: 'SKU-1',
      name: 'Meter Kit',
      category: 'Meters',
      isActive: true,
      trackStock: true,
      stockOnHand: 6,
      costPrice: 100,
      unitPrice: 250,
      stockValue: 600,
      stockStatus: 'in',
      lowStockThreshold: 2,
      inbound: 10,
      outbound: 3,
      lastOut: '2024-03-20',
    },
  ],
}
const support: SupportReport = {
  opened: 2,
  resolved: 1,
  openNow: 3,
  urgentOpen: 1,
  unassignedOpen: 1,
  avgFirstResponseHours: 2,
  avgResolutionHours: 24,
  byStatus: { resolved: 1, open: 1 },
  byCategory: [{ key: 'billing', count: 2 }],
  byPriority: [
    { key: 'urgent', count: 1 },
    { key: 'high', count: 1 },
  ],
  byAssignee: [
    { id: 'u3', name: 'Sam Staff', tickets: 1, resolved: 1, avgResolutionHours: 24 },
    { id: null, name: null, tickets: 1, resolved: 0, avgResolutionHours: null },
  ],
  months: months.map((m) => ({ ...m, opened: 1, resolved: 1 })),
  rowCount: 1,
  rows: [
    {
      id: 't1',
      reference: 'TKT-2024-00001',
      subject: 'Billing question',
      customerName: 'Kagiso Mahlangu',
      category: 'billing',
      priority: 'high',
      status: 'resolved',
      assigneeName: 'Sam Staff',
      createdAt: '2024-03-03T06:00:00Z',
      firstResponseAt: '2024-03-03T08:00:00Z',
      resolvedAt: '2024-03-04T06:00:00Z',
    },
  ],
}
const team: TeamReport = {
  employees: 3,
  byEmployment: { active: 2, training: 1 },
  assigned: 3,
  assignedDone: 2,
  completed: 2,
  withDue: 2,
  onTime: 1,
  pending: 1,
  overdue: 1,
  ticketsResolved: 1,
  unassignedOpen: 0,
  byDepartment: [
    {
      key: 'field_operations',
      people: 1,
      completed: 2,
      withDue: 2,
      onTime: 1,
      pending: 1,
      overdue: 1,
    },
  ],
  months: months.map((m) => ({ ...m, created: 2, completed: 1 })),
  rowCount: 1,
  rows: [
    {
      id: 'u3',
      fullName: 'Sam Staff',
      jobTitle: 'Field Technician',
      department: 'field_operations',
      employmentStatus: 'training',
      isActive: true,
      role: 'staff',
      assigned: 3,
      assignedDone: 2,
      completed: 2,
      withDue: 2,
      onTime: 1,
      pending: 1,
      overdue: 1,
      fieldOpen: 0,
      ticketsResolved: 1,
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  vi.mocked(messageService.getBusinessName).mockResolvedValue(ok('Umbane'))
  vi.mocked(pdf.buildReportPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
  r.getOverviewReport.mockResolvedValue(ok(overview))
  r.getCustomerReport.mockResolvedValue(ok(customers))
  r.getPropertyReport.mockResolvedValue(ok(properties))
  r.getElectricityReport.mockResolvedValue(ok(electricity))
  r.getSalesReport.mockResolvedValue(ok(sales))
  r.getRevenueReport.mockResolvedValue(ok(revenue))
  r.getInventoryReport.mockResolvedValue(ok(inventory))
  r.getSupportReport.mockResolvedValue(ok(support))
  r.getTeamReport.mockResolvedValue(ok(team))
  r.listProductCategories.mockResolvedValue(ok(['Meters']))
})

const open = (route: string, role: UserRole = 'manager') =>
  renderAt(<App />, signedInAs(role), route)

describe('access', () => {
  it.each(['staff', 'client'] as const)('keeps %s users out of reports', async (role) => {
    open('/reports/revenue', role)
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
    expect(r.getRevenueReport).not.toHaveBeenCalled()
  })
})

describe('reports hub', () => {
  it('shows the headline figures and a card for every report, keeping the period', async () => {
    open('/reports?range=last-month')
    expect(await screen.findByText('R 1,250')).toBeInTheDocument()
    expect(screen.getByText('+25% on the previous period')).toBeInTheDocument()
    expect(screen.getByText('80.6%')).toBeInTheDocument()
    const cards = screen.getAllByRole('link', { name: /Open report/ })
    expect(cards).toHaveLength(8)
    expect(cards[0]).toHaveAttribute('href', '/reports/revenue?range=last-month')
  })

  it('shows a failure with a way to try again', async () => {
    r.getOverviewReport.mockResolvedValue(
      err({ code: 'network', message: 'Cannot reach the server.' }),
    )
    open('/reports')
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('each report', () => {
  it.each([
    ['/reports/customers', 'Customer report', 'Kagiso Mahlangu'],
    ['/reports/properties', 'Property report', '1 Report Road'],
    ['/reports/electricity', 'Electricity consumption report', 'MTR-9041'],
    ['/reports/sales', 'Sales and invoice report', 'INV-2024-00001'],
    ['/reports/revenue', 'Revenue report', 'PAY-00001'],
    ['/reports/inventory', 'Inventory report', 'SKU-1'],
    ['/reports/support', 'Support ticket report', 'TKT-2024-00001'],
    ['/reports/team', 'Team performance report', 'Field Technician'],
  ])('%s shows its figures, charts and detail table', async (route, title, cell) => {
    open(route)
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(await screen.findAllByText(cell)).not.toHaveLength(0)
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument()
    // The page's own link back to the hub, beside the one in the navigation.
    expect(screen.getAllByRole('link', { name: 'Reports' })).toHaveLength(2)
  })

  it('shows the electricity readings with estimates marked in words', async () => {
    r.getElectricityReport.mockResolvedValue(
      ok({
        ...electricity,
        rows: [{ ...electricity.rows[0], previousValue: 5000, consumption: 200 }],
      }),
    )
    open('/reports/electricity')
    const table = await screen.findByRole('table', { name: 'Readings' })
    expect(within(table).getByText('Estimated')).toBeInTheDocument()
    expect(within(table).getByText('200')).toBeInTheDocument()
  })
})

describe('period and filters', () => {
  it('passes the period and filters from the address to the report', async () => {
    open(
      '/reports/customers?range=custom&from=2024-03-01&to=2024-03-31&segment=commercial&province=bogus',
    )
    await screen.findByText('Kagiso Mahlangu')
    expect(r.getCustomerReport).toHaveBeenLastCalledWith(
      { from: '2024-03-01', to: '2024-03-31' },
      { segment: 'commercial', province: '' },
    )
    expect(
      screen.getByText(/Showing 1 Mar 2024 – 31 Mar 2024 · Segment: Commercial/),
    ).toBeInTheDocument()
  })

  it('reloads when a filter changes', async () => {
    const user = userEvent.setup()
    open('/reports/support')
    await screen.findByText('TKT-2024-00001')
    await user.selectOptions(screen.getByLabelText('Priority'), 'urgent')
    await waitFor(() =>
      expect(r.getSupportReport).toHaveBeenLastCalledWith(expect.anything(), {
        category: '',
        priority: 'urgent',
      }),
    )
  })

  it('checks custom dates before running the report', async () => {
    const user = userEvent.setup()
    open('/reports/revenue')
    await screen.findByText('PAY-00001')
    await user.selectOptions(screen.getByLabelText('Period'), 'custom')
    const from = await screen.findByLabelText('From')
    const to = screen.getByLabelText('To')
    await user.clear(from)
    await user.type(from, '2024-03-31')
    await user.clear(to)
    await user.type(to, '2024-03-01')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date must be on or before the end date.',
    )
    await user.clear(to)
    await user.type(to, '2024-04-30')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(r.getRevenueReport).toHaveBeenLastCalledWith(
        { from: '2024-03-31', to: '2024-04-30' },
        { method: '' },
      ),
    )
  })
})

describe('exports', () => {
  it('exports the detail table as CSV with raw numbers and formula-safe text', async () => {
    const user = userEvent.setup()
    open('/reports/customers?range=custom&from=2024-03-01&to=2024-03-31')
    await screen.findByText('Kagiso Mahlangu')
    await user.click(screen.getByRole('button', { name: /Export CSV/ }))
    const [name, content, type] = vi.mocked(csv.downloadFile).mock.calls[0]
    expect(name).toBe('customer-report-2024-03-01-to-2024-03-31.csv')
    expect(type).toMatch(/^text\/csv/)
    const lines = String(content).split('\r\n')
    expect(lines[0]).toBe(
      'Customer,Segment,Province,Properties,Meters,Billed,Paid,Balance now,Last activity,Status,Registered',
    )
    expect(lines[1]).toBe(
      'Kagiso Mahlangu,Residential,Gauteng,1,1,1150,1150,0,2024-03-31,active,2024-03-10',
    )
    expect(lines[2]).toMatch(
      /^'=Formula Trading,Not recorded,,1,1,400,100,300,,inactive,2024-03-31$/,
    )
  })

  it('exports a PDF with the business, period, filters and every section', async () => {
    const user = userEvent.setup()
    open('/reports/revenue?range=custom&from=2024-03-01&to=2024-03-31&method=eft')
    await screen.findByText('PAY-00001')
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    await waitFor(() => expect(csv.downloadFile).toHaveBeenCalled())
    const doc = vi.mocked(pdf.buildReportPdf).mock.calls[0][0]
    expect(doc).toMatchObject({
      title: 'Revenue report',
      business: 'Umbane',
      period: '1 Mar 2024 – 31 Mar 2024',
      filters: ['Payment method: EFT bank transfer'],
    })
    expect(doc.generated).toMatch(/^Generated .* by /)
    expect(doc.sections.map((s) => s.heading)).toEqual([
      'Summary',
      'By month',
      'By payment method',
      'By customer segment',
      'Payments',
    ])
    expect(vi.mocked(csv.downloadFile).mock.calls[0][0]).toBe(
      'revenue-report-2024-03-01-to-2024-03-31.pdf',
    )
  })

  it('says so when the PDF cannot be made', async () => {
    const user = userEvent.setup()
    vi.mocked(pdf.buildReportPdf).mockRejectedValue(new Error('boom'))
    open('/reports/team')
    await screen.findByText('Field Technician')
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    expect(
      await screen.findByText('The PDF could not be created. Please try again.'),
    ).toBeInTheDocument()
  })
})
