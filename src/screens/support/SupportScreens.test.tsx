import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as maintenanceService from '@/services/maintenance'
import * as notificationService from '@/services/notifications'
import * as propertyService from '@/services/properties'
import * as s from '@/services/support'
import type { UserRole } from '@/types/auth'
import type { Ticket, TicketListItem, TicketMessage } from '@/types/support'
import { err, ok } from '@/utils/result'

vi.mock('@/services/support')
vi.mock('@/services/notifications')
vi.mock('@/services/maintenance')
vi.mock('@/services/properties')

const support = vi.mocked(s)
const notes = vi.mocked(notificationService)

const row = (over: Partial<TicketListItem> = {}): TicketListItem => ({
  id: 't1',
  reference: 'TKT-2026-00418',
  subject: 'CT breaker trip on DB-04',
  category: 'meter_fault',
  status: 'in_progress',
  priority: 'urgent',
  customerId: 'c1',
  customerName: 'Sandton City Holdings',
  propertyName: 'Sandton City Office Tower',
  assignedTo: 's2',
  assigneeName: 'Pieter Botha',
  createdAt: '2026-11-23T06:22:00Z',
  lastActivityAt: '2026-11-23T08:15:00Z',
  messageCount: 2,
  attachmentCount: 1,
  ...over,
})
const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  ...row(),
  description: 'The meter shows E-04.',
  propertyId: 'p1',
  propertyAddress: 'Alice Lane',
  meterId: 'm1',
  meterSerial: 'MTR-88412-ZA',
  customerPhone: '+27112176000',
  customerEmail: 'ops@sandton.test',
  resolution: null,
  assignedAt: '2026-11-23T06:35:00Z',
  statusChangedAt: '2026-11-23T06:35:00Z',
  firstResponseAt: '2026-11-23T06:35:00Z',
  resolvedAt: null,
  closedAt: null,
  ...over,
})
const message = (over: Partial<TicketMessage> = {}): TicketMessage => ({
  id: 'm1',
  body: 'DB-04 tripped again.',
  isInternal: false,
  fromStaff: false,
  authorName: 'Sipho Ndlovu',
  createdAt: '2026-11-23T06:22:00Z',
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  notes.getUnreadCount.mockResolvedValue(ok(0))
  support.listTickets.mockResolvedValue(ok({ rows: [row()], total: 1 }))
  support.getTicketCounts.mockResolvedValue(
    ok({
      total: 318,
      open: 24,
      assigned: 6,
      inProgress: 10,
      resolved: 270,
      closed: 8,
      urgentOpen: 5,
    }),
  )
  support.getTicket.mockImplementation(() => Promise.resolve(ok(ticket())))
  support.listMessages.mockResolvedValue(
    ok([
      message(),
      message({
        id: 'm2',
        body: 'Check the CT lugs.',
        isInternal: true,
        fromStaff: true,
        authorName: 'Elias Nkosi',
      }),
    ]),
  )
  support.listEvents.mockResolvedValue(
    ok([
      {
        id: 'e1',
        kind: 'status',
        fromValue: 'assigned',
        toValue: 'in_progress',
        actorName: 'Pieter Botha',
        createdAt: '2026-11-23T08:15:00Z',
      },
    ]),
  )
  support.listAttachments.mockResolvedValue(ok([]))
  support.attachmentUrls.mockResolvedValue(ok({}))
  support.getTicketAssets.mockResolvedValue(
    ok([
      {
        id: 'p1',
        name: 'Sunrise Apartments',
        meters: [
          { id: 'm1', serialNumber: 'MTR-0001' },
          { id: 'm2', serialNumber: 'MTR-0002' },
        ],
      },
    ]),
  )
  support.getWorkload.mockResolvedValue(
    ok([
      { id: 's2', name: 'Pieter Botha', activeTickets: 2, urgentTickets: 1 },
      { id: 's3', name: 'Lerato Khumalo', activeTickets: 5, urgentTickets: 0 },
    ]),
  )
  vi.mocked(maintenanceService.listStaffOptions).mockResolvedValue(
    ok([
      { id: 's2', name: 'Pieter Botha' },
      { id: 's3', name: 'Lerato Khumalo' },
    ]),
  )
  vi.mocked(propertyService.searchCustomerOptions).mockResolvedValue(ok([]))
  vi.mocked(propertyService.getCustomerOption).mockResolvedValue(
    ok({ id: 'c1', name: 'Sandton City Holdings', companyName: null, email: null }),
  )
})

