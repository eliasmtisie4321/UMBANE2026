const MAX_LENGTH = 100

/**
 * Makes free text safe to embed in a PostgREST filter string. Search text becomes part of
 * `or=(col.ilike.*text*,...)`, where commas, parentheses and quotes are filter syntax, so anything
 * that is not an ordinary letter, digit, space or common email/name punctuation is dropped.
 */
export function sanitizeSearch(input: string): string {
  return input
    .replace(/[^\p{L}\p{N} @.+\-_'/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH)
}

/** `or(...)` filter matching the text against any of the columns, or null for an empty search. */
export function orIlike(columns: string[], input: string): string | null {
  const text = sanitizeSearch(input)
  if (!text) return null
  return columns.map((c) => `${c}.ilike.*${text}*`).join(',')
}

/**
 * Phone numbers are stored in international form (+27824419082) but people type 082 441 9082, so a
 * phone search matches on the digits after the country/trunk prefix. Null if too short to be useful.
 */
export function phoneIlike(column: string, input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length < 3) return null
  if (digits.startsWith('0')) digits = digits.slice(1)
  else if (digits.startsWith('27') && digits.length > 4) digits = digits.slice(2)
  return `${column}.ilike.*${digits}*`
}
