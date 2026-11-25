import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as svc from '@/services/dashboard'
import { err, ok } from '@/utils/result'
import OverviewScreen from './OverviewScreen'

vi.mock('@/services/dashboard', () => ({
  getTotals: vi.fn(),
  getInvoiceSummary: vi.fn(),
  getTicketSummary: vi.fn(),
  getLowStock: vi.fn(),
  getRevenue: vi.fn(),
  getRecentPayments: vi.fn(),
  getRecentActivity: vi.fn(),
  getRecentInvoices: vi.fn(),
}))

const s = vi.mocked(svc)

const revenue = (total: number, previousTotal: number) =>
  ok({
    total,
    previousTotal,
    points: [
      { month: '2026-09-01', total: 300 },
      { month: '2026-10-01', total: 400 },
      { month: '2026-11-01', total: total - 700 },
    ],
  })

beforeEach(() => {
  vi.clearAllMocks()
  s.getTotals.mockResolvedValue(ok({ customers: 12, properties: 7, activeMeters: 5 }))
  s.getInvoiceSummary.mockResolvedValue(
    ok({ outstandingAmount: 550, outstandingCount: 2, overdueCount: 1 }),
  )
  s.getTicketSummary.mockResolvedValue(ok({ open: 9, highPriority: 4, openOverSevenDays: 2 }))
  s.getLowStock.mockResolvedValue(
    ok({
      count: 1,
      items: [
        {
          productId: 'p1',
          sku: 'MTR-PREPAID',
          name: 'Prepaid meter',
          stockOnHand: 3,
          threshold: 5,
        },
      ],
    }),
  )
  s.getRevenue.mockResolvedValue(revenue(900, 450))
  s.getRecentPayments.mockResolvedValue(
    ok([
      {
        id: 'a',
        amount: 400,
        paidAt: '2026-10-12T10:00:00Z',
        reference: 'EFT-1',
        invoiceNumber: 'INV-0001',
        customerName: 'Cleo Client',
      },
    ]),
  )
  s.getRecentActivity.mockResolvedValue(
    ok([
      {
        id: '1',
        action: 'INSERT',
        table: 'payments',
        actorName: 'Sam Staff',
        createdAt: '2026-11-10T10:00:00Z',
      },
    ]),
  )
  s.getRecentInvoices.mockResolvedValue(
    ok([
      {
        id: 'i1',
        invoiceNumber: 'INV-0001',
        status: 'partially_paid',
        total: 1150,
        balance: 250,
        dueDate: '2026-12-15',
        isOverdue: false,
      },
    ]),
  )
})

const tile = (label: string) =>
  screen.getByRole('heading', { name: label, level: 3 }).parentElement!.parentElement!

