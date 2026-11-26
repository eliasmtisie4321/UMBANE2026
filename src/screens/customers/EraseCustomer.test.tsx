import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as customerService from '@/services/customers'
import * as messageService from '@/services/messages'
import * as notificationService from '@/services/notifications'
import * as settingsService from '@/services/settings'
import { customerFixture } from '@/test/fixtures'
import type { UserRole } from '@/types/auth'
import { err, ok } from '@/utils/result'

vi.mock('@/services/customers')
vi.mock('@/services/messages')
vi.mock('@/services/notifications')
vi.mock('@/services/settings', async (original) => ({
  ...(await original<typeof import('@/services/settings')>()),
  eraseCustomer: vi.fn(),
}))

const c = vi.mocked(customerService)
const s = vi.mocked(settingsService)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  c.getCustomer.mockResolvedValue(ok(customerFixture({ id: 'c1', name: 'Thabo Mokoena' })))
  c.getCustomerProperties.mockResolvedValue(ok([]))
  c.getCustomerInvoices.mockResolvedValue(ok([]))
  c.getCustomerOrders.mockResolvedValue(ok([]))
  c.getCustomerTickets.mockResolvedValue(ok([]))
  vi.mocked(messageService.getCustomerPreferences).mockResolvedValue(
    ok({
      email: null,
      emailOptOut: false,
      marketingConsent: false,
      consentUpdatedAt: null,
      suppressedAt: null,
      suppressedReason: null,
    }),
  )
  vi.mocked(messageService.listMessages).mockResolvedValue(ok({ rows: [], total: 0 }))
})

const open = (role: UserRole) => renderAt(<App />, signedInAs(role), '/customers/c1')

describe('erasing a customer', () => {
  it('is only offered to administrators', async () => {
    open('manager')
    await screen.findByRole('heading', { name: 'Thabo Mokoena' })
    expect(screen.queryByRole('button', { name: 'Erase Personal Details' })).not.toBeInTheDocument()
  })

  it('needs a reason, then erases and reloads', async () => {
    const user = userEvent.setup()
    s.eraseCustomer.mockResolvedValue(ok(null))
    open('administrator')
    await user.click(await screen.findByRole('button', { name: 'Erase Personal Details' }))
    expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Erase Personal Details' }).at(-1)!)
    expect(await screen.findByText(/Say why/)).toBeInTheDocument()
    expect(s.eraseCustomer).not.toHaveBeenCalled()
    await user.type(
      screen.getByLabelText('Why (kept in the audit log)'),
      'Asked by email on 26 Nov',
    )
    c.getCustomer.mockResolvedValue(
      ok(
        customerFixture({ id: 'c1', name: 'Erased customer C1', erasedAt: '2026-11-26T08:00:00Z' }),
      ),
    )
    await user.click(screen.getAllByRole('button', { name: 'Erase Personal Details' }).at(-1)!)
    await waitFor(() =>
      expect(s.eraseCustomer).toHaveBeenCalledWith('c1', 'Asked by email on 26 Nov'),
    )
    expect(
      await screen.findByText(/personal details were erased on 26 Nov 2026/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('says why the database refused', async () => {
    const user = userEvent.setup()
    s.eraseCustomer.mockResolvedValue(
      err({
        code: 'validation',
        message:
          'This customer still owes money. Settle or credit their invoices before erasing them.',
      }),
    )
    open('administrator')
    await user.click(await screen.findByRole('button', { name: 'Erase Personal Details' }))
    await user.type(await screen.findByLabelText('Why (kept in the audit log)'), 'Asked')
    await user.click(screen.getAllByRole('button', { name: 'Erase Personal Details' }).at(-1)!)
    expect(await screen.findByText(/still owes money/)).toBeInTheDocument()
  })
})
