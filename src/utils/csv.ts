export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<R> {
  label: string
  value: (row: R) => CsvValue
}

/**
 * A cell a spreadsheet would read as a formula (=, +, -, @, or a tab/return first) is prefixed with
 * an apostrophe, so a customer named "=HYPERLINK(…)" stays text. Numbers are written as numbers.
 */
function cell(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV with Windows line endings, which Excel and Google Sheets both open cleanly. */
export function toCsv<R>(columns: CsvColumn<R>[], rows: R[]): string {
  const lines = [columns.map((c) => cell(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Saves a file in the browser. The byte-order mark makes Excel read the CSV as UTF-8. */
export function downloadFile(name: string, content: BlobPart, type: string) {
  const parts: BlobPart[] = type.startsWith('text/csv') ? ['﻿', content] : [content]
  const url = URL.createObjectURL(new Blob(parts, { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** "Customer report 2024-03-01 to 2024-03-31" → "customer-report-2024-03-01-to-2024-03-31". */
export const fileSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
