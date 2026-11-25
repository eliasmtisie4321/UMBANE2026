/**
 * List screens keep their state (search, filters, sort, page) in the URL, so a reload, the back
 * button and a shared link all show the same list. These helpers read and write it defensively:
 * anything unrecognised falls back to a default instead of reaching a query.
 */

export const PAGE_SIZE = 25

export function readPage(params: URLSearchParams): number {
  const n = Number(params.get('page'))
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1
}

export function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | '' {
  const v = params.get(key)
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : ''
}

export function readSort<S extends string>(
  params: URLSearchParams,
  allowed: readonly S[],
  fallback: S,
  fallbackAscending = true,
): { sort: S; ascending: boolean } {
  const sort = params.get('sort')
  if (sort === null || !(allowed as readonly string[]).includes(sort)) {
    return { sort: fallback, ascending: fallbackAscending }
  }
  return { sort: sort as S, ascending: params.get('dir') !== 'desc' }
}

/** Returns new params with `patch` applied. Empty values are removed; the page resets unless set. */
export function patchParams(
  params: URLSearchParams,
  patch: Record<string, string | number | undefined>,
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '' || (key === 'page' && value === 1)) next.delete(key)
    else next.set(key, String(value))
  }
  if (!('page' in patch)) next.delete('page')
  return next
}

/** Clicking a column: sort by it ascending, or flip direction if it is already the sort column. */
export function nextSort<S extends string>(
  current: { sort: S; ascending: boolean },
  column: S,
): { sort: S; dir: 'asc' | 'desc' } {
  if (current.sort === column) return { sort: column, dir: current.ascending ? 'desc' : 'asc' }
  return { sort: column, dir: 'asc' }
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
