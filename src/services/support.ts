import type { Result } from '@/types/api'
import type { ListQuery, Page } from '@/types/customers'
import type {
  Ticket,
  TicketAsset,
  TicketAttachment,
  TicketCategory,
  TicketCounts,
  TicketDetailsInput,
  TicketEvent,
  TicketEventKind,
  TicketInput,
  TicketListItem,
  TicketMessage,
  TicketPriority,
  TicketSort,
  TicketStatus,
  WorkloadRow,
} from '@/types/support'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { TICKET_FILES } from '@/utils/files'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'
import { listFiles, signedUrls, uploadFile, type FileStore, type StorageApi } from './storageFiles'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export type { StorageApi } from './storageFiles'
export const BUCKET = 'ticket-attachments'

const fromListRow = (r: Row): TicketListItem => ({
  id: String(r.id),
  reference: String(r.reference),
  subject: String(r.subject),
  category: String(r.category) as TicketCategory,
  status: String(r.status) as TicketStatus,
  priority: String(r.priority) as TicketPriority,
  customerId: String(r.customer_id),
  customerName: String(r.customer_name),
  propertyName: str(r.property_name),
  assignedTo: str(r.assigned_to),
  assigneeName: str(r.assignee_name),
  createdAt: String(r.created_at),
  lastActivityAt: String(r.last_activity_at),
  messageCount: num(r.message_count),
  attachmentCount: num(r.attachment_count),
})

export interface TicketFilters {
  /** "active" = open, assigned or in progress. */
  status: TicketStatus | 'active' | ''
  category: TicketCategory | ''
  priority: TicketPriority | ''
  /** A profile id, "unassigned", or empty for everyone. */
  assignee: string
  customerId?: string
}

export const listTickets = (
  query: ListQuery<TicketSort>,
  filters: TicketFilters,
  client?: DbClient,
) =>
  guarded<Page<TicketListItem>>('Support tickets', client, async (c) => {
    let q = c.from('ticket_list').select('*', { count: 'exact' })
    if (filters.status === 'active') q = q.eq('is_open', true)
    else if (filters.status) q = q.eq('status', filters.status)
    if (filters.category) q = q.eq('category', filters.category)
    if (filters.priority) q = q.eq('priority', filters.priority)
    if (filters.assignee === 'unassigned') q = q.is('assigned_to', null)
    else if (filters.assignee) q = q.eq('assigned_to', filters.assignee)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    const or = orIlike(['reference', 'subject', 'customer_name'], query.search)
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Support tickets'))
    return ok({ total: count ?? 0, rows: ((data ?? []) as Row[]).map(fromListRow) })
  })

export const getTicketCounts = (client?: DbClient) =>
  guarded<TicketCounts>('Ticket totals', client, async (c) => {
    const { data, error } = await c.from('ticket_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Ticket totals'))
    const r = (data ?? {}) as Row
    return ok({
      total: num(r.total),
      open: num(r.open),
      assigned: num(r.assigned),
      inProgress: num(r.in_progress),
      resolved: num(r.resolved),
      closed: num(r.closed),
      urgentOpen: num(r.urgent_open),
    })
  })

export const getTicket = (id: string, client?: DbClient) =>
  guarded<Ticket>('Ticket', client, async (c) => {
    const { data, error } = await c.from('ticket_list').select('*').eq('id', id).maybeSingle()
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Ticket'))
    if (error || !data)
      return err({ code: 'not_found', message: 'This ticket could not be found.' })
    const r = data as Row
    return ok({
      ...fromListRow(r),
      description: str(r.description),
      propertyId: str(r.property_id),
      propertyAddress: str(r.property_address),
      meterId: str(r.meter_id),
      meterSerial: str(r.meter_serial),
      customerPhone: str(r.customer_phone),
      customerEmail: str(r.customer_email),
      resolution: str(r.resolution),
      assignedAt: str(r.assigned_at),
      statusChangedAt: String(r.status_changed_at),
      firstResponseAt: str(r.first_response_at),
      resolvedAt: str(r.resolved_at),
      closedAt: str(r.closed_at),
    })
  })

const detailsRow = (i: TicketDetailsInput) => ({
  subject: i.subject,
  description: i.description,
  category: i.category,
  property_id: i.propertyId,
  meter_id: i.meterId,
  ...(i.priority ? { priority: i.priority } : {}),
})

/** The database gives the ticket its reference; a client's ticket is always their own. */
export const createTicket = (input: TicketInput, client?: DbClient) =>
  guarded<{ id: string; reference: string }>(
    'ticket',
    client,
    async (c) => {
      const { data, error } = await c
        .from('support_tickets')
        .insert({
          ...detailsRow(input),
          ...(input.customerId ? { customer_id: input.customerId } : {}),
          ...(input.assignedTo ? { assigned_to: input.assignedTo } : {}),
        })
        .select('id, reference')
        .single()
      if (error) return err(mapWriteError(error, 'ticket'))
      const r = data as Row
      return ok({ id: String(r.id), reference: String(r.reference) })
    },
    mapWriteError,
  )

