import type { Result } from '@/types/api'
import {
  AUDIT_AREAS,
  type AuditEntry,
  type AuditFilter,
  type BusinessProfile,
  type ProductCategory,
  type RetentionPeriods,
  type TicketCategory,
} from '@/types/settings'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

/**
 * Settings and administration (supabase/migrations/…_settings_admin_audit.sql). The database
 * decides who may do what: administrators edit the business and read the audit log; managers manage
 * categories; everyone signed in can record their own security events.
 */
type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const blank = (v: string | null) => (v && v.trim() ? v.trim() : null)

// Business profile ---------------------------------------------------------------------------------
const PROFILE_COLUMNS =
  'name, description, email, phone, website, address, city, province, postal_code'

export const getBusinessProfile = (client?: DbClient) =>
  guarded<BusinessProfile>('Business profile', client, async (c) => {
    const { data, error } = await c.from('businesses').select(PROFILE_COLUMNS).maybeSingle()
    if (error) return err(mapReadError(error, 'Business profile'))
    if (!data) return err({ code: 'not_found', message: 'Your business could not be found.' })
    const r = data as Row
    return ok({
      name: String(r.name ?? ''),
      description: str(r.description),
      email: str(r.email),
      phone: str(r.phone),
      website: str(r.website),
      address: str(r.address),
      city: str(r.city),
      province: str(r.province),
      postalCode: str(r.postal_code),
    })
  })

export const saveBusinessProfile = (businessId: string, p: BusinessProfile, client?: DbClient) =>
  guarded<null>(
    'business profile',
    client,
    async (c) => {
      const { data, error } = await c
        .from('businesses')
        .update({
          name: p.name.trim(),
          description: blank(p.description),
          email: blank(p.email)?.toLowerCase() ?? null,
          phone: blank(p.phone),
          website: blank(p.website),
          address: blank(p.address),
          city: blank(p.city),
          province: blank(p.province),
          postal_code: blank(p.postalCode),
        })
        .eq('id', businessId)
        .select('id')
      if (error) return err(mapWriteError(error, 'business profile'))
      // Row Level Security updates nothing (rather than failing) for someone not allowed.
      if (!data || (data as unknown[]).length === 0) {
        return err({
          code: 'forbidden',
          message: 'Only an administrator can change the business profile.',
        })
      }
      return ok(null)
    },
    mapWriteError,
  )

// Categories ----------------------------------------------------------------------------------------
export const listTicketCategories = (client?: DbClient) =>
  guarded<TicketCategory[]>('Ticket categories', client, async (c) => {
    const { data, error } = await c
      .from('ticket_categories')
      .select('id, key, label, is_active, position')
      .order('position')
      .order('label')
    if (error) return err(mapReadError(error, 'Ticket categories'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        key: String(r.key),
        label: String(r.label),
        isActive: Boolean(r.is_active),
        position: num(r.position),
      })),
    )
  })

/** "Solar installations" → "solar_installations": the stored key of a new category. */
export function categoryKey(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(key) ? key : `c_${key}`.slice(0, 40)
}

export const addTicketCategory = (label: string, position: number, client?: DbClient) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const { error } = await c
        .from('ticket_categories')
        .insert({ key: categoryKey(label), label: label.trim(), position })
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

export const updateTicketCategory = (
  id: string,
  patch: Partial<Pick<TicketCategory, 'label' | 'isActive' | 'position'>>,
  client?: DbClient,
) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const row: Row = {}
      if (patch.label !== undefined) row.label = patch.label.trim()
      if (patch.isActive !== undefined) row.is_active = patch.isActive
      if (patch.position !== undefined) row.position = patch.position
      const { error } = await c.from('ticket_categories').update(row).eq('id', id)
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

export const deleteTicketCategory = (id: string, client?: DbClient) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const { error } = await c.from('ticket_categories').delete().eq('id', id)
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

