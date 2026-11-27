import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as authService from '@/services/auth'
import * as notificationService from '@/services/notifications'
import * as settingsService from '@/services/settings'
import type { UserRole } from '@/types/auth'
import type { AuditEntry, BusinessProfile } from '@/types/settings'
import * as csv from '@/utils/csv'
import { err, ok } from '@/utils/result'

vi.mock('@/services/settings', async (original) => ({
  ...(await original<typeof import('@/services/settings')>()),
  getBusinessProfile: vi.fn(),
  saveBusinessProfile: vi.fn(),
  listTicketCategories: vi.fn(),
  addTicketCategory: vi.fn(),
  updateTicketCategory: vi.fn(),
  deleteTicketCategory: vi.fn(),
  listProductCategoryRecords: vi.fn(),
  addProductCategory: vi.fn(),
  updateProductCategory: vi.fn(),
  deleteProductCategory: vi.fn(),
  listAuditLog: vi.fn(),
  getRetentionPeriods: vi.fn(),
  eraseCustomer: vi.fn(),
  logSecurityEvent: vi.fn(),
}))
vi.mock('@/services/auth', async (original) => ({
  ...(await original<typeof import('@/services/auth')>()),
  changePassword: vi.fn(),
  signOutOtherSessions: vi.fn(),
}))
vi.mock('@/services/notifications')
vi.mock('@/utils/csv', async (original) => ({
  ...(await original<typeof import('@/utils/csv')>()),
  downloadFile: vi.fn(),
}))

const s = vi.mocked(settingsService)
const a = vi.mocked(authService)

const business: BusinessProfile = {
  name: 'Umbane Energy (Pty) Ltd',
  description: 'Sub-metering and billing.',
  email: 'accounts@umbane.co.za',
  phone: '+27 11 000 0000',
  website: 'https://umbane.co.za',
  address: '12 Rivonia Road',
  city: 'Sandton',
  province: 'Gauteng',
  postalCode: '2196',
}
const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'e1',
  action: 'UPDATE',
  table: 'profiles',
  recordId: 'u3',
  actorId: 'u1',
  actorName: 'Ada Admin',
  details: { changes: { role: ['staff', 'manager'] } },
  createdAt: '2026-11-26T08:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  s.getBusinessProfile.mockResolvedValue(ok(business))
  s.saveBusinessProfile.mockResolvedValue(ok(null))
  s.listTicketCategories.mockResolvedValue(
    ok([
      { id: 't1', key: 'meter_fault', label: 'Meter fault', isActive: true, position: 10 },
      { id: 't2', key: 'billing', label: 'Billing', isActive: true, position: 30 },
      { id: 't3', key: 'solar', label: 'Solar installations', isActive: false, position: 70 },
    ]),
  )
  s.listProductCategoryRecords.mockResolvedValue(
    ok([{ id: 'p1', name: 'Smart meters', isActive: true }]),
  )
  for (const fn of [
    s.addTicketCategory,
    s.updateTicketCategory,
    s.deleteTicketCategory,
    s.addProductCategory,
    s.updateProductCategory,
    s.deleteProductCategory,
  ]) {
    vi.mocked(fn).mockResolvedValue(ok(null))
  }
  s.listAuditLog.mockResolvedValue(
    ok({
      total: 3,
      rows: [
        entry(),
        entry({
          id: 'e2',
          action: 'SECURITY',
          table: 'profiles',
          details: { event: 'password_changed' },
          actorName: 'Sam Staff',
        }),
        entry({
          id: 'e3',
          action: 'ERASE',
          table: 'customers',
          recordId: 'c9',
          details: { reason: 'Asked by email' },
        }),
      ],
    }),
  )
  s.getRetentionPeriods.mockResolvedValue(
    ok({
      readNotificationsDays: 365,
      notificationsDays: 730,
      automationHistoryDays: 730,
      processedAccessRequestsDays: 365,
      auditDays: 2557,
    }),
  )
  s.logSecurityEvent.mockResolvedValue(undefined)
})

const open = (route: string, role: UserRole = 'administrator') =>
  renderAt(<App />, signedInAs(role), route)

