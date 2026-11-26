import type { Result } from '@/types/api'
import type { ListQuery, Page } from '@/types/customers'
import type {
  Task,
  TaskCategory,
  TaskDisplayStatus,
  TaskEvent,
  TaskEventKind,
  TaskInput,
  TaskListItem,
  TaskPriority,
  TaskSort,
  TaskStatus,
  TaskSummary,
  TaskUpdate,
} from '@/types/team'
import { TASK_FILES } from '@/utils/files'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'
import {
  listFiles,
  signedUrls,
  uploadFile,
  type FileStore,
  type StorageApi,
  type StoredFile,
} from './storageFiles'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromListRow = (r: Row): TaskListItem => ({
  id: String(r.id),
  reference: String(r.reference),
  title: String(r.title),
  category: String(r.category) as TaskCategory,
  status: String(r.status) as TaskStatus,
  displayStatus: String(r.display_status) as TaskDisplayStatus,
  priority: String(r.priority) as TaskPriority,
  startDate: str(r.start_date),
  dueDate: str(r.due_date),
  isOverdue: Boolean(r.is_overdue),
  assignedTo: str(r.assigned_to),
  assigneeName: str(r.assignee_name),
  customerId: str(r.customer_id),
  customerName: str(r.customer_name),
  propertyId: str(r.property_id),
  propertyName: str(r.property_name),
  ticketId: str(r.ticket_id),
  ticketReference: str(r.ticket_reference),
  completedAt: str(r.completed_at),
  lastActivityAt: String(r.last_activity_at),
})

export interface TaskFilters {
  /** "active" = pending or in progress; "overdue" = active and past due. */
  status: TaskStatus | 'active' | 'overdue' | ''
  category: TaskCategory | ''
  priority: TaskPriority | ''
  /** A profile id, "unassigned", or empty for everyone the person may see. */
  assignee: string
  customerId?: string
  ticketId?: string
}

export const listTasks = (query: ListQuery<TaskSort>, filters: TaskFilters, client?: DbClient) =>
  guarded<Page<TaskListItem>>('Tasks', client, async (c) => {
    let q = c.from('task_list').select('*', { count: 'exact' })
    if (filters.status === 'active') q = q.in('status', ['todo', 'in_progress'])
    else if (filters.status === 'overdue') q = q.eq('is_overdue', true)
    else if (filters.status) q = q.eq('status', filters.status)
    if (filters.category) q = q.eq('category', filters.category)
    if (filters.priority) q = q.eq('priority', filters.priority)
    if (filters.assignee === 'unassigned') q = q.is('assigned_to', null)
    else if (filters.assignee) q = q.eq('assigned_to', filters.assignee)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    if (filters.ticketId) q = q.eq('ticket_id', filters.ticketId)
    const or = orIlike(['reference', 'title', 'customer_name'], query.search)
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Tasks'))
    return ok({ total: count ?? 0, rows: ((data ?? []) as Row[]).map(fromListRow) })
  })

export const getTaskSummary = (client?: DbClient) =>
  guarded<TaskSummary>('Task totals', client, async (c) => {
    const { data, error } = await c.from('task_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Task totals'))
    const r = (data ?? {}) as Row
    return ok({
      pending: num(r.pending),
      inProgress: num(r.in_progress),
      overdue: num(r.overdue),
      completedThisMonth: num(r.completed_this_month),
      completed: num(r.completed),
      cancelled: num(r.cancelled),
    })
  })

export const getTask = (id: string, client?: DbClient) =>
  guarded<Task>('Task', client, async (c) => {
    const { data, error } = await c.from('task_list').select('*').eq('id', id).maybeSingle()
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Task'))
    if (error || !data) return err({ code: 'not_found', message: 'This task could not be found.' })
    const r = data as Row
    return ok({
      ...fromListRow(r),
      description: str(r.description),
      proofRequired: Boolean(r.proof_required),
      createdBy: str(r.created_by),
      createdByName: str(r.created_by_name),
      createdAt: String(r.created_at),
      startedAt: str(r.started_at),
      completedBy: str(r.completed_by),
      completedByName: str(r.completed_by_name),
      cancelReason: str(r.cancel_reason),
      updateCount: num(r.update_count),
      photoCount: num(r.photo_count),
    })
  })