const open = (route: string, role: UserRole = 'staff') => renderAt(<App />, signedInAs(role), route)
// The picker's accept list only guides the browser's dialog; anyone can still choose "All files".
const anyFile = () => userEvent.setup({ applyAccept: false })

describe('ticket queue', () => {
  it('shows totals and tickets with customer, priority and assignee for staff', async () => {
    open('/support-tickets')
    const table = await screen.findByRole('table', { name: 'Support tickets' })
    const tr = within(table).getByRole('link', { name: 'TKT-2026-00418' }).closest('tr')!
    for (const text of [
      'Sandton City Holdings',
      'Meter fault',
      'Urgent',
      'Pieter Botha',
      'In Progress',
    ])
      expect(within(tr).getByText(text)).toBeInTheDocument()
    expect(await screen.findByText('24')).toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument()
  })

  it('filters to my tickets, active ones and a category', async () => {
    open('/support-tickets?status=bogus')
    await screen.findByRole('table', { name: 'Support tickets' })
    expect(support.listTickets.mock.calls.at(-1)![1]).toEqual({
      status: '',
      category: '',
      priority: '',
      assignee: '',
    })
    await userEvent.selectOptions(screen.getByLabelText('Assigned to'), 'me')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'billing')
    await waitFor(() =>
      expect(support.listTickets.mock.calls.at(-1)![1]).toEqual({
        status: 'active',
        category: 'billing',
        priority: '',
        assignee: 'u1',
      }),
    )
  })

  it('shows a client only their own tickets, without team details', async () => {
    support.listTickets.mockResolvedValue(
      ok({ rows: [row({ assigneeName: null, priority: 'normal' })], total: 1 }),
    )
    open('/support-tickets?assignee=unassigned&priority=urgent', 'client')
    const table = await screen.findByRole('table', { name: 'Support tickets' })
    expect(within(table).queryByText('Sandton City Holdings')).toBeNull()
    expect(within(table).queryByRole('columnheader', { name: 'Priority' })).toBeNull()
    expect(screen.queryByLabelText('Assigned to')).toBeNull()
    expect(support.listTickets.mock.calls.at(-1)![1]).toMatchObject({ assignee: '', priority: '' })
    expect(screen.getByRole('link', { name: /New Ticket/ })).toHaveAttribute(
      'href',
      '/support-tickets/new',
    )
  })
})

