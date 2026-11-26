import { describe, expect, it } from 'vitest'
import { canAccess, navFor } from './permissions'

describe('canAccess', () => {
  it('lets administrators and managers reach everything', () => {
    for (const role of ['administrator', 'manager'] as const) {
      for (const path of ['/', '/settings', '/team', '/reports', '/customers/123']) {
        expect(canAccess(role, path)).toBe(true)
      }
    }
  })

  it('keeps staff out of settings, team, reports and automations', () => {
    expect(canAccess('staff', '/customers')).toBe(true)
    for (const path of ['/settings', '/team', '/reports', '/automations', '/settings/security']) {
      expect(canAccess('staff', path)).toBe(false)
    }
  })

  it('limits clients to their own areas', () => {
    expect(canAccess('client', '/')).toBe(true)
    expect(canAccess('client', '/invoices')).toBe(true)
    expect(canAccess('client', '/support-tickets/42')).toBe(true)
    for (const path of ['/customers', '/leads', '/inventory', '/team', '/settings', '/marketing']) {
      expect(canAccess('client', path)).toBe(false)
    }
  })

  it('does not match on prefix lookalikes', () => {
    expect(canAccess('client', '/invoices-admin')).toBe(false)
    expect(canAccess('staff', '/settingsx')).toBe(true)
  })

  it('lets clients open support tickets for themselves, but not edit them', () => {
    expect(canAccess('client', '/support-tickets')).toBe(true)
    expect(canAccess('client', '/support-tickets/new')).toBe(true)
    expect(canAccess('client', '/support-tickets/abc')).toBe(true)
    expect(canAccess('client', '/support-tickets/abc/edit')).toBe(false)
    expect(canAccess('client', '/support-tickets/new/edit')).toBe(false)
  })

  it('lets clients view their records but never open a create or edit page', () => {
    expect(canAccess('client', '/properties')).toBe(true)
    expect(canAccess('client', '/properties/abc')).toBe(true)
    expect(canAccess('client', '/properties/new')).toBe(false)
    expect(canAccess('client', '/properties/abc/edit')).toBe(false)
    expect(canAccess('client', '/electricity-meters/abc')).toBe(true)
    expect(canAccess('client', '/electricity-meters/maintenance')).toBe(false)
    expect(canAccess('staff', '/electricity-meters/maintenance')).toBe(true)
    // "new" must be a whole path segment, not just the start of one.
    expect(canAccess('client', '/support-tickets/newsletter')).toBe(true)
  })

  it('lets staff and above create and edit', () => {
    for (const role of ['staff', 'manager', 'administrator'] as const) {
      expect(canAccess(role, '/customers/new')).toBe(true)
      expect(canAccess(role, '/properties/abc/edit')).toBe(true)
    }
  })
})

describe('navFor', () => {
  it('returns only links the role can open', () => {
    const client = navFor('client').map((i) => i.to)
    expect(client).toContain('/invoices')
    expect(client).not.toContain('/customers')
    expect(navFor('administrator').length).toBeGreaterThan(client.length)
  })
})
