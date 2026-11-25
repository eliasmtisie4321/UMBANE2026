import type { ListQuery, Page } from '@/types/customers'
import type {
  MaintenanceCounts,
  MaintenanceInput,
  MaintenanceItem,
  MaintenanceKind,
  MaintenancePriority,
  MaintenanceSort,
  MaintenanceStatus,
  StaffOption,
} from '@/types/meters'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromRow = (r: Row): MaintenanceItem => ({
  id: String(r.id),
  reference: String(r.reference),
  meterId: String(r.meter_id),
  serialNumber: String(r.serial_number),
  propertyName: str(r.property_name) ?? str(r.property_address) ?? '-',
  customerName: str(r.customer_name),
  kind: String(r.kind) as MaintenanceKind,
  issue: String(r.issue),
  priority: String(r.priority) as MaintenancePriority,
  status: String(r.status) as MaintenanceStatus,
  scheduledFor: str(r.scheduled_for),
  assignedTo: str(r.assigned_to),
  assignedName: str(r.assigned_name),
  outcome: str(r.outcome),
  completedOn: str(r.completed_on),
  createdAt: String(r.created_at),
  isOverdue: Boolean(r.is_overdue),
})

export interface MaintenanceFilters {
  priority: MaintenancePriority | ''
  /** "open" = scheduled, pending or in progress. */
  status: MaintenanceStatus | 'open' | 'all'
}

export const listMaintenance = (
  query: ListQuery<MaintenanceSort>,
  filters: MaintenanceFilters,
  client?: DbClient,
) =>
  guarded<Page<MaintenanceItem>>('Maintenance', client, async (c) => {
    let q = c.from('maintenance_list').select('*', { count: 'exact' })
    if (filters.priority) q = q.eq('priority', filters.priority)
    if (filters.status === 'open') q = q.eq('is_open', true)
    else if (filters.status !== 'all') q = q.eq('status', filters.status)
    const or = orIlike(
      ['reference', 'serial_number', 'issue', 'property_name', 'customer_name', 'assigned_name'],
      query.search,
    )
    if (or) q = q.or(or)

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Maintenance'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromRow) })
  })

export const getMaintenanceCounts = (client?: DbClient) =>
  guarded<MaintenanceCounts>('Maintenance totals', client, async (c) => {
    const { data, error } = await c.from('maintenance_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Maintenance totals'))
    const r = (data ?? {}) as Row
    return ok({
      scheduled: num(r.scheduled),
      pending: num(r.pending),
      inProgress: num(r.in_progress),
      completed: num(r.completed),
      urgent: num(r.urgent),
      overdue: num(r.overdue),
    })
  })

const latestFor = (column: 'meter_id' | 'property_id', id: string, client?: DbClient) =>
  guarded<MaintenanceItem[]>('Maintenance', client, async (c) => {
    const { data, error } = await c
      .from('maintenance_list')
      .select('*')
      .eq(column, id)
      .order('number', { ascending: false })
      .limit(20)
    if (error) return err(mapReadError(error, 'Maintenance'))
    return ok((data ?? []).map(fromRow))
  })

export const getMeterMaintenance = (meterId: string, client?: DbClient) =>
  latestFor('meter_id', meterId, client)

export const getPropertyMaintenance = (propertyId: string, client?: DbClient) =>
  latestFor('property_id', propertyId, client)

const toRow = (i: MaintenanceInput) => ({
  kind: i.kind,
  issue: i.issue,
  priority: i.priority,
  status: i.status,
  scheduled_for: i.scheduledFor,
  assigned_to: i.assignedTo,
  outcome: i.outcome,
})

export const createMaintenance = (meterId: string, input: MaintenanceInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'work order',
    client,
    async (c) => {
      const { data, error } = await c
        .from('meter_maintenance')
        .insert({ meter_id: meterId, ...toRow(input) })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'work order'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const updateMaintenance = (id: string, input: MaintenanceInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'work order',
    client,
    async (c) => {
      const { data, error } = await c
        .from('meter_maintenance')
        .update(toRow(input))
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'work order'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This work order could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

/** People work can be assigned to. */
export const listStaffOptions = (client?: DbClient) =>
  guarded<StaffOption[]>('Team', client, async (c) => {
    const { data, error } = await c
      .from('profiles')
      .select('id, full_name, email')
      .neq('role', 'client')
      .eq('is_active', true)
      .order('full_name')
      .limit(200)
    if (error) return err(mapReadError(error, 'Team'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        name: str(r.full_name) || str(r.email) || 'Unnamed',
      })),
    )
  })
