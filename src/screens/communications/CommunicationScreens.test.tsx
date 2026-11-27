import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import { customerFixture } from '@/test/fixtures'
import * as customerService from '@/services/customers'
import * as messageService from '@/services/messages'
import * as shareService from '@/services/share'
import { shareReady } from '@/test/share'
import * as notificationService from '@/services/notifications'
import * as supportService from '@/services/support'
import * as taskService from '@/services/tasks'
import type { UserRole } from '@/types/auth'
import type { Message, MessageListItem, MessageTemplate } from '@/types/messages'
import { err, ok } from '@/utils/result'

vi.mock('@/services/messages')
vi.mock('@/services/share', async (real) => ({
  ...(await real<typeof import('@/services/share')>()),
  ...(await import('@/test/share')).shareMocks(),
}))
vi.mock('@/services/customers')
vi.mock('@/services/notifications')
vi.mock('@/services/support')
vi.mock('@/services/tasks')

const m = vi.mocked(messageService)
const sh = vi.mocked(shareService)

const item = (over: Partial<MessageListItem> = {}): MessageListItem => ({
  id: 'm1',
  channel: 'email',
  direction: 'outbound',
  status: 'delivered',
  purpose: 'transactional',
  subject: 'Invoice INV-2026-00042',
  recipient: 'naledi@example.co.za',
  customerId: 'c1',
  customerName: 'Naledi Dlamini',
  invoiceId: 'i1',
  invoiceNumber: 'INV-2026-00042',
  ticketId: null,
  ticketReference: null,
  createdByName: 'Sam Staff',
  createdAt: '2026-11-26T08:00:00Z',
  sentAt: '2026-11-26T08:00:05Z',
  deliveredAt: '2026-11-26T08:00:09Z',
  attempts: 1,
  nextAttemptAt: null,
  willRetry: false,
  error: null,
  ...over,
})
const message = (over: Partial<Message> = {}): Message => ({
  ...item(),
  body: 'Good day Naledi,\n\nPlease find attached invoice INV-2026-00042.',
  templateKey: 'invoice_issued',
  attachmentName: 'INV-2026-00042.pdf',
  lastEventAt: null,
  ...over,
})
const template = (over: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: 't1',
  key: 'general',
  name: 'General message',
  purpose: 'transactional',
  subject: 'A message from {{business_name}}',
  body: 'Good day {{customer_name}},\n\n{{message}}\n\nKind regards\n{{sender_name}}',
  isActive: true,
  updatedAt: '2026-11-20T08:00:00Z',
  ...over,
})
const prefs = {
  email: 'naledi@example.co.za',
  emailOptOut: false,
  marketingConsent: false,
  consentUpdatedAt: null,
  suppressedAt: null,
  suppressedReason: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  m.listMessages.mockResolvedValue(
    ok({
      rows: [
        item(),
        item({
          id: 'm2',
          status: 'failed',
          subject: 'Payment reminder',
          willRetry: true,
          error: 'Resend 503',
        }),
        item({
          id: 'm3',
          channel: 'call',
          direction: 'inbound',
          status: 'logged',
          subject: null,
          recipient: null,
        }),
      ],
      total: 3,
    }),
  )
  m.getMessageSummary.mockResolvedValue(
    ok({ sentThisMonth: 40, deliveredThisMonth: 38, bouncedThisMonth: 1, waiting: 2, failed: 1 }),
  )
  m.getEmailSetup.mockResolvedValue(
    ok({
      email: true,
      missing: [],
      deliveryReports: true,
      retries: true,
      from: 'Umbane <billing@umbane.co.za>',
    }),
  )
  m.getMessage.mockImplementation(() => Promise.resolve(ok(message())))
  m.listMessageEvents.mockResolvedValue(
    ok([
      { id: 'e2', event: 'email.delivered', detail: null, occurredAt: '2026-11-26T08:00:09Z' },
      { id: 'e1', event: 'sent', detail: { attempt: 1 }, occurredAt: '2026-11-26T08:00:05Z' },
    ]),
  )
  m.listTemplates.mockResolvedValue(
    ok([
      template(),
      template({ id: 't2', key: 'winter_tips', name: 'Winter tips', purpose: 'marketing' }),
    ]),
  )
  m.getCustomerPreferences.mockResolvedValue(ok(prefs))
  m.getBusinessName.mockResolvedValue(ok('Umbane'))
  vi.mocked(customerService.getCustomer).mockResolvedValue(
    ok(customerFixture({ id: 'c1', name: 'Naledi Dlamini' })),
  )
  for (const fn of [
    'getCustomerProperties',
    'getCustomerInvoices',
    'getCustomerOrders',
    'getCustomerTickets',
  ] as const)
    vi.mocked(customerService[fn]).mockResolvedValue(ok([]))
})

const open = (route: string, role: UserRole = 'staff') => renderAt(<App />, signedInAs(role), route)

