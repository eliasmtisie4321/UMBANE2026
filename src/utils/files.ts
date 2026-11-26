/** Attachment rules shared by tickets and tasks. The storage buckets accept exactly these types. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024

export interface FileRules {
  /** Accepted extensions and the type each is stored as. */
  types: Record<string, string>
  accept: string
  hint: string
  maxFiles: number
}

const rules = (types: Record<string, string>, hint: string, maxFiles: number): FileRules => ({
  types,
  accept: Object.keys(types)
    .map((e) => `.${e}`)
    .join(','),
  hint,
  maxFiles,
})

const PHOTOS_AND_PDF = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

/**
 * The type is decided from the name, not the browser, because some systems report CSV files as
 * spreadsheets.
 */
export const TICKET_FILES = rules(
  { ...PHOTOS_AND_PDF, csv: 'text/csv', txt: 'text/plain' },
  'Photos (JPG, PNG, WebP), PDF, CSV or text files, up to 10 MB each.',
  20,
)
export const TASK_FILES = rules(
  PHOTOS_AND_PDF,
  'Photos (JPG, PNG, WebP) or PDF, up to 10 MB each.',
  20,
)

export const fileTypeOf = (name: string, r: FileRules = TICKET_FILES): string | null =>
  r.types[name.split('.').pop()?.toLowerCase() ?? ''] ?? null

export const isImage = (contentType: string) => contentType.startsWith('image/')

/** A storage-safe name: letters, numbers, dots, dashes and underscores, at most 80 characters. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const rawExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ''
  const base = (ext ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 70)
  return `${base || 'file'}${ext ? `.${ext}` : ''}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface FileCheck {
  accepted: File[]
  problems: string[]
}

/** Keeps the files that can be attached and explains each one that cannot. */
export function checkFiles(
  files: File[],
  alreadyAttached: number,
  r: FileRules = TICKET_FILES,
): FileCheck {
  const accepted: File[] = []
  const problems: string[] = []
  for (const f of files) {
    if (!fileTypeOf(f.name, r)) problems.push(`${f.name}: this type of file cannot be attached.`)
    else if (f.size === 0) problems.push(`${f.name}: the file is empty.`)
    else if (f.size > FILE_MAX_BYTES) problems.push(`${f.name}: larger than 10 MB.`)
    else if (alreadyAttached + accepted.length >= r.maxFiles)
      problems.push(`${f.name}: at most ${r.maxFiles} files can be attached.`)
    else accepted.push(f)
  }
  return { accepted, problems }
}
