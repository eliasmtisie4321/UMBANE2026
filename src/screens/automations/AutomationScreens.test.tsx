import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as automationService from '@/services/automations'
import * as messageService from '@/services/messages'
import * as notificationService from '@/services/notifications'
import type { UserRole } from '@/types/auth'
import { AUTOMATIONS, type Automation } from '@/types/automations'
import { err, ok } from '@/utils/result'

vi.mock('@/services/automations', async (original) => ({
  ...(await original<typeof import('@/services/automations')>()),
  listAutomations: vi.fn(),
  getAutomation: vi.fn(),
  setAutomationEnabled: vi.fn(),
  saveAutomationSettings: vi.fn(),
  runAutomationsNow: vi.fn(),
}))
vi.mock('@/services/messages')
vi.mock('@/services/notifications')

const a = vi.mocked(automationService)
const n = vi.mocked(notificationService)

const DEFAULTS: Record<string, Record<string, number>> = {
  overdue_invoices: { days_overdue: 1 },
  task_reminders: { days_before: 1 },
  maintenance_reminders: { days_before: 1 },
  payment_reminder: { days_before: 3, min_balance: 0 },
  overdue_notice: { days_overdue: 7 },
}
const automation = (key: Automation['key'], over: Partial<Automation> = {}): Automation => ({
  id: `a-${key}`,
  key,
  enabled: !['payment_reminder', 'overdue_notice', 'ticket_status_email'].includes(key),
  settings: DEFAULTS[key] ?? {},
  lastRunAt: null,
  lastStatus: null,
  lastMessage: null,
  updatedAt: '2026-11-26T06:00:00Z',
  ...over,
})
const all = () =>
  AUTOMATIONS.map((i) =>
    automation(
      i.key,
      i.key === 'overdue_invoices'
        ? {
            lastRunAt: '2026-11-26T06:00:05Z',
            lastStatus: 'success',
            lastMessage: '2 done, 0 skipped, 0 failed',
          }
        : {},
    ),
  )

beforeEach(() => {
  vi.resetAllMocks()
  n.getUnreadCount.mockResolvedValue(ok(0))
  n.flushNotificationEmails.mockResolvedValue(undefined)
  vi.mocked(messageService.getEmailSetup).mockResolvedValue(
    ok({ email: true, missing: [], deliveryReports: true, retries: true, from: 'Umbane <a@b.co>' }),
  )
  a.listAutomations.mockResolvedValue(ok(all()))
  a.setAutomationEnabled.mockResolvedValue(ok(null))
  a.saveAutomationSettings.mockResolvedValue(ok(null))
})

const open = (route: string, role: UserRole = 'manager') =>
  renderAt(<App />, signedInAs(role), route)

describe('automations list', () => {
  it.each(['staff', 'client'] as const)('is for managers, not %s users', async (role) => {
    open('/automations', role)
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
    expect(a.listAutomations).not.toHaveBeenCalled()
  })

  it('shows team alerts and customer emails with what each does and its last run', async () => {
    open('/automations')
    const team = await screen.findByRole('region', { name: 'Team alerts' })
    const customers = screen.getByRole('region', { name: 'Customer emails' })
    expect(within(team).getAllByRole('listitem')).toHaveLength(6)
    expect(within(customers).getAllByRole('listitem')).toHaveLength(3)
    expect(
      within(team).getByText('An invoice is 1 day past its due date and still unpaid'),
    ).toBeInTheDocument()
    expect(within(team).getByText('Succeeded')).toBeInTheDocument()
    expect(within(customers).getAllByText('Off')).toHaveLength(3)
  })

  it('switches an automation on and says so', async () => {
    const user = userEvent.setup()
    open('/automations')
    await user.click(
      await screen.findByRole('button', { name: 'Switch on Payment reminders to customers' }),
    )
    expect(a.setAutomationEnabled).toHaveBeenCalledWith('payment_reminder', true)
    expect(
      await screen.findByText('Payment reminders to customers switched on.'),
    ).toBeInTheDocument()
    expect(a.listAutomations).toHaveBeenCalledTimes(2)
  })

  it('runs the daily automations now and reports what happened', async () => {
    const user = userEvent.setup()
    a.runAutomationsNow.mockResolvedValue(
      ok([
        { key: 'overdue_invoices', status: 'success', done: 2, skipped: 0, failed: 0 },
        { key: 'task_reminders', status: 'partial', done: 1, skipped: 1, failed: 1 },
      ]),
    )
    open('/automations')
    await user.click(await screen.findByRole('button', { name: /Run Now/ }))
    expect(
      await screen.findByText('Ran 2 daily automations: 3 done, 1 skipped, 1 failed.'),
    ).toBeInTheDocument()
    expect(n.flushNotificationEmails).toHaveBeenCalled()
  })

  it('warns when email is not set up', async () => {
    vi.mocked(messageService.getEmailSetup).mockResolvedValue(
      ok({
        email: false,
        missing: ['RESEND_API_KEY'],
        deliveryReports: false,
        retries: false,
        from: null,
      }),
    )
    open('/automations')
    expect(await screen.findByText(/Email is not set up yet/)).toBeInTheDocument()
  })

  it('shows a failure to switch', async () => {
    const user = userEvent.setup()
    a.setAutomationEnabled.mockResolvedValue(err({ code: 'forbidden', message: 'Not allowed.' }))
    open('/automations')
    await user.click(await screen.findByRole('button', { name: 'Switch off Low stock alerts' }))
    expect(await screen.findByText('Not allowed.')).toBeInTheDocument()
  })
})