describe('communications page', () => {
  it('shows totals and the history of emails and logged calls', async () => {
    open('/communications')
    const table = await screen.findByRole('table', { name: 'Messages' })
    expect(within(table).getByRole('link', { name: 'Invoice INV-2026-00042' })).toHaveAttribute(
      'href',
      '/communications/m1',
    )
    expect(within(table).getByText('will try again')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Phone call' })).toBeInTheDocument()
    expect(within(table).getByText('incoming')).toBeInTheDocument()
    expect(await screen.findByText('95%')).toBeInTheDocument()
    expect(screen.queryByText('Email is not set up yet.')).toBeNull()
  })

  it('says plainly when email is not set up, and what is missing', async () => {
    m.getEmailSetup.mockResolvedValue(
      ok({
        email: false,
        missing: ['RESEND_API_KEY', 'EMAIL_FROM'],
        deliveryReports: false,
        retries: false,
        from: null,
      }),
    )
    open('/communications')
    expect(await screen.findByText('Email is not set up yet.')).toBeInTheDocument()
    expect(screen.getByText(/missing: RESEND_API_KEY, EMAIL_FROM/)).toBeInTheDocument()
  })

  it('filters what needs attention', async () => {
    open('/communications')
    await screen.findByRole('table', { name: 'Messages' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'attention')
    await waitFor(() =>
      expect(m.listMessages.mock.calls.at(-1)![1]).toEqual({ status: 'attention', channel: '' }),
    )
  })

  it('is closed to clients', async () => {
    open('/communications', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})

describe('a message', () => {
  it('shows the email and what the provider reported', async () => {
    open('/communications/m1')
    expect(
      await screen.findByRole('heading', { name: 'Invoice INV-2026-00042' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Please find attached invoice/)).toBeInTheDocument()
    expect(screen.getByText('Attached: INV-2026-00042.pdf')).toBeInTheDocument()
    expect(await screen.findByText('Delivered to the inbox server')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try Again/ })).toBeNull()
  })

  it('explains a failure and tries again', async () => {
    m.getMessage.mockResolvedValue(
      ok(
        message({
          status: 'failed',
          willRetry: false,
          nextAttemptAt: null,
          error: 'Resend 422 validation_error: Invalid `to`',
        }),
      ),
    )
    m.retryMessage.mockResolvedValue(ok(null))
    m.sendNow.mockResolvedValue({ state: 'sent' })
    open('/communications/m1')
    expect(await screen.findByText(/will not be tried again by itself/)).toBeInTheDocument()
    expect(screen.getByText('Resend 422 validation_error: Invalid `to`')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Try Again/ }))
    expect(await screen.findByText('Email sent.')).toBeInTheDocument()
    expect(m.retryMessage).toHaveBeenCalledWith('m1')
    expect(m.sendNow).toHaveBeenCalledWith('m1')
  })

  it('cancels an email that has not gone', async () => {
    m.getMessage.mockResolvedValue(ok(message({ status: 'queued' })))
    m.cancelMessage.mockResolvedValue(ok(null))
    open('/communications/m1')
    await userEvent.click(await screen.findByRole('button', { name: /Cancel Email/ }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel email' }),
    )
    expect(await screen.findByText('Email cancelled. It will not be sent.')).toBeInTheDocument()
  })
})

describe('templates', () => {
  it('lets a manager edit a template with a live preview', async () => {
    m.saveTemplate.mockResolvedValue(ok({ id: 't1' }))
    open('/communications/templates', 'manager')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit General message' }))
    const dialog = screen.getByRole('dialog')
    const subject = within(dialog).getByLabelText('Subject')
    await userEvent.clear(subject)
    await userEvent.type(subject, 'News for {{{{customer_name}}')
    expect(within(dialog).getByText('News for Naledi Dlamini')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Template saved.')).toBeInTheDocument()
    expect(m.saveTemplate.mock.calls[0]).toMatchObject([
      't1',
      { subject: 'News for {{customer_name}}', key: 'general' },
    ])
  })

  it('refuses an unknown placeholder', async () => {
    open('/communications/templates', 'manager')
    await userEvent.click(await screen.findByRole('button', { name: /New Template/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Odd')
    await userEvent.type(within(dialog).getByLabelText('Key'), 'odd_one')
    await userEvent.type(within(dialog).getByLabelText('Subject'), 'Hi')
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Hello {{{{nickname}}')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Unknown placeholder: {{nickname}}.')).toBeInTheDocument()
    expect(m.saveTemplate).not.toHaveBeenCalled()
  })

  it('shows staff the templates without editing', async () => {
    open('/communications/templates')
    expect(await screen.findByText('Winter tips')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /New Template/ })).toBeNull()
  })
})

describe('messaging a customer', () => {
  it('fills the template and refuses to send until the message is written', async () => {
    shareReady(sh)
    open('/customers/c1')
    await userEvent.click(await screen.findByRole('button', { name: /Send Message/ }))
    const dialog = screen.getByRole('dialog')
    const body = await within(dialog).findByLabelText('Message')
    expect(within(dialog).getByLabelText('Email subject')).toHaveValue('A message from Umbane')
    expect(body).toHaveValue(
      'Good day Naledi Dlamini,\n\n[Write your message here]\n\nKind regards\nTest User',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(within(dialog).getByText(/Replace “\[Write your message here\]”/)).toBeInTheDocument()
    await userEvent.clear(body)
    await userEvent.type(body, 'Your new meter is installed.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText('Sent.')).toBeInTheDocument()
    expect(sh.queueMessage.mock.calls[0][0]).toMatchObject({
      channel: 'email',
      recipient: { kind: 'customer', id: 'c1' },
      body: 'Your new meter is installed.',
      templateKey: 'general',
      purpose: 'transactional',
    })
    expect(sh.sendMessages).toHaveBeenCalledWith(['msg1'])
  })

  it('will not send marketing without consent', async () => {
    shareReady(sh)
    open('/customers/c1')
    await userEvent.click(await screen.findByRole('button', { name: /Send Message/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByLabelText('Template'), 'winter_tips')
    expect(within(dialog).getByText('Email: No marketing consent')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/only customers who agreed to receive marketing/),
    ).toBeInTheDocument()
  })

  it('records consent changes and logs a call', async () => {
    m.setCustomerPreferences.mockResolvedValue(ok(null))
    m.logContact.mockResolvedValue(ok({ id: 'l1' }))
    open('/customers/c1')
    await userEvent.click(await screen.findByLabelText(/Agreed to receive marketing email/))
    await userEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))
    expect(await screen.findByText('Communication preferences saved.')).toBeInTheDocument()
    expect(m.setCustomerPreferences).toHaveBeenCalledWith('c1', {
      emailOptOut: false,
      marketingConsent: true,
      smsOptOut: false,
      whatsappOptIn: false,
    })
    await userEvent.click(screen.getByRole('button', { name: /Log Contact/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('They contacted us'))
    await userEvent.type(
      within(dialog).getByLabelText('What was said or agreed'),
      'Asked about tariffs.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Contact logged.')).toBeInTheDocument()
    expect(m.logContact).toHaveBeenCalledWith({
      customerId: 'c1',
      channel: 'call',
      direction: 'inbound',
      subject: null,
      body: 'Asked about tariffs.',
    })
  })

  it('emails a customer about their ticket', async () => {
    vi.mocked(supportService.getTicket).mockResolvedValue(
      ok({
        id: 't1',
        reference: 'TKT-2026-00418',
        subject: 'Breaker trip',
        category: 'meter_fault',
        status: 'in_progress',
        priority: 'high',
        customerId: 'c1',
        customerName: 'Naledi Dlamini',
        propertyName: null,
        assignedTo: null,
        assigneeName: null,
        createdAt: '2026-11-26T08:00:00Z',
        lastActivityAt: '2026-11-26T08:00:00Z',
        messageCount: 0,
        attachmentCount: 0,
        description: '2026-11-26T08:00:00Z',
        propertyId: null,
        propertyAddress: null,
        meterId: null,
        meterSerial: null,
        customerPhone: null,
        customerEmail: null,
        resolution: null,
        assignedAt: null,
        statusChangedAt: '2026-11-26T08:00:00Z',
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
      }),
    )
    for (const fn of ['listMessages', 'listEvents', 'listAttachments'] as const)
      vi.mocked(supportService[fn]).mockResolvedValue(ok([]))
    vi.mocked(supportService.attachmentUrls).mockResolvedValue(ok({}))
    vi.mocked(taskService.listTasks).mockResolvedValue(ok({ rows: [], total: 0 }))
    m.listTemplates.mockResolvedValue(
      ok([
        template({
          key: 'ticket_update',
          name: 'Support ticket update',
          subject: 'Update on your support ticket {{ticket_reference}}',
        }),
      ]),
    )
    shareReady(sh)
    sh.queueMessage.mockResolvedValue(
      err({ code: 'validation', message: 'This customer has asked not to receive email.' }),
    )
    open('/support-tickets/t1')
    await userEvent.click(await screen.findByRole('button', { name: /Message Customer/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByLabelText('Email subject')).toHaveValue(
      'Update on your support ticket TKT-2026-00418',
    )
    await userEvent.clear(within(dialog).getByLabelText('Message'))
    await userEvent.type(within(dialog).getByLabelText('Message'), 'Technician booked for Monday.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(
      await within(dialog).findByText('This customer has asked not to receive email.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Not sent')).toBeInTheDocument()
    expect(sh.queueMessage.mock.calls[0][0]).toMatchObject({
      ticketId: 't1',
      templateKey: 'ticket_update',
    })
  })
})