describe('business overview (staff and above)', () => {
  it('shows live numbers from the services in headline tiles', async () => {
    renderAt(<OverviewScreen />, signedInAs('manager'))
    await waitFor(() => expect(within(tile('Total customers')).getByText('12')).toBeInTheDocument())
    expect(within(tile('Total properties')).getByText('7')).toBeInTheDocument()
    expect(within(tile('Active meters')).getByText('5')).toBeInTheDocument()
    const invoices = tile('Outstanding invoices')
    expect(within(invoices).getByText('R 550')).toBeInTheDocument()
    expect(within(invoices).getByText('2 invoices · 1 overdue')).toBeInTheDocument()
    expect(
      within(tile('Open support tickets')).getByText('4 high priority · 2 open over 7 days'),
    ).toBeInTheDocument()
    expect(
      within(tile('Low stock')).getByText('Lowest: Prepaid meter (3 left)'),
    ).toBeInTheDocument()
  })

  it('shows loading placeholders before data arrives', () => {
    s.getTotals.mockReturnValue(new Promise(() => {}))
    renderAt(<OverviewScreen />, signedInAs('manager'))
    expect(
      within(tile('Total customers')).getByRole('status', { name: 'Loading Total customers' }),
    ).toBeInTheDocument()
  })

  it('shows revenue with its change against the previous period', async () => {
    renderAt(<OverviewScreen />, signedInAs('manager'))
    const panel = await screen.findByRole('region', { name: 'Revenue' })
    expect(await within(panel).findByText('R 900')).toBeInTheDocument()
    expect(within(panel).getByText('+100% vs the previous 6 months')).toBeInTheDocument()
  })

  it('reloads revenue and payments for the chosen date range, keeping the old data meanwhile', async () => {
    renderAt(<OverviewScreen />, signedInAs('manager'))
    const panel = await screen.findByRole('region', { name: 'Revenue' })
    await within(panel).findByText('R 900')

    let finish: (v: Awaited<ReturnType<typeof svc.getRevenue>>) => void = () => {}
    s.getRevenue.mockReturnValueOnce(new Promise((r) => (finish = r)))
    await userEvent.click(screen.getByRole('radio', { name: 'Last 3 months' }))

    expect(s.getRevenue).toHaveBeenLastCalledWith(3)
    expect(s.getRecentPayments).toHaveBeenLastCalledWith(3)
    expect(within(panel).getByText('R 900')).toBeInTheDocument() // previous render stays while loading
    finish(revenue(700, 0))
    expect(await within(panel).findByText('R 700')).toBeInTheDocument()
    expect(
      within(panel).getByText('No payments in the previous 3 months to compare with'),
    ).toBeInTheDocument()
  })

  it('shows an empty state instead of a flat line when nothing was paid', async () => {
    s.getRevenue.mockResolvedValue(
      ok({ total: 0, previousTotal: 0, points: [{ month: '2026-11-01', total: 0 }] }),
    )
    renderAt(<OverviewScreen />, signedInAs('manager'))
    expect(
      await screen.findByText('No payments have been received in this period.'),
    ).toBeInTheDocument()
  })

  it('switches the chart to a table', async () => {
    renderAt(<OverviewScreen />, signedInAs('manager'))
    const panel = await screen.findByRole('region', { name: 'Revenue' })
    await within(panel).findByText('R 900')
    await userEvent.click(within(panel).getByRole('button', { name: 'View as table' }))
    expect(within(panel).getByRole('table')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'View as chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('lists recent payments and low stock', async () => {
    renderAt(<OverviewScreen />, signedInAs('administrator'))
    const payments = await screen.findByRole('region', { name: 'Recent payments' })
    expect(await within(payments).findByText('Cleo Client')).toBeInTheDocument()
    expect(within(payments).getByText('R 400.00')).toBeInTheDocument()
    const stock = screen.getByRole('region', { name: 'Low stock' })
    expect(await within(stock).findByText('Prepaid meter')).toBeInTheDocument()
  })

  it('shows recent activity to managers and administrators only', async () => {
    const { unmount } = renderAt(<OverviewScreen />, signedInAs('administrator'))
    expect(await screen.findByText('Sam Staff created a payment')).toBeInTheDocument()
    unmount()

    vi.clearAllMocks()
    renderAt(<OverviewScreen />, signedInAs('staff'))
    await screen.findByRole('region', { name: 'Recent payments' })
    expect(screen.queryByRole('region', { name: 'Recent activity' })).toBeNull()
    expect(s.getRecentActivity).not.toHaveBeenCalled()
  })

  it('fails one card without blanking the rest, and retries it', async () => {
    s.getTicketSummary.mockResolvedValueOnce(
      err({
        code: 'network',
        message: 'Cannot reach the server. Check your connection and try again.',
      }),
    )
    renderAt(<OverviewScreen />, signedInAs('manager'))
    const failed = tile('Open support tickets')
    expect(await within(failed).findByRole('alert')).toHaveTextContent('Cannot reach the server')
    expect(within(tile('Total customers')).getByText('12')).toBeInTheDocument()

    await userEvent.click(within(failed).getByRole('button', { name: 'Try again' }))
    expect(await within(failed).findByText('9')).toBeInTheDocument()
    expect(s.getTicketSummary).toHaveBeenCalledTimes(2)
  })

  it('shows an error inside a failing panel', async () => {
    s.getRecentPayments.mockResolvedValue(
      err({ code: 'forbidden', message: 'You do not have access to this information.' }),
    )
    renderAt(<OverviewScreen />, signedInAs('manager'))
    const panel = await screen.findByRole('region', { name: 'Recent payments' })
    expect(await within(panel).findByRole('alert')).toHaveTextContent('You do not have access')
  })
})

describe('client overview', () => {
  it('shows only the client account summary', async () => {
    renderAt(<OverviewScreen />, signedInAs('client'))
    expect(screen.getByText('Your account at a glance')).toBeInTheDocument()
    await waitFor(() => expect(within(tile('Your properties')).getByText('7')).toBeInTheDocument())
    expect(within(tile('Outstanding balance')).getByText('R 550')).toBeInTheDocument()
    const invoices = await screen.findByRole('region', { name: 'Your invoices' })
    expect(await within(invoices).findByText('INV-0001')).toBeInTheDocument()
    expect(within(invoices).getByText('Part paid')).toBeInTheDocument()
  })

  it('never asks for business-wide data', async () => {
    renderAt(<OverviewScreen />, signedInAs('client'))
    await screen.findByRole('region', { name: 'Your invoices' })
    expect(screen.queryByText('Total customers')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Date range' })).toBeNull()
    expect(s.getRevenue).not.toHaveBeenCalled()
    expect(s.getLowStock).not.toHaveBeenCalled()
    expect(s.getRecentActivity).not.toHaveBeenCalled()
  })
})