describe('opening a ticket', () => {
  it('lets a client report a problem with a photo, choosing only their own meters', async () => {
    support.createTicket.mockResolvedValue(ok({ id: 't9', reference: 'TKT-2026-00419' }))
    support.uploadAttachment.mockResolvedValue(ok({ id: 'a1' }))
    open('/support-tickets/new', 'client')
    expect(await screen.findByRole('heading', { name: 'Report a Problem' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Customer')).toBeNull()
    expect(screen.queryByLabelText('Priority')).toBeNull()
    await waitFor(() => expect(screen.getByLabelText('Meter (optional)')).toBeEnabled())
    expect(support.getTicketAssets).toHaveBeenCalledWith(null)
    await userEvent.selectOptions(screen.getByLabelText('Meter (optional)'), 'm2')
    expect(screen.getByLabelText('Property (optional)')).toHaveValue('p1')
    await userEvent.type(screen.getByLabelText('Title'), 'Token rejected')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'prepaid_token')
    await userEvent.type(screen.getByLabelText('Description'), 'Error 30 on every token.')
    const photo = new File(['x'], 'meter.jpg', { type: 'image/jpeg' })
    await anyFile().upload(screen.getByLabelText('Add files'), [photo, new File(['x'], 'tool.exe')])
    expect(screen.getByText('tool.exe: this type of file cannot be attached.')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Files to attach' })).getByText('meter.jpg'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Submit Ticket/ }))

    expect(await screen.findByText('Ticket TKT-2026-00419 opened.')).toBeInTheDocument()
    expect(support.createTicket).toHaveBeenCalledWith({
      customerId: null,
      subject: 'Token rejected',
      description: 'Error 30 on every token.',
      category: 'prepaid_token',
      propertyId: 'p1',
      meterId: 'm2',
    })
    expect(support.uploadAttachment).toHaveBeenCalledTimes(1)
    expect(support.uploadAttachment).toHaveBeenCalledWith({ id: 't9', businessId: 'b1' }, photo)
  })

  it('says which files did not attach, while keeping the ticket', async () => {
    support.createTicket.mockResolvedValue(ok({ id: 't9', reference: 'TKT-2026-00419' }))
    support.uploadAttachment.mockResolvedValue(err({ code: 'network', message: 'x' }))
    open('/support-tickets/new', 'client')
    await userEvent.type(await screen.findByLabelText('Title'), 'No power')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'meter_fault')
    await userEvent.type(screen.getByLabelText('Description'), 'Since 8am.')
    await userEvent.upload(screen.getByLabelText('Add files'), new File(['x'], 'db.pdf'))
    await userEvent.click(screen.getByRole('button', { name: /Submit Ticket/ }))
    expect(await screen.findByText(/could not be attached \(db\.pdf\)/)).toBeInTheDocument()
  })

  it('checks the form before sending', async () => {
    open('/support-tickets/new', 'client')
    await userEvent.click(await screen.findByRole('button', { name: /Submit Ticket/ }))
    expect(screen.getByText('Give the ticket a short title.')).toBeInTheDocument()
    expect(screen.getByText('Describe the problem.')).toBeInTheDocument()
    expect(support.createTicket).not.toHaveBeenCalled()
  })

  it('lets staff open one for a customer with priority and assignee', async () => {
    support.createTicket.mockResolvedValue(ok({ id: 't9', reference: 'TKT-2026-00420' }))
    open('/support-tickets/new?customer=c1000000-0000-0000-0000-000000000001')
    expect(
      await screen.findByRole('heading', { name: 'Create Support Ticket' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(support.getTicketAssets).toHaveBeenCalledWith('c1'))
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high')
    await userEvent.selectOptions(await screen.findByLabelText('Assign to (optional)'), 's3')
    await userEvent.type(screen.getByLabelText('Title'), 'Invoice query')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'billing')
    await userEvent.type(screen.getByLabelText('Description'), 'Asked by phone.')
    await userEvent.click(screen.getByRole('button', { name: /Create Ticket/ }))
    expect(await screen.findByText('Ticket TKT-2026-00420 opened.')).toBeInTheDocument()
    expect(support.createTicket.mock.calls[0][0]).toMatchObject({
      customerId: 'c1',
      priority: 'high',
      assignedTo: 's3',
    })
  })

  it('shows a database refusal on its field', async () => {
    support.createTicket.mockResolvedValue(
      err({
        code: 'validation',
        field: 'meterId',
        message: 'The meter is not at this customer’s property.',
      }),
    )
    open('/support-tickets/new', 'client')
    await userEvent.type(await screen.findByLabelText('Title'), 'No power')
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'meter_fault')
    await userEvent.type(screen.getByLabelText('Description'), 'Since 8am.')
    await userEvent.click(screen.getByRole('button', { name: /Submit Ticket/ }))
    expect(await screen.findByText(/not at this customer/)).toBeInTheDocument()
  })

  it('does not let a client edit a ticket', async () => {
    open('/support-tickets/t1/edit', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})

describe('working a ticket', () => {
  it('shows the issue, conversation with internal notes, and history to staff', async () => {
    open('/support-tickets/t1')
    expect(
      await screen.findByRole('heading', { name: 'CT breaker trip on DB-04' }),
    ).toBeInTheDocument()
    const messages = await screen.findByRole('list', { name: 'Messages' })
    expect(within(messages).getByText('Sipho Ndlovu (customer)')).toBeInTheDocument()
    expect(within(messages).getByText('Internal note')).toBeInTheDocument()
    expect(await screen.findByText('Status changed to In Progress')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MTR-88412-ZA' })).toHaveAttribute(
      'href',
      '/electricity-meters/m1',
    )
  })

  it('adds an internal note', async () => {
    support.postMessage.mockResolvedValue(ok({ id: 'm3' }))
    open('/support-tickets/t1')
    await userEvent.click(await screen.findByLabelText('Internal note'))
    expect(screen.getByText('Only the team can see internal notes.')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Internal note' }), 'Torque to spec.')
    await userEvent.click(screen.getByRole('button', { name: 'Add Note' }))
    expect(await screen.findByText('Internal note added.')).toBeInTheDocument()
    expect(support.postMessage).toHaveBeenCalledWith('t1', 'Torque to spec.', true)
  })

  it('assigns, seeing each person’s workload', async () => {
    support.assignTicket.mockResolvedValue(ok({ id: 't1' }))
    open('/support-tickets/t1')
    await userEvent.click(await screen.findByRole('button', { name: /Assign Ticket/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('5 active tickets')).toBeInTheDocument()
    expect(within(dialog).getByText('2 active tickets, 1 urgent')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByLabelText(/Lerato Khumalo/))
    await userEvent.selectOptions(within(dialog).getByLabelText('Priority'), 'high')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Ticket assigned.')).toBeInTheDocument()
    expect(support.assignTicket).toHaveBeenCalledWith('t1', 's3', 'high')
  })

  it('needs a resolution to resolve', async () => {
    support.setTicketStatus.mockResolvedValue(ok({ id: 't1' }))
    open('/support-tickets/t1')
    await userEvent.click(await screen.findByRole('button', { name: /Resolve Ticket/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Resolved')).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText(/Say what was done/)).toBeInTheDocument()
    expect(support.setTicketStatus).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByLabelText('Resolution'), 'Re-terminated the lug.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Ticket is now Resolved.')).toBeInTheDocument()
    expect(support.setTicketStatus).toHaveBeenCalledWith('t1', 'resolved', 'Re-terminated the lug.')
  })

  it('offers no changes on a closed ticket', async () => {
    support.getTicket.mockResolvedValue(
      ok(ticket({ status: 'closed', resolution: 'Duplicate', closedAt: '2026-11-24T08:00:00Z' })),
    )
    open('/support-tickets/t1')
    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign Ticket/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Send Reply/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Attach Files/ })).toBeNull()
  })
})

describe('the customer’s view', () => {
  it('follows progress and replies, without team controls or internal notes', async () => {
    support.getTicket.mockResolvedValue(
      ok(ticket({ status: 'resolved', resolution: 'Re-terminated the lug.', assigneeName: null })),
    )
    support.listMessages.mockResolvedValue(
      ok([
        message(),
        message({ id: 'm3', body: 'On site now.', fromStaff: true, authorName: 'Pieter Botha' }),
      ]),
    )
    support.postMessage.mockResolvedValue(ok({ id: 'm4' }))
    open('/support-tickets/t1', 'client')
    expect(
      await screen.findByText(/reply below and the ticket will be reopened/),
    ).toBeInTheDocument()
    expect(screen.getByText('Re-terminated the lug.')).toBeInTheDocument()
    expect(await screen.findByText('Pieter Botha (support team)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign Ticket/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull()
    expect(screen.queryByText('Send as')).toBeNull()
    await userEvent.type(screen.getByLabelText('Your message'), 'It tripped again.')
    await userEvent.click(screen.getByRole('button', { name: 'Send Reply' }))
    expect(await screen.findByText('Reply sent.')).toBeInTheDocument()
    expect(support.postMessage).toHaveBeenCalledWith('t1', 'It tripped again.', false)
  })

  it('attaches more files to an open ticket, refusing ones that are not allowed', async () => {
    support.uploadAttachment.mockResolvedValue(ok({ id: 'a2' }))
    open('/support-tickets/t1', 'client')
    const input = await screen.findByLabelText('Attach files')
    await anyFile().upload(input, [new File(['x'], 'reading.png'), new File(['x'], 'x.zip')])
    expect(await screen.findByText('1 file attached.')).toBeInTheDocument()
    expect(screen.getByText('x.zip: this type of file cannot be attached.')).toBeInTheDocument()
    expect(support.uploadAttachment).toHaveBeenCalledTimes(1)
  })
})

describe('notifications', () => {
  it('shows the unread count on the bell, which opens the list', async () => {
    notes.getUnreadCount.mockResolvedValue(ok(3))
    notes.listNotifications.mockResolvedValue(
      ok([
        {
          id: 'n1',
          title: 'Ticket assigned to you',
          body: 'TKT-2026-00418: CT breaker trip',
          link: '/support-tickets/t1',
          isRead: false,
          createdAt: '2026-11-23T06:35:00Z',
        },
      ]),
    )
    notes.markRead.mockResolvedValue(ok(null))
    open('/support-tickets')
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 3 unread' }))
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(notes.listNotifications).toHaveBeenCalledWith(true)
    await userEvent.click(await screen.findByRole('button', { name: /Ticket assigned to you/ }))
    expect(
      await screen.findByRole('heading', { name: 'CT breaker trip on DB-04' }),
    ).toBeInTheDocument()
    expect(notes.markRead).toHaveBeenCalledWith(['n1'])
  })

  it('marks everything read', async () => {
    notes.listNotifications.mockResolvedValue(
      ok([
        {
          id: 'n1',
          title: 'A',
          body: null,
          link: null,
          isRead: false,
          createdAt: '2026-11-23T06:35:00Z',
        },
      ]),
    )
    notes.markRead.mockResolvedValue(ok(null))
    open('/notifications', 'client')
    await userEvent.click(await screen.findByRole('button', { name: /Mark All as Read/ }))
    expect(await screen.findByText('All notifications marked as read.')).toBeInTheDocument()
    expect(notes.markRead).toHaveBeenCalledWith('all')
  })
})