export const listProductCategoryRecords = (client?: DbClient) =>
  guarded<ProductCategory[]>('Product categories', client, async (c) => {
    const { data, error } = await c
      .from('product_categories')
      .select('id, name, is_active')
      .order('name')
    if (error) return err(mapReadError(error, 'Product categories'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        isActive: Boolean(r.is_active),
      })),
    )
  })

export const addProductCategory = (name: string, client?: DbClient) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const { error } = await c.from('product_categories').insert({ name: name.trim() })
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

export const updateProductCategory = (
  id: string,
  patch: Partial<Pick<ProductCategory, 'name' | 'isActive'>>,
  client?: DbClient,
) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const row: Row = {}
      if (patch.name !== undefined) row.name = patch.name.trim()
      if (patch.isActive !== undefined) row.is_active = patch.isActive
      const { error } = await c.from('product_categories').update(row).eq('id', id)
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

export const deleteProductCategory = (id: string, client?: DbClient) =>
  guarded<null>(
    'category',
    client,
    async (c) => {
      const { error } = await c.from('product_categories').delete().eq('id', id)
      if (error) return err(mapWriteError(error, 'category'))
      return ok(null)
    },
    mapWriteError,
  )

// Audit log ------------------------------------------------------------------------------------------
export const AUDIT_PAGE_SIZE = 50
const BUSINESS_TZ = '+02:00'

export const listAuditLog = (f: AuditFilter, client?: DbClient) =>
  guarded<{ rows: AuditEntry[]; total: number }>(
    'Audit log',
    client,
    async (c): Promise<Result<{ rows: AuditEntry[]; total: number }>> => {
      let q = c
        .from('audit_logs')
        .select('id, action, table_name, record_id, actor_id, actor_name, details, created_at', {
          count: 'exact',
        })
      // Dates are South African days.
      if (f.from) q = q.gte('created_at', `${f.from}T00:00:00${BUSINESS_TZ}`)
      if (f.to) q = q.lte('created_at', `${f.to}T23:59:59.999${BUSINESS_TZ}`)
      const area = AUDIT_AREAS.find((a) => a.value === f.area)
      if (area) q = q.in('table_name', area.tables)
      if (f.action) q = q.eq('action', f.action)
      const start = (Math.max(1, f.page) - 1) * AUDIT_PAGE_SIZE
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(start, start + AUDIT_PAGE_SIZE - 1)
      if (error) return err(mapReadError(error, 'Audit log'))
      return ok({
        total: count ?? 0,
        rows: ((data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          action: String(r.action),
          table: str(r.table_name),
          recordId: str(r.record_id),
          actorId: str(r.actor_id),
          actorName: str(r.actor_name),
          details: (r.details as Record<string, unknown> | null) ?? null,
          createdAt: String(r.created_at),
        })),
      })
    },
  )

// Privacy -------------------------------------------------------------------------------------------
export const getRetentionPeriods = (client?: DbClient) =>
  guarded<RetentionPeriods>('Retention', client, async (c) => {
    const { data, error } = await c.rpc('retention_periods')
    if (error) return err(mapReadError(error, 'Retention'))
    const r = (data ?? {}) as Row
    return ok({
      readNotificationsDays: num(r.read_notifications_days),
      notificationsDays: num(r.notifications_days),
      automationHistoryDays: num(r.automation_history_days),
      processedAccessRequestsDays: num(r.processed_access_requests_days),
      auditDays: num(r.audit_days),
    })
  })

export const eraseCustomer = (customerId: string, reason: string, client?: DbClient) =>
  guarded<null>(
    'customer',
    client,
    async (c) => {
      const { error } = await c.rpc('erase_customer', {
        p_customer_id: customerId,
        p_reason: reason.trim(),
      })
      if (error) return err(mapWriteError(error, 'customer'))
      return ok(null)
    },
    mapWriteError,
  )

/** Records the signed-in person's own security event; a failure to log never blocks them. */
export async function logSecurityEvent(
  event: 'password_changed' | 'signed_out_other_sessions',
  client?: DbClient,
): Promise<void> {
  await guarded<null>('security event', client, async (c) => {
    await c.rpc('log_security_event', { p_event: event })
    return ok(null)
  })
}