const taskRow = (i: TaskInput) => ({
  title: i.title,
  description: i.description,
  category: i.category,
  priority: i.priority,
  assigned_to: i.assignedTo,
  start_date: i.startDate,
  due_date: i.dueDate,
  proof_required: i.proofRequired,
  customer_id: i.customerId,
  property_id: i.propertyId,
  ticket_id: i.ticketId,
  ...(i.status ? { status: i.status } : {}),
})

/** The database records who created it and fills in the customer from a ticket or property. */
export const createTask = (input: TaskInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'task',
    client,
    async (c) => {
      const { data, error } = await c
        .from('staff_tasks')
        .insert(taskRow(input))
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'task'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

const updateTaskRow = (id: string, patch: Row, client?: DbClient) =>
  guarded<{ id: string }>(
    'task',
    client,
    async (c) => {
      const { data, error } = await c.from('staff_tasks').update(patch).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'task'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message: 'You do not have permission to change this task.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

export const updateTask = (id: string, input: TaskInput, client?: DbClient) =>
  updateTaskRow(id, taskRow({ ...input, status: undefined }), client)

/** Completion, start and the person who did it are recorded by the database. */
export const setTaskStatus = (
  id: string,
  status: TaskStatus,
  cancelReason: string | null = null,
  client?: DbClient,
) =>
  updateTaskRow(
    id,
    status === 'cancelled' ? { status, cancel_reason: (cancelReason ?? '').trim() } : { status },
    client,
  )

// Progress updates and history --------------------------------------------------------------------
export const listTaskUpdates = (taskId: string, client?: DbClient) =>
  guarded<TaskUpdate[]>('Progress updates', client, async (c) => {
    const { data, error } = await c
      .from('task_updates')
      .select('id, body, author_name, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(200)
    if (error) return err(mapReadError(error, 'Progress updates'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        body: String(r.body),
        authorName: str(r.author_name),
        createdAt: String(r.created_at),
      })),
    )
  })

export const postTaskUpdate = (taskId: string, body: string, client?: DbClient) =>
  guarded<{ id: string }>(
    'update',
    client,
    async (c) => {
      const { data, error } = await c
        .from('task_updates')
        .insert({ task_id: taskId, body: body.trim() })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'update'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const listTaskEvents = (taskId: string, client?: DbClient) =>
  guarded<TaskEvent[]>('Task history', client, async (c) => {
    const { data, error } = await c
      .from('task_events')
      .select('id, kind, from_value, to_value, actor_name, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return err(mapReadError(error, 'Task history'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind) as TaskEventKind,
        fromValue: str(r.from_value),
        toValue: str(r.to_value),
        actorName: str(r.actor_name),
        createdAt: String(r.created_at),
      })),
    )
  })

// Proof of work -----------------------------------------------------------------------------------
export const TASK_STORE: FileStore = {
  bucket: 'task-attachments',
  table: 'task_attachments',
  parentColumn: 'task_id',
  rules: TASK_FILES,
}

export const listTaskFiles = (taskId: string, client?: DbClient): Promise<Result<StoredFile[]>> =>
  listFiles(TASK_STORE, taskId, client)

export const uploadTaskFile = (
  task: { id: string; businessId: string },
  file: File,
  deps: { client?: DbClient; storage?: StorageApi } = {},
) => uploadFile(TASK_STORE, task, file, deps)

export const taskFileUrls = (paths: string[], storage?: StorageApi) =>
  signedUrls(TASK_STORE.bucket, paths, storage)
