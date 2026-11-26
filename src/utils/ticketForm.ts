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
import { TICKET_FILES } from './files'

// Limits mirrored from migration 20261126000010; the database enforces them.
export const SUBJECT_MAX = 150
export const TEXT_MAX = 5000
export const RESOLUTION_MAX = 2000

export {
  checkFiles,
  FILE_MAX_BYTES,
  fileTypeOf,
  formatBytes,
  isImage,
  safeFileName,
  type FileCheck,
} from './files'
export const FILES_PER_TICKET = TICKET_FILES.maxFiles
export const FILE_ACCEPT = TICKET_FILES.accept
export const FILE_HINT = TICKET_FILES.hint

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
