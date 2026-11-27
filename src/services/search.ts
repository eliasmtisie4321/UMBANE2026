import { guarded, mapReadError, type DbClient } from './db'
import { err, ok } from '@/utils/result'

export type SearchKind =
  | 'customer'
  | 'property'
  | 'meter'
  | 'lead'
  | 'order'
  | 'invoice'
  | 'ticket'
  | 'product'
  | 'task'
  | 'person'

export interface SearchResult {
  kind: SearchKind
  id: string
  title: string
  subtitle: string | null
  /** The page that opens it. */
  link: string
}

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  customer: 'Customers',
  property: 'Properties',
  meter: 'Meters',
  lead: 'Leads',
  order: 'Sales orders',
  invoice: 'Invoices',
  ticket: 'Support tickets',
  product: 'Products',
  task: 'Tasks',
  person: 'Team',
}

/** The order groups are shown in. */
export const SEARCH_KINDS = Object.keys(SEARCH_KIND_LABEL) as SearchKind[]

type Row = Record<string, unknown>

/**
 * Searches every module at once (the database's search_everything). It runs as the signed-in
 * person, so row security decides what can be found; at most five results of each kind.
 */
export const searchEverything = (query: string, client?: DbClient) =>
  guarded<SearchResult[]>('Search', client, async (c) => {
    const q = query.trim()
    if (q.length < 2) return ok([])
    const { data, error } = await c.rpc('search_everything', { p_query: q })
    if (error) return err(mapReadError(error, 'Search'))
    return ok(
      ((data ?? []) as Row[])
        .filter(
          (r) => SEARCH_KINDS.includes(String(r.kind) as SearchKind) && typeof r.link === 'string',
        )
        .map((r) => ({
          kind: String(r.kind) as SearchKind,
          id: String(r.id),
          title: String(r.title ?? ''),
          subtitle: typeof r.subtitle === 'string' && r.subtitle ? r.subtitle : null,
          link: String(r.link),
        })),
    )
  })
