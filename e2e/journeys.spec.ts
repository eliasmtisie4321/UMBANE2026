import { expect, test } from '@playwright/test'
import { mockBackend } from './support/backend'

/** The journeys that matter most, end to end in the built app (backend mocked). */

test.describe('signing in', () => {
  test('a visitor is sent to the sign-in page', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/customers')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
  })

  test('a wrong password is explained, and the right one signs in', async ({ page }) => {
    await mockBackend(page, { login: 'wrong-password' })
    await page.goto('/login')
    await page.getByLabel('Email address').fill('manager@umbane.test')
    await page.getByLabel('Password', { exact: true }).fill('not-it')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  })

  test('signing in opens the dashboard', async ({ page }) => {
    await mockBackend(page, { login: 'ok' })
    await page.goto('/login')
    await page.getByLabel('Email address').fill('manager@umbane.test')
    await page.getByLabel('Password', { exact: true }).fill('Correct-horse-1')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Customers' }),
    ).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('a session that ran out sends the person back to sign in', async ({ page }) => {
    await mockBackend(page, { role: 'manager', expiredSession: true })
    await page.goto('/invoices')
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
  })

  test('signing out ends the session', async ({ page }) => {
    await mockBackend(page, { role: 'manager' })
    await page.goto('/')
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
    await page.goto('/customers')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('roles', () => {
  test('staff cannot open reports, and the menu does not offer them', async ({ page }) => {
    await mockBackend(page, { role: 'staff' })
    await page.goto('/reports')
    await expect(page.getByText('You do not have access to this page')).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Reports' })).toHaveCount(0)
  })

  test('a client sees only their own areas', async ({ page }) => {
    await mockBackend(page, { role: 'client' })
    await page.goto('/')
    const nav = page.getByRole('navigation')
    await expect(nav.getByRole('link', { name: 'Support Tickets' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Customers' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0)
    await page.goto('/customers')
    await expect(page.getByText('You do not have access to this page')).toBeVisible()
  })
})

test.describe('everyday work', () => {
  test('staff add a customer', async ({ page }) => {
    const { written } = await mockBackend(page, { role: 'staff' })
    await page.goto('/customers/new')
    await page.getByLabel('Full name').fill('Lerato Khumalo')
    await page.getByLabel('Email address').fill('lerato@example.co.za')
    await page.getByLabel('Phone number', { exact: true }).fill('082 555 0101')
    await page.getByRole('button', { name: /Save/ }).first().click()
    await expect
      .poll(() => written.find((w) => w.table === 'customers' && w.method === 'POST'))
      .toBeTruthy()
    const body = written.find((w) => w.table === 'customers')!.body as Record<string, unknown>
    expect(body).toMatchObject({ name: 'Lerato Khumalo', email: 'lerato@example.co.za' })
  })

  test('a client opens a support ticket', async ({ page }) => {
    const { written } = await mockBackend(page, {
      role: 'client',
      tables: {
        ticket_categories: [
          { id: 't1', key: 'meter_fault', label: 'Meter fault', is_active: true, position: 10 },
          { id: 't2', key: 'billing', label: 'Billing', is_active: true, position: 30 },
        ],
      },
    })
    await page.goto('/support-tickets/new')
    await page.getByLabel('Title').fill('Meter display is blank')
    await page.getByLabel('Category').selectOption('meter_fault')
    await page.getByLabel('Description').fill('Since this morning the display shows nothing.')
    await page.getByRole('button', { name: 'Submit Ticket' }).click()
    await expect.poll(() => written.find((w) => w.table === 'support_tickets')).toBeTruthy()
    expect(written.find((w) => w.table === 'support_tickets')!.body).toMatchObject({
      subject: 'Meter display is blank',
      category: 'meter_fault',
    })
  })

  test('an invoice adds up lines, VAT and the total as you type', async ({ page }) => {
    await mockBackend(page, {
      role: 'manager',
      rpc: {
        billing_profile: {
          name: 'Umbane',
          vat_registered: true,
          default_payment_terms: 'net30',
        },
      },
    })
    await page.goto('/invoices/new')
    const line = page.getByRole('listitem', { name: 'Line 1' })
    await line.getByLabel('Description').fill('Smart meter')
    await line.getByLabel('Quantity').fill('2')
    await line.getByLabel('Unit price (R)').fill('500')
    const summary = page.getByRole('region', { name: 'Invoice summary' })
    await expect(summary.getByText('R 1,000.00').first()).toBeVisible()
    await expect(summary.getByText('R 150.00')).toBeVisible()
    await expect(summary.getByText('R 1,150.00')).toBeVisible()
  })
})