describe('one automation', () => {
  const detail = (over: Partial<Automation> = {}) => ({
    automation: automation('payment_reminder', { enabled: true, ...over }),
    runs: [
      {
        id: 'r1',
        number: 12,
        trigger: 'schedule' as const,
        startedAt: '2026-11-26T06:00:00Z',
        finishedAt: '2026-11-26T06:00:02Z',
        status: 'partial' as const,
        checked: 3,
        done: 1,
        skipped: 1,
        failed: 1,
        error: null,
      },
    ],
    actions: [
      {
        id: 'x1',
        runId: 'r1',
        targetType: 'invoice' as const,
        targetId: 'i1',
        targetLabel: 'INV-2026-00042 · Kagiso Mahlangu',
        outcome: 'emailed' as const,
        detail: 'Email queued to the customer',
        createdAt: '2026-11-26T06:00:01Z',
      },
      {
        id: 'x2',
        runId: 'r1',
        targetType: 'invoice' as const,
        targetId: 'i2',
        targetLabel: 'INV-2026-00043 · Thabo Mokoena',
        outcome: 'skipped' as const,
        detail: 'message_opted_out',
        createdAt: '2026-11-26T06:00:01Z',
      },
      {
        id: 'x3',
        runId: 'r1',
        targetType: 'invoice' as const,
        targetId: 'i3',
        targetLabel: 'INV-2026-00044 · Naledi Dlamini',
        outcome: 'failed' as const,
        detail: 'connection reset',
        createdAt: '2026-11-26T06:00:02Z',
      },
    ],
  })

  it('shows how it works, its runs and what it did, in words', async () => {
    a.getAutomation.mockResolvedValue(ok(detail()))
    open('/automations/payment_reminder')
    expect(
      await screen.findByRole('heading', { name: 'Payment reminders to customers' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'How it works' })).getByText(
        'An invoice is due within 3 days and still unpaid',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('RUN-12')).toBeInTheDocument()
    expect(screen.getByText('Partly failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'INV-2026-00042 · Kagiso Mahlangu' })).toHaveAttribute(
      'href',
      '/invoices/i1',
    )
    expect(screen.getByText('The customer does not want email.')).toBeInTheDocument()
    expect(screen.getByText('It will be tried again at the next run.')).toBeInTheDocument()
  })

  it('checks settings before saving them as numbers', async () => {
    const user = userEvent.setup()
    a.getAutomation.mockResolvedValue(ok(detail()))
    open('/automations/payment_reminder')
    const days = await screen.findByLabelText('Days before the due date (days)')
    await user.clear(days)
    await user.type(days, '45')
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(await screen.findByText('Enter a whole number from 1 to 30.')).toBeInTheDocument()
    expect(a.saveAutomationSettings).not.toHaveBeenCalled()
    await user.clear(days)
    await user.type(days, '5')
    const min = screen.getByLabelText('Only when more than (rand)')
    await user.clear(min)
    await user.type(min, '500')
    expect(
      screen.getByText('An invoice is due within 5 days with more than R 500 still owed'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() =>
      expect(a.saveAutomationSettings).toHaveBeenCalledWith('payment_reminder', {
        days_before: 5,
        min_balance: 500,
      }),
    )
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('switches off from its page', async () => {
    const user = userEvent.setup()
    a.getAutomation.mockResolvedValue(ok(detail()))
    open('/automations/payment_reminder')
    await user.click(await screen.findByRole('button', { name: 'Switch Off' }))
    expect(a.setAutomationEnabled).toHaveBeenCalledWith('payment_reminder', false)
  })

  it('says so for an automation that does not exist', async () => {
    open('/automations/send_spam')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(a.getAutomation).not.toHaveBeenCalled()
  })
})
