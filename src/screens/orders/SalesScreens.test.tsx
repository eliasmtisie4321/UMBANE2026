import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as activityService from '@/services/salesActivities'
import * as leadService from '@/services/leads'
import * as maintenanceService from '@/services/maintenance'
import * as orderService from '@/services/orders'
import * as propertyService from '@/services/properties'
import { activityFixture, leadFixture, orderFixture } from '@/test/fixtures'
import type { UserRole } from '@/types/auth'
import { err, ok } from '@/utils/result'

vi.mock('@/services/leads')
vi.mock('@/services/orders')
vi.mock('@/services/salesActivities')
vi.mock('@/services/maintenance')
vi.mock('@/services/properties')

const l = vi.mocked(leadService)
const o = vi.mocked(orderService)
const a = vi.mocked(activityService)
const cleo = { id: 'c1', name: 'Cleo Client', companyName: null, email: 'client1@umbane.test' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(maintenanceService.listStaffOptions).mockResolvedValue(
    ok([{ id: 'u9', name: 'Thabo Mokoena' }]),
  )
  vi.mocked(propertyService.searchCustomerOptions).mockResolvedValue(ok([cleo]))
  vi.mocked(propertyService.getCustomerOption).mockResolvedValue(ok(cleo))
  // Fresh objects each time, as a real fetch gives.
  l.listLeads.mockImplementation(() => Promise.resolve(ok({ rows: [leadFixture()], total: 1 })))
  l.getLeadTotals.mockResolvedValue(
    ok([
      { status: 'qualified', count: 54, value: 2_680_000 },
      { status: 'lost', count: 2, value: 100 },
    ]),
  )
  l.getLead.mockImplementation(() => Promise.resolve(ok(leadFixture())))
  l.getLeadMatches.mockResolvedValue(ok([]))
  o.getLeadOrders.mockResolvedValue(ok([]))
  o.listOrders.mockImplementation(() => Promise.resolve(ok({ rows: [orderFixture()], total: 1 })))
  o.getOrder.mockImplementation(() => Promise.resolve(ok(orderFixture())))
  o.getSalesSummary.mockResolvedValue(
    ok({
      pendingCount: 38,
      pendingValue: 640000,
      confirmedCount: 4,
      confirmedValue: 1000,
      fulfilledCount: 312,
      cancelledCount: 9,
    }),
  )
  o.getMonthlySales.mockResolvedValue(ok([{ month: '2026-11-01', total: 0 }]))
  o.getCustomerPropertyOptions.mockResolvedValue(
    ok([{ id: 'p1', name: 'Sunrise Apartments', detail: 'PROP-1001' }]),
  )
  o.searchProducts.mockResolvedValue(
    ok([{ id: 'f1', sku: 'MTR-PREPAID', name: 'Prepaid meter', unitPrice: 850 }]),
  )
  a.getActivities.mockResolvedValue(ok([]))
  a.getOpenActivities.mockResolvedValue(ok([]))
  a.getTimeline.mockResolvedValue(ok([]))
})

const open = (route: string, role: UserRole = 'staff') => renderAt(<App />, signedInAs(role), route)

describe('leads list', () => {
  it('shows each lead and the pipeline totals', async () => {
    open('/leads')
    const row = (await screen.findByRole('link', { name: 'Melrose Arch Holdings' })).closest('tr')!
    for (const text of [
      'LEAD-00109',
      'Gavin Petersen',
      'Referral',
      'R 540,000',
      'Overdue',
      'Qualified',
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Qualified: 54 leads, R2.7M value' }),
    ).toBeInTheDocument()
    // A stage with no leads is a real zero.
    expect(screen.getByRole('button', { name: /^Proposal: 0 leads/ })).toBeInTheDocument()
  })

  it('filters by stage from the pipeline, and again to clear it', async () => {
    open('/leads?owner=x,or(1=1)')
    const stage = await screen.findByRole('button', { name: /^Lost: 2 leads/ })
    expect(l.listLeads.mock.calls.at(-1)![1]).toEqual({
      status: 'open',
      source: '',
      assignedTo: '',
    })
    await userEvent.click(stage)
    await waitFor(() => expect(l.listLeads.mock.calls.at(-1)![1]).toMatchObject({ status: 'lost' }))
    expect(stage).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(stage)
    await waitFor(() => expect(l.listLeads.mock.calls.at(-1)![1]).toMatchObject({ status: 'open' }))
  })

  it('shows my open activities, then everyone’s', async () => {
    a.getOpenActivities.mockResolvedValue(ok([activityFixture()]))
    open('/leads')
    const panel = await screen.findByRole('region', { name: 'My open activities' })
    expect(await within(panel).findByText('Proposal review call')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /LEAD-00109/ })).toHaveAttribute(
      'href',
      '/leads/l1',
    )
    expect(a.getOpenActivities).toHaveBeenLastCalledWith('u1')
    await userEvent.click(within(panel).getByRole('button', { name: /everyone/ }))
    await waitFor(() => expect(a.getOpenActivities).toHaveBeenLastCalledWith(''))
  })

  it('is closed to clients', async () => {
    for (const route of ['/leads', '/leads/l1', '/leads/new']) {
      const view = open(route, 'client')
      expect(
        await screen.findByRole('heading', { name: /do not have access/i }),
      ).toBeInTheDocument()
      view.unmount()
    }
    expect(l.getLead).not.toHaveBeenCalled()
  })
})

