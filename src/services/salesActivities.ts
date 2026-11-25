import type {
  ActivityInput,
  ActivityKind,
  ActivitySubject,
  SalesActivity,
  TimelineEntry,
} from '@/types/sales'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromRow = (r: Row): SalesActivity => ({
  id: String(r.id),
  leadId: str(r.lead_id),
  orderId: str(r.order_id),
  kind: String(r.kind) as ActivityKind,
  subject: String(r.subject),
  dueOn: str(r.due_on),
  assignedTo: str(r.assigned_to),
  assignedName: str(r.assigned_name),
  outcome: str(r.outcome),
  completedAt: str(r.completed_at),
  isOverdue: Boolean(r.is_overdue),
  subjectName: str(r.subject_name),
  subjectReference: str(r.subject_reference),
})

const column = (s: ActivitySubject): ['lead_id' | 'order_id', string] =>
  'leadId' in s ? ['lead_id', s.leadId] : ['order_id', s.orderId]

/** Open first (soonest due), then completed (latest first). */
export const getActivities = (subject: ActivitySubject, client?: DbClient) =>
  guarded<SalesActivity[]>('Activities', client, async (c) => {
    const { data, error } = await c
      .from('sales_activity_list')
      .select('*')
      .eq(...column(subject))
      .order('is_open', { ascending: false })
      .order('completed_at', { ascending: false, nullsFirst: true })
      .order('due_on', { ascending: true, nullsFirst: false })
      .limit(50)
    if (error) return err(mapReadError(error, 'Activities'))
    return ok((data ?? []).map(fromRow))
  })

/** Open activities, soonest due first; for one person or everyone (empty string). */
export const getOpenActivities = (assignedTo: string, client?: DbClient) =>
  guarded<SalesActivity[]>('Activities', client, async (c) => {
    let q = c.from('sales_activity_list').select('*').eq('is_open', true)
    if (assignedTo) q = q.eq('assigned_to', assignedTo)
    const { data, error } = await q
      .order('due_on', { ascending: true, nullsFirst: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Activities'))
    return ok((data ?? []).map(fromRow))
  })

const toRow = (i: ActivityInput) => ({
  kind: i.kind,
  subject: i.subject,
  due_on: i.dueOn,
  assigned_to: i.assignedTo,
  outcome: i.outcome,
  // Any value marks it done; the database replaces it with its own clock.
  completed_at: i.done ? new Date().toISOString() : null,
})

export const createActivity = (subject: ActivitySubject, input: ActivityInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'activity',
    client,
    async (c) => {
      const [key, id] = column(subject)
      const { data, error } = await c
        .from('sales_activities')
        .insert({ [key]: id, ...toRow(input) })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'activity'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const updateActivity = (id: string, input: ActivityInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'activity',
    client,
    async (c) => {
      const { data, error } = await c
        .from('sales_activities')
        .update(toRow(input))
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'activity'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This activity could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

export const getTimeline = (subject: ActivitySubject, client?: DbClient) =>
  guarded<TimelineEntry[]>('History', client, async (c) => {
    const { data, error } = await c
      .from('sales_timeline')
      .select('*')
      .eq(...column(subject))
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return err(mapReadError(error, 'History'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        fromStatus: str(r.from_status),
        toStatus: String(r.to_status),
        note: str(r.note),
        actorName: str(r.actor_name),
        createdAt: String(r.created_at),
      })),
    )
  })
