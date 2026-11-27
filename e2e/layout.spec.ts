import { expect, test } from '@playwright/test'
import { horizontalOverflow, mockBackend } from './support/backend'

/**
 * Runs on desktop, tablet and phone (playwright.config.ts). Every main page must fit the screen
 * without sideways scrolling, and the menu must be reachable.
 */
const PAGES = [
  ['/', 'Overview'],
  ['/customers', 'Customers'],
  ['/invoices', 'Invoices'],
  ['/support-tickets', 'Support Tickets'],
  ['/reports', 'Reports'],
  ['/automations', 'Automations'],
  ['/settings', 'Settings'],
  ['/settings/audit', 'Audit log'],
] as const

for (const [path, title] of PAGES) {
  test(`${title} fits the screen`, async ({ page }) => {
    await mockBackend(page, { role: 'administrator' })
    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
}

test('the sign-in page fits the screen', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
})

test('the menu can be reached on every screen size', async ({ page }, info) => {
  await mockBackend(page, { role: 'manager' })
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
  const customers = page.getByRole('navigation').getByRole('link', { name: 'Customers' })
  if (info.project.name === 'desktop') {
    await expect(customers).toBeVisible()
  } else {
    // Narrow screens hide the menu behind a button.
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
    await expect(customers).toBeVisible()
  }
  await customers.click()
  await expect(page).toHaveURL(/\/customers$/)
})
