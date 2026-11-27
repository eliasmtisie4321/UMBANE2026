import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockBackend, type Role } from './support/backend'

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A and AA): labels, names, contrast, landmarks
 * and ARIA use. Runs on desktop, tablet and phone. Keyboard use and screen readers still need the
 * manual checks in docs/QA.md.
 */
const PAGES: Array<[string, Role | undefined, string]> = [
  ['/login', undefined, 'Sign In'],
  ['/create-account', undefined, 'Create'],
  ['/', 'manager', 'Welcome'],
  ['/customers', 'manager', 'Customers'],
  ['/customers/new', 'staff', 'customer'],
  ['/support-tickets/new', 'client', 'Report a Problem'],
  ['/invoices', 'manager', 'Invoices'],
  ['/reports', 'manager', 'Reports'],
  ['/automations', 'manager', 'Automations'],
  ['/notifications/settings', 'staff', 'Notification settings'],
  ['/settings', 'administrator', 'Settings'],
  ['/settings/audit', 'administrator', 'Audit log'],
  ['/account/security', 'client', 'password'],
]

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    where: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
}

for (const [path, role, heading] of PAGES) {
  test(`${path}${role ? ` (${role})` : ''} has no accessibility problems`, async ({ page }) => {
    await mockBackend(page, {
      role,
      tables: {
        ticket_categories: [
          { id: 't1', key: 'general', label: 'General question', is_active: true, position: 10 },
        ],
      },
    })
    await page.goto(path)
    await expect(
      page.getByRole('heading', { name: new RegExp(heading, 'i') }).first(),
    ).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await violations(page)).toEqual([])
  })
}

test('keyboard users can see where they are', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/login')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toBeVisible()
  // A visible focus ring: an outline or a box shadow.
  const ring = await focused.evaluate((el) => {
    const s = getComputedStyle(el)
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
  })
  expect(ring).toBe(true)
})