const updateTicketRow = (id: string, patch: Row, client?: DbClient) =>
  guarded<{ id: string }>(
    'ticket',
    client,
    async (c) => {
      const { data, error } = await c
        .from('support_tickets')
        .update(patch)
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'ticket'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message: 'You do not have permission to change this ticket.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

export const updateTicketDetails = (id: string, input: TicketDetailsInput, client?: DbClient) =>
  updateTicketRow(id, detailsRow(input), client)

/** Assigning moves an open ticket to Assigned; unassigning returns an active one to Open. */
export const assignTicket = (
  id: string,
  assignedTo: string | null,
  priority: TicketPriority,
  client?: DbClient,
) => updateTicketRow(id, { assigned_to: assignedTo, priority }, client)

export const setTicketStatus = (
  id: string,
  status: TicketStatus,
  resolution: string | null,
  client?: DbClient,
) =>
  updateTicketRow(
    id,
    resolution === null ? { status } : { status, resolution: resolution.trim() },
    client,
  )

// Conversation and history -------------------------------------------------------------------------
export const listMessages = (ticketId: string, client?: DbClient) =>
  guarded<TicketMessage[]>('Messages', client, async (c) => {
    const { data, error } = await c
      .from('ticket_messages')
      .select('id, body, is_internal, from_staff, author_name, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at')
      .order('id')
      .limit(500)
    if (error) return err(mapReadError(error, 'Messages'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        body: String(r.body),
        isInternal: Boolean(r.is_internal),
        fromStaff: Boolean(r.from_staff),
        authorName: str(r.author_name),
        createdAt: String(r.created_at),
      })),
    )
  })

/** The author, time and side are set by the database from the person signed in. */
export const postMessage = (ticketId: string, body: string, internal: boolean, client?: DbClient) =>
  guarded<{ id: string }>(
    'message',
    client,
    async (c) => {
      const { data, error } = await c
        .from('ticket_messages')
        .insert({ ticket_id: ticketId, body: body.trim(), is_internal: internal })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'message'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const listEvents = (ticketId: string, client?: DbClient) =>
  guarded<TicketEvent[]>('Ticket history', client, async (c) => {
    const { data, error } = await c
      .from('ticket_events')
      .select('id, kind, from_value, to_value, actor_name, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return err(mapReadError(error, 'Ticket history'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind) as TicketEventKind,
        fromValue: str(r.from_value),
        toValue: str(r.to_value),
        actorName: str(r.actor_name),
        createdAt: String(r.created_at),
      })),
    )
  })

// Attachments --------------------------------------------------------------------------------------
export const TICKET_STORE: FileStore = {
  bucket: BUCKET,
  table: 'ticket_attachments',
  parentColumn: 'ticket_id',
  rules: TICKET_FILES,
}

export const listAttachments = (
  ticketId: string,
  client?: DbClient,
): Promise<Result<TicketAttachment[]>> => listFiles(TICKET_STORE, ticketId, client)

/** Uploads to private storage, then records it on the ticket (see storageFiles.uploadFile). */
export const uploadAttachment = (
  ticket: { id: string; businessId: string },
  file: File,
  deps: { client?: DbClient; storage?: StorageApi } = {},
) => uploadFile(TICKET_STORE, ticket, file, deps)

/** Private links to the files, valid for an hour, keyed by storage path. */
export const attachmentUrls = (paths: string[], storage?: StorageApi) =>
  signedUrls(BUCKET, paths, storage)

// Assigning ----------------------------------------------------------------------------------------
export const getWorkload = (client?: DbClient) =>
  guarded<WorkloadRow[]>('Team', client, async (c) => {
    const { data, error } = await c
      .from('ticket_workload')
      .select('id, full_name, active_tickets, urgent_tickets')
      .order('active_tickets')
      .order('full_name')
    if (error) return err(mapReadError(error, 'Team'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        name: str(r.full_name) || 'Unnamed',
        activeTickets: num(r.active_tickets),
        urgentTickets: num(r.urgent_tickets),
      })),
    )
  })

/** Properties with their meters; without a customer, whatever the person may see (a client's own). */
export const getTicketAssets = (customerId: string | null, client?: DbClient) =>
  guarded<TicketAsset[]>('Properties', client, async (c) => {
    let q = c.from('properties').select('id, name, address, electricity_meters(id, serial_number)')
    if (customerId) q = q.eq('customer_id', customerId)
    const { data, error } = await q.order('name').limit(200)
    if (error) return err(mapReadError(error, 'Properties'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        name: str(r.name) ?? String(r.address),
        meters: ((r.electricity_meters ?? []) as Row[]).map((m) => ({
          id: String(m.id),
          serialNumber: String(m.serial_number),
        })),
      })),
    )
  })
