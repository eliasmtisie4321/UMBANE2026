import { NAV_ITEMS } from '@/layouts/navItems'
import type { UserRole } from '@/types/auth'

/**
 * Frontend mirror of docs/PERMISSIONS.md, used only to decide which links and pages to show.
 * The database (Row Level Security) is the real enforcement; never rely on this for security.
 */
const STAFF_BLOCKED = ['/reports', '/automations', '/settings', '/team']
const CLIENT_ALLOWED = [
  '/',
  '/properties',
  '/electricity-meters',
  '/sales-orders',
  '/invoices',
  '/support-tickets',
  '/notifications',
  '/account',
]

const matches = (prefix: string, path: string) =>
  prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`)

// Adding and editing employees is for administrators.
const isEmployeeEdit = (path: string) =>
  path === '/team/new' || /^\/team\/[^/]+\/edit\/?$/.test(path)
// The audit log and data-privacy tools are for administrators only.
const ADMIN_ONLY = ['/settings/audit', '/settings/privacy']
// Creating and changing tasks is for managers; staff work the tasks assigned to them.
const isTaskEdit = (path: string) => /^\/tasks\/(new|[^/]+\/edit)\/?$/.test(path)

export function canAccess(role: UserRole, path: string): boolean {
  if (role === 'administrator') return true
  if (role === 'manager') return !isEmployeeEdit(path) && !ADMIN_ONLY.some((p) => matches(p, path))
  if (role === 'staff') return !STAFF_BLOCKED.some((p) => matches(p, path)) && !isTaskEdit(path)
  // The support portal: clients open tickets for themselves.
  if (path === '/support-tickets/new') return true
  // Otherwise clients may view their own records but never open a create or edit page.
  if (/\/(new|edit)(\/|$)/.test(path)) return false
  // Maintenance notes and technician names are internal.
  if (matches('/electricity-meters/maintenance', path)) return false
  return CLIENT_ALLOWED.some((p) => matches(p, path))
}

export const navFor = (role: UserRole) => NAV_ITEMS.filter((item) => canAccess(role, item.to))
