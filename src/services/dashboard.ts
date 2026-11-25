import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppError, Result } from '@/types/api'
import type {
  ActivityEntry,
  InvoiceSummary,
  LowStock,
  PeriodMonths,
  RecentInvoice,
  RecentPayment,
  Revenue,
  TicketSummary,
  Totals,
} from '@/types/dashboard'
import { fillMonths, monthRange, previousMonthRange } from '@/utils/format'
import { err, ok } from '@/utils/result'
import { getSupabase } from './supabase'

/**
 * Dashboard queries. Every function returns a Result and loads one card's data, so one failing
 * query never blanks the whole dashboard. All reads go through Row Level Security, so each role
 * only ever receives what it is allowed to see; nothing here filters by role itself.
 */
export type DashboardClient = Pick<SupabaseClient, 'from'>

interface QueryError {
  code?: string
  message?: string
}

const resolve = (client?: DashboardClient): DashboardClient => client ?? getSupabase()

function mapQueryError(e: QueryError, what: string): AppError {
  if (e.code === '42501') {
    return { code: 'forbidden', message: 'You do not have access to this information.' }
  }
  if (e.code === 'PGRST205' || e.code === '42P01') {
    return {
      code: 'unknown',
      message: `${what} is unavailable until the latest database update is applied.`,
    }
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  return { code: 'unknown', message: `Could not load ${what}. Please try again.` }
}

async function guard<T>(
  what: string,
  client: DashboardClient | undefined,
  fn: (c: DashboardClient) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await fn(resolve(client))
  } catch (e) {
    return err(mapQueryError(e as QueryError, what))
  }
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** PostgREST returns a joined many-to-one row as an object, but tolerate an array too. */
const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

const OPEN_TICKET_STATUSES = ['open', 'assigned', 'in_progress']

export const getTotals = (client?: DashboardClient) =>
  guard<Totals>('Totals', client, async (c) => {
    const [customers, properties, meters] = await Promise.all([
      c.from('customers').select('*', { count: 'exact', head: true }),
      c.from('properties').select('*', { count: 'exact', head: true }),
      c
        .from('electricity_meters')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
    ])
    const failed = [customers, properties, meters].find((r) => r.error)
    if (failed?.error) return err(mapQueryError(failed.error, 'Totals'))
    return ok({
      customers: customers.count ?? 0,
      properties: properties.count ?? 0,
      activeMeters: meters.count ?? 0,
    })
  })

export const getInvoiceSummary = (client?: DashboardClient) =>
  guard<InvoiceSummary>('Invoices', client, async (c) => {
    const { data, error } = await c
      .from('invoice_summary')
      .select('outstanding_amount, outstanding_count, overdue_count')
      .maybeSingle()
    if (error) return err(mapQueryError(error, 'Invoices'))
    return ok({
      outstandingAmount: num(data?.outstanding_amount),
      outstandingCount: num(data?.outstanding_count),
      overdueCount: num(data?.overdue_count),
    })
  })

export const getTicketSummary = (client?: DashboardClient, now: Date = new Date()) =>
  guard<TicketSummary>('Support tickets', client, async (c) => {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const open = () =>
      c
        .from('support_tickets')
        .select('*', { count: 'exact', head: true })
        .in('status', OPEN_TICKET_STATUSES)
    const [all, high, stale] = await Promise.all([
      open(),
      open().in('priority', ['high', 'urgent']),
      open().lt('created_at', sevenDaysAgo),
    ])
    const failed = [all, high, stale].find((r) => r.error)
    if (failed?.error) return err(mapQueryError(failed.error, 'Support tickets'))
    return ok({
      open: all.count ?? 0,
      highPriority: high.count ?? 0,
      openOverSevenDays: stale.count ?? 0,
    })
  })

export const getLowStock = (client?: DashboardClient) =>
  guard<LowStock>('Stock levels', client, async (c) => {
    const [count, list] = await Promise.all([
      c.from('product_stock').select('*', { count: 'exact', head: true }).eq('is_low', true),
      c
        .from('product_stock')
        .select('product_id, sku, name, stock_on_hand, low_stock_threshold')
        .eq('is_low', true)
        .order('stock_on_hand', { ascending: true })
        .limit(5),
    ])
    const failed = [count, list].find((r) => r.error)
    if (failed?.error) return err(mapQueryError(failed.error, 'Stock levels'))
    return ok({
      count: count.count ?? 0,
      items: (list.data ?? []).map((r) => ({
        productId: String(r.product_id),
        sku: String(r.sku),
        name: String(r.name),
        stockOnHand: num(r.stock_on_hand),
        threshold: num(r.low_stock_threshold),
      })),
    })
  })

export const getRevenue = (
  months: PeriodMonths,
  client?: DashboardClient,
  now: Date = new Date(),
) =>
  guard<Revenue>('Revenue', client, async (c) => {
    const current = monthRange(months, now)
    const previous = previousMonthRange(months, now)
    const { data, error } = await c
      .from('monthly_revenue')
      .select('month, total')
      .gte('month', previous[0])
      .order('month', { ascending: true })
    if (error) return err(mapQueryError(error, 'Revenue'))
    const rows = (data ?? []).map((r) => ({ month: String(r.month), total: num(r.total) }))
    const currentValues = fillMonths(rows, current)
    const previousValues = fillMonths(rows, previous)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    return ok({
      points: current.map((month, i) => ({ month, total: currentValues[i] })),
      total: sum(currentValues),
      previousTotal: sum(previousValues),
    })
  })

export const getRecentPayments = (
  months: PeriodMonths,
  client?: DashboardClient,
  now: Date = new Date(),
) =>
  guard<RecentPayment[]>('Recent payments', client, async (c) => {
    const since = `${monthRange(months, now)[0]}T00:00:00Z`
    const { data, error } = await c
      .from('payments')
      .select('id, amount, paid_at, reference, invoices(invoice_number, customers(name))')
      .gte('paid_at', since)
      .order('paid_at', { ascending: false })
      .limit(8)
    if (error) return err(mapQueryError(error, 'Recent payments'))
    return ok(
      (data ?? []).map((row) => {
        const r = row as unknown as {
          id: string
          amount: unknown
          paid_at: string
          reference: string | null
          invoices: unknown
        }
        const invoice = one(r.invoices as { invoice_number?: string; customers?: unknown } | null)
        const customer = one(invoice?.customers as { name?: string } | null)
        return {
          id: String(r.id),
          amount: num(r.amount),
          paidAt: String(r.paid_at),
          reference: r.reference ?? null,
          invoiceNumber: invoice?.invoice_number ?? null,
          customerName: customer?.name ?? null,
        }
      }),
    )
  })

export const getRecentInvoices = (client?: DashboardClient) =>
  guard<RecentInvoice[]>('Invoices', client, async (c) => {
    const { data, error } = await c
      .from('invoice_balances')
      .select('id, invoice_number, status, total, balance, due_date, is_overdue')
      .order('due_date', { ascending: false, nullsFirst: false })
      .limit(5)
    if (error) return err(mapQueryError(error, 'Invoices'))
    return ok(
      (data ?? []).map((r) => ({
        id: String(r.id),
        invoiceNumber: String(r.invoice_number),
        status: String(r.status),
        total: num(r.total),
        balance: num(r.balance),
        dueDate: (r.due_date as string | null) ?? null,
        isOverdue: Boolean(r.is_overdue),
      })),
    )
  })

/** Audit trail entries. Row Level Security limits this to managers and administrators. */
export const getRecentActivity = (client?: DashboardClient) =>
  guard<ActivityEntry[]>('Recent activity', client, async (c) => {
    const { data, error } = await c
      .from('audit_logs')
      .select('id, action, table_name, created_at, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(8)
    if (error) return err(mapQueryError(error, 'Recent activity'))
    return ok(
      (data ?? []).map((row) => {
        const r = row as unknown as {
          id: string
          action: string
          table_name: string | null
          created_at: string
          profiles: unknown
        }
        const actor = one(r.profiles as { full_name?: string } | null)
        return {
          id: String(r.id),
          action: String(r.action),
          table: r.table_name ?? null,
          actorName: actor?.full_name || null,
          createdAt: String(r.created_at),
        }
      }),
    )
  })
