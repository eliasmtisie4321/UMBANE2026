export const TICKET_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]['value']

export const TICKET_PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]['value']

export const TICKET_CATEGORIES = [
  { value: 'meter_fault', label: 'Meter fault' },
  { value: 'prepaid_token', label: 'Prepaid token' },
  { value: 'billing', label: 'Billing' },
  { value: 'telemetry', label: 'Telemetry' },
  { value: 'installation', label: 'Installation' },
  { value: 'general', label: 'General question' },
] as const
/** The standard categories; each business manages its own list (Settings → Categories). */
export type TicketCategory = string

export const labelOf = (
  list: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string => list.find((i) => i.value === value)?.label ?? value ?? ''

export const isOpenStatus = (s: TicketStatus) =>
  s === 'open' || s === 'assigned' || s === 'in_progress'

export type TicketSort = 'created_at' | 'last_activity_at' | 'customer_name' | 'subject'

export interface TicketListItem {
  id: string
  reference: string
  subject: string
  category: TicketCategory
  status: TicketStatus
  priority: TicketPriority
  customerId: string
  customerName: string
  propertyName: string | null
  assignedTo: string | null
  /** Null for clients, who cannot read staff profiles. */
  assigneeName: string | null
  createdAt: string
  lastActivityAt: string
  messageCount: number
  attachmentCount: number
}

export interface Ticket extends TicketListItem {
  description: string | null
  propertyId: string | null
  propertyAddress: string | null
  meterId: string | null
  meterSerial: string | null
  customerPhone: string | null
  customerEmail: string | null
  resolution: string | null
  assignedAt: string | null
  statusChangedAt: string
  firstResponseAt: string | null
  resolvedAt: string | null
  closedAt: string | null
}

export interface TicketCounts {
  total: number
  open: number
  assigned: number
  inProgress: number
  resolved: number
  closed: number
  urgentOpen: number
}

export interface TicketMessage {
  id: string
  body: string
  isInternal: boolean
  fromStaff: boolean
  authorName: string | null
  createdAt: string
}

export type TicketEventKind = 'created' | 'status' | 'assigned' | 'priority' | 'attachment'

export interface TicketEvent {
  id: string
  kind: TicketEventKind
  fromValue: string | null
  toValue: string | null
  actorName: string | null
  createdAt: string
}

export interface TicketAttachment {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  uploaderName: string | null
  createdAt: string
}

export interface WorkloadRow {
  id: string
  name: string
  activeTickets: number
  urgentTickets: number
}

/** A customer's properties with their meters, for linking a ticket. */
export interface TicketAsset {
  id: string
  name: string
  meters: { id: string; serialNumber: string }[]
}

export interface TicketInput {
  /** Staff choose the customer; a client's ticket is always their own (null). */
  customerId: string | null
  subject: string
  description: string
  category: TicketCategory
  propertyId: string | null
  meterId: string | null
  /** Staff only; ignored by the database for clients. */
  priority?: TicketPriority
  assignedTo?: string | null
}

export type TicketDetailsInput = Omit<TicketInput, 'customerId' | 'assignedTo'>