describe('settings hub', () => {
  it('shows administrators every area', async () => {
    open('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Audit log/ })).toHaveAttribute(
      'href',
      '/settings/audit',
    )
    expect(screen.getByRole('link', { name: /Data and privacy/ })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(11)
  })

  it('leaves the audit log and privacy out for managers, and blocks them', async () => {
    open('/settings', 'manager')
    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.queryByRole('link', { name: /Audit log/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Data and privacy/ })).not.toBeInTheDocument()
  })

  it.each([
    ['/settings/audit', 'manager'],
    ['/settings/privacy', 'manager'],
    ['/settings', 'staff'],
    ['/settings/categories', 'client'],
  ] as const)('keeps %s away from %s users', async (route, role) => {
    open(route, role)
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
  })
})

describe('business profile', () => {
  it('lets an administrator correct and save it', async () => {
    const user = userEvent.setup()
    open('/settings/business')
    const website = await screen.findByLabelText('Website (optional)')
    await user.clear(website)
    await user.type(website, 'umbane.co.za')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(
      await screen.findByText('Start the website with https:// or http://'),
    ).toBeInTheDocument()
    expect(s.saveBusinessProfile).not.toHaveBeenCalled()
    await user.clear(website)
    await user.type(website, 'https://www.umbane.co.za')
    await user.selectOptions(screen.getByLabelText('Province'), 'Western Cape')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(s.saveBusinessProfile).toHaveBeenCalledWith('b1', {
        ...business,
        website: 'https://www.umbane.co.za',
        province: 'Western Cape',
      }),
    )
    expect(await screen.findByText('Business profile saved.')).toBeInTheDocument()
  })

  it('is view-only for managers', async () => {
    open('/settings/business', 'manager')
    expect(await screen.findByLabelText('Business name')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  })
})

describe('categories', () => {
  it('adds, switches on and explains why one cannot be deleted', async () => {
    const user = userEvent.setup()
    s.deleteTicketCategory.mockResolvedValue(
      err({
        code: 'validation',
        message: 'This category is in use, so it cannot be deleted. Switch it off instead.',
      }),
    )
    open('/settings/categories', 'manager')
    const tickets = await screen.findByRole('region', { name: 'Ticket categories' })
    expect(within(tickets).getByText('Switched off')).toBeInTheDocument()
    await user.type(within(tickets).getByLabelText('New ticket category'), 'Prepaid tokens')
    await user.click(within(tickets).getByRole('button', { name: 'Add' }))
    expect(s.addTicketCategory).toHaveBeenCalledWith('Prepaid tokens', 80)
    await user.click(within(tickets).getByRole('button', { name: 'Switch on Solar installations' }))
    expect(s.updateTicketCategory).toHaveBeenCalledWith('t3', { isActive: true })
    await user.click(within(tickets).getByRole('button', { name: 'Delete Billing' }))
    expect(await within(tickets).findByText(/in use, so it cannot be deleted/)).toBeInTheDocument()
  })

  it('refuses a duplicate name before asking the database', async () => {
    const user = userEvent.setup()
    open('/settings/categories', 'manager')
    const products = await screen.findByRole('region', { name: 'Product categories' })
    await user.type(within(products).getByLabelText('New product category'), 'smart METERS')
    await user.click(within(products).getByRole('button', { name: 'Add' }))
    expect(
      within(products).getByText('There is already a product category with this name.'),
    ).toBeInTheDocument()
    expect(s.addProductCategory).not.toHaveBeenCalled()
  })

  it('renames a product category', async () => {
    const user = userEvent.setup()
    open('/settings/categories', 'manager')
    const products = await screen.findByRole('region', { name: 'Product categories' })
    await user.click(within(products).getByRole('button', { name: 'Rename Smart meters' }))
    const input = within(products).getByLabelText('New name for Smart meters')
    await user.clear(input)
    await user.type(input, 'Smart prepaid meters')
    await user.click(within(products).getByRole('button', { name: 'Save' }))
    expect(s.updateProductCategory).toHaveBeenCalledWith('p1', { name: 'Smart prepaid meters' })
  })
})

