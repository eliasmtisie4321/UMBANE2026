import type { Result } from '@/types/api'
import type {
  CustomerReport,
  ElectricityReport,
  InventoryReport,
  OverviewReport,
  PropertyReport,
  ReportRange,
  RevenueReport,
  SalesReport,
  SupportReport,
  TeamReport,
} from '@/types/reports'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, type DbClient, type DbError } from './db'

/**
 * Reports. Each report is one call to a database function (supabase/migrations/…_reports.sql)
 * that checks the caller is a manager or administrator, keeps to their business and returns every
 * figure for the page at once. Nothing is totalled here, so the page, the CSV and the PDF always
 * show the same numbers.
 */

// Breakdowns keyed by a stored value (e.g. "in_progress") keep their keys as they are.
const KEEP_KEYS = new Set(['by_status', 'by_employment'])
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function camelize(value: unknown, keepKeys = false): unknown {
  if (Array.isArray(value)) return value.map((v) => camelize(v))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        keepKeys ? k : camel(k),
        camelize(v, KEEP_KEYS.has(k)),
      ]),
    )
  }
  return value
}

/** Messages for the database's own report errors; anything else is a normal read error. */
function mapReportError(e: DbError, what: string) {
  if (/report_range_invalid/.test(e.message ?? '')) {
    return {
      code: 'validation' as const,
      message: 'The start date must be on or before the end date.',
    }
  }
  if (/report_range_too_long/.test(e.message ?? '')) {
    return { code: 'validation' as const, message: 'Choose a period of five years or less.' }
  }
  if (e.code === '42501') {
    return {
      code: 'forbidden' as const,
      message: 'Reports are for managers and administrators.',
    }
  }
  return mapReadError(e, what)
}

function run<T>(fn: string, what: string, args: Record<string, unknown>, client?: DbClient) {
  return guarded<T>(
    what,
    client,
    async (c): Promise<Result<T>> => {
      const { data, error } = await c.rpc(fn, args)
      if (error) return err(mapReportError(error, what))
      if (!data || typeof data !== 'object') return err(mapReadError({}, what))
      return ok(camelize(data) as T)
    },
    mapReportError,
  )
}

const period = (r: ReportRange) => ({ p_from: r.from, p_to: r.to })
/** An empty filter means "everything". */
const opt = (v: string | undefined) => (v ? v : null)

export const getOverviewReport = (range: ReportRange, client?: DbClient) =>
  run<OverviewReport>('report_overview', 'the reports overview', period(range), client)

export const getCustomerReport = (
  range: ReportRange,
  f: { segment?: string; province?: string } = {},
  client?: DbClient,
) =>
  run<CustomerReport>(
    'report_customers',
    'the customer report',
    { ...period(range), p_segment: opt(f.segment), p_province: opt(f.province) },
    client,
  )

export const getPropertyReport = (
  range: ReportRange,
  f: { type?: string; province?: string } = {},
  client?: DbClient,
) =>
  run<PropertyReport>(
    'report_properties',
    'the property report',
    { ...period(range), p_type: opt(f.type), p_province: opt(f.province) },
    client,
  )

export const getElectricityReport = (
  range: ReportRange,
  f: { property?: string; meterType?: string } = {},
  client?: DbClient,
) =>
  run<ElectricityReport>(
    'report_electricity',
    'the electricity report',
    { ...period(range), p_property_id: opt(f.property), p_meter_type: opt(f.meterType) },
    client,
  )

export const getSalesReport = (range: ReportRange, client?: DbClient) =>
  run<SalesReport>('report_sales', 'the sales report', period(range), client)

export const getRevenueReport = (
  range: ReportRange,
  f: { method?: string } = {},
  client?: DbClient,
) =>
  run<RevenueReport>(
    'report_revenue',
    'the revenue report',
    { ...period(range), p_method: opt(f.method) },
    client,
  )

export const getInventoryReport = (
  range: ReportRange,
  f: { category?: string } = {},
  client?: DbClient,
) =>
  run<InventoryReport>(
    'report_inventory',
    'the inventory report',
    { ...period(range), p_category: opt(f.category) },
    client,
  )

export const getSupportReport = (
  range: ReportRange,
  f: { category?: string; priority?: string } = {},
  client?: DbClient,
) =>
  run<SupportReport>(
    'report_support',
    'the support report',
    { ...period(range), p_category: opt(f.category), p_priority: opt(f.priority) },
    client,
  )

export const getTeamReport = (
  range: ReportRange,
  f: { department?: string } = {},
  client?: DbClient,
) =>
  run<TeamReport>(
    'report_team',
    'the team report',
    { ...period(range), p_department: opt(f.department) },
    client,
  )

/** Product categories in use, for the inventory filter. */
export const listProductCategories = (client?: DbClient) =>
  guarded<string[]>('Categories', client, async (c) => {
    const { data, error } = await c.from('products').select('category').not('category', 'is', null)
    if (error) return err(mapReadError(error, 'Categories'))
    const names = new Set(
      ((data ?? []) as Array<{ category: string | null }>).map((r) => r.category ?? ''),
    )
    names.delete('')
    return ok([...names].sort((a, b) => a.localeCompare(b)))
  })
