import {
  labelOf,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketEvent,
  type TicketInput,
  type TicketPriority,
  type TicketStatus,
} from '@/types/support'

// Limits mirrored from migration 20261126000010; the database enforces them.
export const SUBJECT_MAX = 150
export const TEXT_MAX = 5000
export const RESOLUTION_MAX = 2000
export const FILE_MAX_BYTES = 10 * 1024 * 1024
export const FILES_PER_TICKET = 20

/**
 * Accepted files by extension. The type is decided from the name, not the browser, because some
 * systems report CSV files as spreadsheets; the storage bucket accepts exactly these types.
 */
const FILE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
}
export const FILE_ACCEPT = Object.keys(FILE_TYPES)
  .map((e) => `.${e}`)
  .join(',')
export const FILE_HINT = 'Photos (JPG, PNG, WebP), PDF, CSV or text files, up to 10 MB each.'

export const fileTypeOf = (name: string): string | null =>
  FILE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? null

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
export function checkFiles(files: File[], alreadyAttached: number): FileCheck {
  const accepted: File[] = []
  const problems: string[] = []
  for (const f of files) {
    if (!fileTypeOf(f.name)) problems.push(`${f.name}: this type of file cannot be attached.`)
    else if (f.size === 0) problems.push(`${f.name}: the file is empty.`)
    else if (f.size > FILE_MAX_BYTES) problems.push(`${f.name}: larger than 10 MB.`)
    else if (alreadyAttached + accepted.length >= FILES_PER_TICKET)
      problems.push(`${f.name}: a ticket can have at most ${FILES_PER_TICKET} files.`)
    else accepted.push(f)
  }
  return { accepted, problems }
}

export interface TicketFormValues {
  customerId: string
  subject: string
  description: string
  category: TicketCategory | ''
  propertyId: string
  meterId: string
  priority: TicketPriority
  assignedTo: string
}

export const emptyTicketForm: TicketFormValues = {
  customerId: '',
  subject: '',
  description: '',
  category: '',
  propertyId: '',
  meterId: '',
  priority: 'normal',
  assignedTo: '',
}

export type TicketFormErrors = Partial<Record<keyof TicketFormValues, string>>

export function validateTicketForm(
  v: TicketFormValues,
  options: { needsCustomer: boolean },
): TicketFormErrors {
  const e: TicketFormErrors = {}
  if (options.needsCustomer && !v.customerId) e.customerId = 'Choose the customer.'
  if (!v.subject.trim()) e.subject = 'Give the ticket a short title.'
  else if (v.subject.trim().length > SUBJECT_MAX)
    e.subject = `Keep the title to ${SUBJECT_MAX} characters.`
  if (!v.category) e.category = 'Choose what the problem is about.'
  if (!v.description.trim()) e.description = 'Describe the problem.'
  else if (v.description.trim().length > TEXT_MAX)
    e.description = `Keep the description to ${TEXT_MAX} characters.`
  return e
}

export const toTicketInput = (v: TicketFormValues, isStaff: boolean): TicketInput => ({
  customerId: isStaff ? v.customerId : null,
  subject: v.subject.trim(),
  description: v.description.trim(),
  category: v.category || 'general',
  propertyId: v.propertyId || null,
  meterId: v.meterId || null,
  ...(isStaff ? { priority: v.priority, assignedTo: v.assignedTo || null } : {}),
})

export function validateMessage(body: string): string | null {
  if (!body.trim()) return 'Write a message first.'
  if (body.trim().length > TEXT_MAX) return `Keep the message to ${TEXT_MAX} characters.`
  return null
}

/** The statuses a person can choose next. Assignment moves Open and Assigned by itself. */
export function nextStatuses(current: TicketStatus, hasAssignee: boolean): TicketStatus[] {
  if (current === 'closed') return []
  const all: TicketStatus[] = hasAssignee
    ? ['assigned', 'in_progress', 'resolved', 'closed']
    : ['open', 'resolved', 'closed']
  return all.filter((s) => s !== current)
}

export const needsResolution = (s: TicketStatus) => s === 'resolved' || s === 'closed'

export function validateResolution(status: TicketStatus, text: string): string | null {
  if (!needsResolution(status)) return null
  if (!text.trim()) return 'Say what was done, or why the ticket is closed.'
  if (text.trim().length > RESOLUTION_MAX) return `Keep this to ${RESOLUTION_MAX} characters.`
  return null
}

/** What happened, newest first, in words. */
export function describeEvent(e: TicketEvent): string {
  switch (e.kind) {
    case 'created':
      return 'Ticket opened'
    case 'status':
      return `Status changed to ${labelOf(TICKET_STATUSES, e.toValue)}`
    case 'assigned':
      return e.toValue ? `Assigned to ${e.toValue}` : 'Unassigned'
    case 'priority':
      return `Priority changed from ${labelOf(TICKET_PRIORITIES, e.fromValue)} to ${labelOf(TICKET_PRIORITIES, e.toValue)}`
    case 'attachment':
      return `File attached: ${e.toValue ?? ''}`
  }
}
