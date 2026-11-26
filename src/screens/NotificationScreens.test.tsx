import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as notificationService from '@/services/notifications'
import type { UserRole } from '@/types/auth'
import { NOTIFICATION_CATEGORIES } from '@/types/automations'
import { err, ok } from '@/utils/result'

vi.mock('@/services/notifications')
const n = vi.mocked(notificationService)

const defaults = () =>
  NOTIFICATION_CATEGORIES.map((c) => ({ category: c.value, inApp: true, email: false }))

beforeEach(() => {
  vi.resetAllMocks()
  n.getUnreadCount.mockResolvedValue(ok(1))
  n.flushNotificationEmails.mockResolvedValue(undefined)
  n.getPreferences.mockResolvedValue(ok(defaults()))
  n.savePreferences.mockResolvedValue(ok(null))
  n.listNotifications.mockResolvedValue(
    ok([
      {
        id: 'n1',
        title: 'Low stock: Prepaid meter',
        body: 'MTR-PREPAID has 4 left (reorder level 5).',
        link: '/inventory/p1',
        isRead: false,
        createdAt: '2026-11-26T06:00:00Z',
        category: 'inventory',
      },
    ]),
  )
})

const open = (route: string, role: UserRole = 'manager') =>
  renderAt(<App />, signedInAs(role), route)

describe('notifications page', () => {
  it('shows what each notification is about and filters by it', async () => {
    const user = userEvent.setup()
    open('/notifications')
    expect(await screen.findByText(/Inventory · /)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('About'), 'invoices')
    await waitFor(() =>
      expect(n.listNotifications).toHaveBeenLastCalledWith({
        unreadOnly: true,
        category: 'invoices',
      }),
    )
    expect(screen.getByRole('region', { name: 'Unread: Invoices' })).toBeInTheDocument()
  })

  it('keeps the filter in the address', async () => {
    open('/notifications?show=all&category=tasks')
    await screen.findByText(/Inventory · /)
    expect(n.listNotifications).toHaveBeenLastCalledWith({ unreadOnly: false, category: 'tasks' })
  })

  it('offers clients only what concerns them', async () => {
    open('/notifications', 'client')
    const about = await screen.findByLabelText('About')
    expect(
      within(about)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Everything', 'Support tickets', 'Other'])
  })

  it('sends queued email while people use the app', async () => {
    open('/notifications')
    await screen.findByText(/Inventory · /)
    expect(n.flushNotificationEmails).toHaveBeenCalled()
  })
})

describe('notification settings', () => {
  it('lets a person choose email for a category and saves their choice', async () => {
    const user = userEvent.setup()
    open('/notifications/settings', 'staff')
    const email = await screen.findByRole('checkbox', { name: 'Invoices by email' })
    expect(screen.getByRole('checkbox', { name: 'Invoices in the app' })).toBeChecked()
    expect(email).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled()
    await user.click(email)
    await user.click(screen.getByRole('checkbox', { name: 'Customers in the app' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument()
    const [userId, saved] = n.savePreferences.mock.calls[0]
    expect(userId).toBe('u1')
    expect(saved.find((p) => p.category === 'invoices')).toEqual({
      category: 'invoices',
      inApp: true,
      email: true,
    })
    expect(saved.find((p) => p.category === 'customers')).toEqual({
      category: 'customers',
      inApp: false,
      email: false,
    })
    expect(screen.getByText(/Email goes to test@umbane.test/)).toBeInTheDocument()
  })

  it('shows clients only ticket and other notifications', async () => {
    open('/notifications/settings', 'client')
    await screen.findByRole('checkbox', { name: 'Support tickets by email' })
    expect(screen.queryByRole('checkbox', { name: 'Invoices by email' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })

  it('shows a failure to save', async () => {
    const user = userEvent.setup()
    n.savePreferences.mockResolvedValue(
      err({ code: 'network', message: 'Cannot reach the server.' }),
    )
    open('/notifications/settings')
    await user.click(await screen.findByRole('checkbox', { name: 'Tasks by email' }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument()
  })
})