describe('lead form', () => {
  it('reports problems and focuses the first', async () => {
    open('/leads/new')
    await userEvent.click(await screen.findByRole('button', { name: 'Save Lead' }))
    expect(screen.getByText('Enter the contact’s name.')).toBeInTheDocument()
    expect(screen.getByText('Choose where this lead came from.')).toBeInTheDocument()
    expect(screen.getByLabelText('Contact name')).toHaveFocus()
    expect(l.createLead).not.toHaveBeenCalled()
  })

  it('saves with an assignee', async () => {
    l.createLead.mockResolvedValue(ok({ id: 'l1' }))
    open('/leads/new')
    await userEvent.type(await screen.findByLabelText('Contact name'), 'Gavin')
    await userEvent.type(screen.getByLabelText('Phone number'), '011 684 2200')
    await userEvent.selectOptions(screen.getByLabelText('Lead source'), 'tender')
    await screen.findByRole('option', { name: 'Thabo Mokoena' })
    await userEvent.selectOptions(screen.getByLabelText('Assigned to'), 'u9')
    await userEvent.click(screen.getByRole('button', { name: 'Save Lead' }))
    expect(await screen.findByText('Lead added.')).toBeInTheDocument()
    expect(l.createLead.mock.calls[0][0]).toMatchObject({
      phone: '+27116842200',
      source: 'tender',
      assignedTo: 'u9',
      stage: 'new',
    })
  })

  it('does not offer the stage of a closed lead', async () => {
    l.getLead.mockResolvedValue(ok(leadFixture({ status: 'lost', isOpen: false })))
    l.updateLead.mockResolvedValue(ok({ id: 'l1' }))
    open('/leads/l1/edit')
    await screen.findByLabelText('Contact name')
    expect(screen.queryByLabelText('Stage')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(l.updateLead.mock.calls[0][1]).toMatchObject({ stage: null }))
  })
})

