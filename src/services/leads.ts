import type { ListQuery, Page } from '@/types/customers'
import type {
  Lead,
  LeadInput,
  LeadMatch,
  LeadSort,
  LeadSource,
  LeadStage,
  LeadStageTotal,
  LeadStatus,
} from '@/types/sales'
import { err, ok } from '@/utils/result'
import { orIlike, phoneIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

const NOT_UPDATED = {
  code: 'not_found' as const,
  message:
    'This lead could not be updated. It may have been removed, or you may not have permission.',
}

const fromRow = (r: Row): Lead => ({
  id: String(r.id),
  reference: String(r.reference),
  name: String(r.name),
  companyName: str(r.company_name),
  email: str(r.email),
  phone: str(r.phone),
  source: str(r.source) as LeadSource | null,
  serviceInterest: str(r.service_interest),
  status: String(r.status) as LeadStatus,
  estimatedValue: numOrNull(r.estimated_value),
  expectedClose: str(r.expected_close),
  followUpOn: str(r.follow_up_on),
  followUpOverdue: Boolean(r.follow_up_overdue),
  assignedTo: str(r.assigned_to),
  assignedName: str(r.assigned_name),
  notes: str(r.notes),
  lostReason: str(r.lost_reason),
  closedOn: str(r.closed_on),
  customerId: str(r.converted_customer_id),
  customerName: str(r.customer_name),
  createdAt: String(r.created_at),
  isOpen: Boolean(r.is_open),
})

const toRow = (i: LeadInput) => ({
  name: i.name,
  company_name: i.companyName,
  email: i.email,
  phone: i.phone,
  source: i.source,
  service_interest: i.serviceInterest,
  estimated_value: i.estimatedValue,
  expected_close: i.expectedClose,
  follow_up_on: i.followUpOn,
  assigned_to: i.assignedTo,
  notes: i.notes,
  ...(i.stage === null ? {} : { status: i.stage }),
})

export interface LeadFilters {
  /** "open" = every stage before converted or lost. */
  status: LeadStatus | 'open' | 'all'
  source: LeadSource | ''
  assignedTo: string
}

export const listLeads = (query: ListQuery<LeadSort>, filters: LeadFilters, client?: DbClient) =>
  guarded<Page<Lead>>('Leads', client, async (c) => {
    let q = c.from('lead_list').select('*', { count: 'exact' })
    if (filters.status === 'open') q = q.eq('is_open', true)
    else if (filters.status !== 'all') q = q.eq('status', filters.status)
    if (filters.source) q = q.eq('source', filters.source)
    if (filters.assignedTo) q = q.eq('assigned_to', filters.assignedTo)
    const or = [
      orIlike(['name', 'company_name', 'email', 'reference', 'service_interest'], query.search),
      phoneIlike('phone', query.search),
    ]
      .filter(Boolean)
      .join(',')
    if (or) q = q.or(or)

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('number', { ascending: false })
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Leads'))
    return ok({ total: count ?? 0, rows: (data ?? []).map(fromRow) })
  })

export const getLeadTotals = (client?: DbClient) =>
  guarded<LeadStageTotal[]>('Lead totals', client, async (c) => {
    const { data, error } = await c.from('lead_summary').select('status, lead_count, total_value')
    if (error) return err(mapReadError(error, 'Lead totals'))
    return ok(
      (data ?? []).map((r: Row) => ({
        status: String(r.status) as LeadStatus,
        count: num(r.lead_count),
        value: num(r.total_value),
      })),
    )
  })

export const getLead = (id: string, client?: DbClient) =>
  guarded<Lead>('Lead', client, async (c) => {
    const { data, error } = await c.from('lead_list').select('*').eq('id', id).maybeSingle()
    // 22P02: the id in the address is not a UUID at all.
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Lead'))
    if (!data) return err({ code: 'not_found', message: 'This lead could not be found.' })
    return ok(fromRow(data as Row))
  })

export const createLead = (input: LeadInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'lead',
    client,
    async (c) => {
      const { data, error } = await c.from('leads').insert(toRow(input)).select('id').single()
      if (error) return err(mapWriteError(error, 'lead'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

const patchLead = (id: string, patch: Record<string, unknown>, client?: DbClient) =>
  guarded<{ id: string }>(
    'lead',
    client,
    async (c) => {
      const { data, error } = await c.from('leads').update(patch).eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'lead'))
      return data && data.length > 0 ? ok({ id }) : err(NOT_UPDATED)
    },
    mapWriteError,
  )

export const updateLead = (id: string, input: LeadInput, client?: DbClient) =>
  patchLead(id, toRow(input), client)

/** Also reopens a lost lead. */
export const setLeadStage = (id: string, stage: LeadStage, client?: DbClient) =>
  patchLead(id, { status: stage }, client)

export const loseLead = (id: string, reason: string, client?: DbClient) =>
  patchLead(id, { status: 'lost', lost_reason: reason }, client)

/** Existing customers this lead may already be. */
export const getLeadMatches = (id: string, client?: DbClient) =>
  guarded<LeadMatch[]>('Matching customers', client, async (c) => {
    const { data, error } = await c.rpc('lead_matches', { p_lead_id: id })
    if (error) return err(mapReadError(error, 'Matching customers'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        companyName: str(r.company_name),
        email: str(r.email),
        phone: str(r.phone),
        matchedOn: String(r.matched_on) as LeadMatch['matchedOn'],
      })),
    )
  })

/** Links an existing customer, or creates one when `customerId` is null. */
export const convertLead = (
  id: string,
  customerId: string | null,
  createAnyway: boolean,
  client?: DbClient,
) =>
  guarded<{ customerId: string }>(
    'lead',
    client,
    async (c) => {
      const { data, error } = await c.rpc('convert_lead', {
        p_lead_id: id,
        p_customer_id: customerId,
        p_create_anyway: createAnyway,
      })
      if (error) return err(mapWriteError(error, 'lead'))
      return ok({ customerId: String(data) })
    },
    mapWriteError,
  )