describe('roles', () => {
  it('shows what each role can do', async () => {
    open('/settings/roles', 'manager')
    const table = await screen.findByRole('table', { name: 'What each role can do' })
    expect(
      within(table).getByRole('rowheader', { name: 'Audit log, data and privacy' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change someone’s role' })).toHaveAttribute(
      'href',
      '/team',
    )
  })
})

describe('audit log', () => {
  it('describes each entry in words with what changed', async () => {
    open('/settings/audit')
    expect(
      await screen.findByText(/^Ada Admin changed a user/, { selector: 'p' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Role: staff → manager')).toBeInTheDocument()
    expect(
      screen.getByText(/^Sam Staff changed their password/, { selector: 'p' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Ada Admin erased a customer’s personal details/, { selector: 'p' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Reason: Asked by email')).toBeInTheDocument()
  })

  it('filters by area and date, kept in the address', async () => {
    const user = userEvent.setup()
    open('/settings/audit?from=2026-11-01')
    await screen.findByText(/^Ada Admin changed a user/, { selector: 'p' })
    await user.selectOptions(screen.getByLabelText('About'), 'people')
    await waitFor(() =>
      expect(s.listAuditLog).toHaveBeenLastCalledWith({
        from: '2026-11-01',
        to: '',
        area: 'people',
        action: '',
        page: 1,
      }),
    )
  })

  it('exports what matches as CSV', async () => {
    const user = userEvent.setup()
    open('/settings/audit')
    await screen.findByText(/^Ada Admin changed a user/, { selector: 'p' })
    await user.click(screen.getByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(csv.downloadFile).toHaveBeenCalled())
    const [name, content] = vi.mocked(csv.downloadFile).mock.calls[0]
    expect(name).toBe('audit-log.csv')
    expect(String(content).split('\r\n')[1]).toBe(
      '2026-11-26T08:00:00Z,Ada Admin,Ada Admin changed a user,UPDATE,profiles,u3,Role: staff → manager',
    )
  })
})

describe('data and privacy', () => {
  it('lists how long records are kept', async () => {
    open('/settings/privacy')
    const table = await screen.findByRole('table', { name: 'How long records are kept' })
    expect(within(table).getByText('7 years')).toBeInTheDocument()
    expect(within(table).getByText('1 year once read; 2 years at most')).toBeInTheDocument()
  })
})

describe('password and sign-in', () => {
  it('is open to every role, and checks the new password first', async () => {
    const user = userEvent.setup()
    open('/account/security', 'client')
    await user.type(await screen.findByLabelText('Current password'), 'Old-pass-123')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(a.changePassword).not.toHaveBeenCalled()
  })

  it('changes the password and records it', async () => {
    const user = userEvent.setup()
    a.changePassword.mockResolvedValue(ok(undefined))
    open('/account/security', 'staff')
    await user.type(await screen.findByLabelText('Current password'), 'Old-pass-123')
    await user.type(screen.getByLabelText('New password'), 'Brand-New-Pass-42')
    await user.type(screen.getByLabelText('New password again'), 'Brand-New-Pass-42')
    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('Your password was changed.')).toBeInTheDocument()
    expect(a.changePassword).toHaveBeenCalledWith(
      'test@umbane.test',
      'Old-pass-123',
      'Brand-New-Pass-42',
    )
    expect(s.logSecurityEvent).toHaveBeenCalledWith('password_changed')
  })

  it('says when the current password is wrong', async () => {
    const user = userEvent.setup()
    a.changePassword.mockResolvedValue(
      err({ code: 'validation', field: 'current', message: 'Your current password is not right.' }),
    )
    open('/account/security')
    await user.type(await screen.findByLabelText('Current password'), 'Wrong-pass-123')
    await user.type(screen.getByLabelText('New password'), 'Brand-New-Pass-42')
    await user.type(screen.getByLabelText('New password again'), 'Brand-New-Pass-42')
    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument()
    expect(s.logSecurityEvent).not.toHaveBeenCalled()
  })

  it('signs out other devices after confirming', async () => {
    const user = userEvent.setup()
    a.signOutOtherSessions.mockResolvedValue(ok(undefined))
    open('/account/security')
    await user.click(await screen.findByRole('button', { name: /Sign Out Other Devices/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign Out Others' }))
    expect(await screen.findByText(/You are signed out everywhere else/)).toBeInTheDocument()
    expect(s.logSecurityEvent).toHaveBeenCalledWith('signed_out_other_sessions')
  })

  it('is in the account menu', async () => {
    const user = userEvent.setup()
    open('/settings')
    await user.click(await screen.findByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('button', { name: /Password and sign-in/ }))
    expect(
      await screen.findByRole('heading', { name: 'Your password and sign-in' }),
    ).toBeInTheDocument()
  })
})