describe('lead details', () => {
  it('moves between stages and refreshes the history', async () => {
    l.setLeadStage.mockResolvedValue(ok({ id: 'l1' }))
    open('/leads/l1')
    await userEvent.selectOptions(await screen.findByLabelText('Stage'), 'proposal')
    expect(await screen.findByText('Stage updated.')).toBeInTheDocument()
    expect(l.setLeadStage).toHaveBeenCalledWith('l1', 'proposal')
    await waitFor(() => expect(a.getTimeline).toHaveBeenCalledTimes(2))
  })

  it('offers conversion only from an approved stage', async () => {
    l.getLead.mockResolvedValue(ok(leadFixture({ status: 'contacted' })))
    open('/leads/l1')
    expect(await screen.findByText(/from the Qualified stage onwards/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Convert/ })).toBeNull()
  })

  it('needs a reason to lose a lead', async () => {
    l.loseLead.mockResolvedValue(ok({ id: 'l1' }))
    open('/leads/l1')
    await userEvent.click(await screen.findByRole('button', { name: /Mark as Lost/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as lost' }))
    expect(within(dialog).getByText('Give the reason.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'No budget')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as lost' }))
    expect(await screen.findByText('Lead marked as lost.')).toBeInTheDocument()
    expect(l.loseLead).toHaveBeenCalledWith('l1', 'No budget')
  })

  it('creates a customer when nobody matches', async () => {
    l.convertLead.mockResolvedValue(ok({ customerId: 'c9' }))
    open('/leads/l1')
    await userEvent.click(await screen.findByRole('button', { name: /Convert to Customer/ }))
    expect(await screen.findByText(/A new customer will be created/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }))
    expect(await screen.findByText('Lead converted and customer created.')).toBeInTheDocument()
    expect(l.convertLead).toHaveBeenCalledWith('l1', null, false)
  })

  it('links to the existing customer when the email matches, with no way to duplicate it', async () => {
    l.getLeadMatches.mockResolvedValue(ok([{ ...cleo, phone: null, matchedOn: 'email' as const }]))
    l.convertLead.mockResolvedValue(ok({ customerId: 'c1' }))
    open('/leads/l1')
    await userEvent.click(await screen.findByRole('button', { name: /Convert to Customer/ }))
    expect(await screen.findByLabelText(/Link to Cleo Client/)).toBeChecked()
    expect(screen.queryByLabelText(/Create a new customer/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }))
    expect(await screen.findByText(/linked to the customer/)).toBeInTheDocument()
    expect(l.convertLead).toHaveBeenCalledWith('l1', 'c1', false)
  })

  it('makes the person choose when only the phone matches', async () => {
    l.getLeadMatches.mockResolvedValue(
      ok([{ ...cleo, phone: '+27116842200', matchedOn: 'phone' as const }]),
    )
    l.convertLead.mockResolvedValueOnce(
      err({ code: 'network', message: 'Cannot reach the server.' }),
    )
    open('/leads/l1')
    await userEvent.click(await screen.findByRole('button', { name: /Convert to Customer/ }))
    await screen.findByLabelText(/Link to Cleo Client/)
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }))
    expect(screen.getByText(/Choose an existing customer/)).toBeInTheDocument()
    expect(l.convertLead).not.toHaveBeenCalled()
    await userEvent.click(screen.getByLabelText(/Create a new customer/))
    await userEvent.click(screen.getByRole('button', { name: 'Convert lead' }))
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument()
    expect(l.convertLead).toHaveBeenCalledWith('l1', null, true)
  })

  it('links a converted lead to its customer, orders and a new order', async () => {
    l.getLead.mockResolvedValue(
      ok(
        leadFixture({
          status: 'converted',
          isOpen: false,
          customerId: 'c1',
          customerName: 'Cleo Client',
        }),
      ),
    )
    o.getLeadOrders.mockResolvedValue(ok([orderFixture()]))
    open('/leads/l1')
    expect(await screen.findByRole('link', { name: 'Cleo Client' })).toHaveAttribute(
      'href',
      '/customers/c1',
    )
    expect(screen.getByRole('link', { name: /Create Order/ })).toHaveAttribute(
      'href',
      '/sales-orders/new?lead=l1',
    )
    expect(await screen.findByRole('link', { name: 'ORD-00842' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Convert|Lost/ })).toBeNull()
  })

  it('reopens a lost lead', async () => {
    l.getLead.mockResolvedValue(
      ok(
        leadFixture({
          status: 'lost',
          isOpen: false,
          lostReason: 'No budget',
          closedOn: '2026-11-20',
        }),
      ),
    )
    l.setLeadStage.mockResolvedValue(ok({ id: 'l1' }))
    open('/leads/l1')
    expect(await screen.findByText('Lost on 20 Nov 2026: No budget')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Reopen/ }))
    await waitFor(() => expect(l.setLeadStage).toHaveBeenCalledWith('l1', 'contacted'))
  })

  it('adds and completes activities', async () => {
    a.getActivities.mockResolvedValue(ok([activityFixture()]))
    a.createActivity.mockResolvedValue(ok({ id: 'a2' }))
    a.updateActivity.mockResolvedValue(ok({ id: 'a1' }))
    open('/leads/l1')
    await userEvent.click(await screen.findByRole('button', { name: /Add activity/ }))
    await userEvent.type(screen.getByLabelText('Subject'), 'Site walkthrough')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'site_visit')
    await userEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() =>
      expect(a.createActivity.mock.calls[0]).toMatchObject([
        { leadId: 'l1' },
        { subject: 'Site walkthrough', kind: 'site_visit', done: false },
      ]),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Proposal review call' }))
    await userEvent.click(screen.getByLabelText('This is done'))
    await userEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() =>
      expect(a.updateActivity.mock.calls[0]).toMatchObject([
        'a1',
        { done: true, assignedTo: 'u9' },
      ]),
    )
  })
})

describe('orders list', () => {
  it('shows totals and orders', async () => {
    open('/sales-orders')
    const row = (await screen.findByRole('link', { name: 'ORD-00842' })).closest('tr')!
    for (const text of [
      'Cleo Client',
      'CT meter + 1 more',
      'R 312,455.00',
      'Pending',
      'Thabo Mokoena',
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(await screen.findByText('R 640,000 including VAT')).toBeInTheDocument()
    expect(screen.getByText('Sales appear once an order has been fulfilled.')).toBeInTheDocument()
  })

  it('filters by status and period through the URL', async () => {
    open('/sales-orders?status=bogus&customer=x')
    await screen.findByRole('link', { name: 'ORD-00842' })
    expect(o.listOrders.mock.calls.at(-1)![1]).toEqual({
      status: '',
      customerId: '',
      from: '',
      to: '',
    })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'fulfilled')
    await userEvent.selectOptions(screen.getByLabelText('Order date'), 'this-year')
    await waitFor(() =>
      expect(o.listOrders.mock.calls.at(-1)![1]).toMatchObject({
        status: 'fulfilled',
        from: expect.stringMatching(/^\d{4}-01-01$/),
      }),
    )
  })

  it('gives clients a read-only view of their orders', async () => {
    const list = open('/sales-orders', 'client')
    await screen.findByRole('link', { name: 'ORD-00842' })
    expect(screen.queryByRole('link', { name: /Create Order/ })).toBeNull()
    expect(o.getMonthlySales).not.toHaveBeenCalled()
    list.unmount()

    const detail = open('/sales-orders/o1', 'client')
    expect(await screen.findByText('R 312,455.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm|Cancel/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Activities' })).toBeNull()
    expect(a.getTimeline).not.toHaveBeenCalled()
    detail.unmount()

    open('/sales-orders/new', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})

describe('order form', () => {
  const fillLine = async (n: number, description: string, quantity: string, price: string) => {
    const line = screen.getByRole('listitem', { name: `Line ${n}` })
    const type = async (label: string, text: string) => {
      const input = within(line).getByLabelText(label)
      await userEvent.clear(input)
      await userEvent.type(input, text)
    }
    await type('Description', description)
    await type('Quantity', quantity)
    await type('Unit price (R)', price)
  }

  it('calculates as you type and saves', async () => {
    o.saveOrder.mockResolvedValue(ok({ id: 'o1' }))
    open('/sales-orders/new?customer=c1')
    await screen.findByText('Cleo Client')
    await fillLine(1, 'CT meter', '2', '120000')
    await userEvent.click(screen.getByRole('button', { name: /Add line/ }))
    await fillLine(2, 'Installation', '1', '46000')
    const discount = screen.getByLabelText('Discount (%)')
    await userEvent.clear(discount)
    await userEvent.type(discount, '5')
    const summary = screen.getByRole('region', { name: 'Order summary' })
    for (const text of ['R 286,000.00', '-R 14,300.00', 'R 40,755.00', 'R 312,455.00'])
      expect(within(summary).getByText(text)).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Sunrise Apartments' })
    await userEvent.selectOptions(screen.getByLabelText('Property (optional)'), 'p1')
    await userEvent.click(screen.getByRole('button', { name: 'Save Order' }))
    expect(await screen.findByText('Order saved as pending.')).toBeInTheDocument()
    expect(o.saveOrder.mock.calls[0]).toMatchObject([
      null,
      {
        customerId: 'c1',
        propertyId: 'p1',
        leadId: null,
        discountPercent: 5,
        items: [
          { description: 'CT meter', quantity: 2, unitPrice: 120000 },
          { description: 'Installation', quantity: 1, unitPrice: 46000 },
        ],
      },
    ])
  })

  it('reports problems on the right line and sends nothing', async () => {
    open('/sales-orders/new?customer=c1')
    await screen.findByText('Cleo Client')
    await fillLine(1, 'CT meter', '1.5', '1,000')
    await userEvent.click(screen.getByRole('button', { name: 'Save Order' }))
    expect(screen.getByText('Whole number, 1 to 100,000.')).toBeInTheDocument()
    expect(screen.getByText('Amount in rand, e.g. 1500.50.')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity')).toHaveFocus()
    expect(o.saveOrder).not.toHaveBeenCalled()
  })

  it('needs a line', async () => {
    open('/sales-orders/new?customer=c1')
    await screen.findByText('Cleo Client')
    await userEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Order' }))
    expect(screen.getByText('Add at least one product or service.')).toBeInTheDocument()
  })

  it('fills the blank line from the catalogue, then adds more', async () => {
    open('/sales-orders/new?customer=c1')
    await screen.findByText('Cleo Client')
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByRole('button', { name: /Add from catalogue/ }))
      await userEvent.click(await screen.findByRole('button', { name: /Prepaid meter/ }))
    }
    const lines = screen.getAllByRole('listitem', { name: /^Line/ })
    expect(lines).toHaveLength(2)
    expect(within(lines[0]).getByLabelText('Unit price (R)')).toHaveValue('850.00')
    expect(within(lines[0]).getByText(/catalogue product/)).toBeInTheDocument()
  })

  it('takes the customer and assignee from a converted lead', async () => {
    l.getLead.mockResolvedValue(
      ok(leadFixture({ status: 'converted', isOpen: false, customerId: 'c1' })),
    )
    o.saveOrder.mockResolvedValue(ok({ id: 'o1' }))
    open('/sales-orders/new?lead=l1')
    expect(await screen.findByText(/from lead LEAD-00109/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change customer' })).toBeNull()
    await fillLine(1, 'CT meter', '1', '10')
    await userEvent.click(screen.getByRole('button', { name: 'Save Order' }))
    await waitFor(() =>
      expect(o.saveOrder.mock.calls[0][1]).toMatchObject({
        leadId: 'l1',
        customerId: 'c1',
        assignedTo: 'u9',
      }),
    )
  })

  it('refuses a lead that has not been converted', async () => {
    open('/sales-orders/new?lead=l1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Convert this lead')
  })

  it('edits a pending order but not a confirmed one', async () => {
    o.saveOrder.mockResolvedValue(
      err({ code: 'validation', message: 'Only a pending order can be edited. Refresh the page.' }),
    )
    const view = open('/sales-orders/o1/edit')
    await screen.findByText('Cleo Client')
    expect(screen.getAllByRole('listitem', { name: /^Line/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(/Only a pending order can be edited. Refresh/),
    ).toBeInTheDocument()
    expect(o.saveOrder.mock.calls[0][0]).toBe('o1')
    view.unmount()

    o.getOrder.mockResolvedValue(ok(orderFixture({ status: 'confirmed' })))
    open('/sales-orders/o1/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('This one is confirmed.')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})

describe('order details', () => {
  it('shows lines and totals', async () => {
    open('/sales-orders/o1')
    const lines = await screen.findByRole('table', { name: 'Products and services' })
    expect(within(lines).getByText('R 240,000.00')).toBeInTheDocument()
    expect(within(lines).getByText('MTR-PREPAID')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View lead' })).toHaveAttribute('href', '/leads/l1')
  })

  it('confirms after asking, and shows a refusal in the dialog', async () => {
    o.setOrderStatus.mockResolvedValueOnce(
      err({ code: 'validation', message: 'Add at least one product or service first.' }),
    )
    open('/sales-orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Confirm Order/ }))
    const dialog = screen.getByRole('dialog')
    expect(o.setOrderStatus).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm order' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('at least one')

    o.setOrderStatus.mockResolvedValueOnce(ok({ id: 'o1' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm order' }))
    expect(await screen.findByText('Order confirmed.')).toBeInTheDocument()
    expect(o.setOrderStatus).toHaveBeenLastCalledWith('o1', 'confirmed', null)
    await waitFor(() => expect(a.getTimeline).toHaveBeenCalledTimes(2))
  })

  it('offers only the next step for each status', async () => {
    o.getOrder.mockResolvedValue(ok(orderFixture({ status: 'confirmed' })))
    const confirmed = open('/sales-orders/o1')
    expect(await screen.findByRole('button', { name: /Mark as Fulfilled/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull()
    confirmed.unmount()

    o.getOrder.mockResolvedValue(ok(orderFixture({ status: 'fulfilled' })))
    open('/sales-orders/o1')
    await screen.findByRole('table', { name: 'Products and services' })
    expect(screen.queryByRole('button', { name: /Confirm|Fulfilled|Cancel/ })).toBeNull()
  })

  it('cancels with a reason', async () => {
    o.setOrderStatus.mockResolvedValue(ok({ id: 'o1' }))
    open('/sales-orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Cancel Order/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Changed mind')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(await screen.findByText('Order cancelled.')).toBeInTheDocument()
    expect(o.setOrderStatus).toHaveBeenCalledWith('o1', 'cancelled', 'Changed mind')
  })

  it('shows history in words', async () => {
    a.getTimeline.mockResolvedValue(
      ok([
        {
          id: 'e2',
          fromStatus: 'pending',
          toStatus: 'cancelled',
          note: 'Changed mind',
          actorName: 'Sam Staff',
          createdAt: '2026-11-22T08:05:00Z',
        },
        {
          id: 'e1',
          fromStatus: null,
          toStatus: 'pending',
          note: null,
          actorName: null,
          createdAt: '2026-11-20T08:05:00Z',
        },
      ]),
    )
    open('/sales-orders/o1')
    expect(await screen.findByText('Pending to Cancelled: Changed mind')).toBeInTheDocument()
    expect(screen.getByText('22 Nov 2026, 10:05 · Sam Staff')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
  })
})
