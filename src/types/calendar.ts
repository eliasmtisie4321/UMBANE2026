/** Where a calendar item comes from. */
export type CalendarSource = 'event' | 'task' | 'maintenance' | 'invoice' | 'google'

export const SOURCE_LABEL: Record<CalendarSource, string> = {
  event: 'Appointment',
  task: 'Task due',
  maintenance: 'Maintenance',
  invoice: 'Invoice due',
  google: 'Google Calendar',
}

export type EventKind =
  'appointment' | 'site_visit' | 'installation' | 'meeting' | 'reminder' | 'other'

export const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'site_visit', label: 'Site visit' },
  { value: 'installation', label: 'Installation' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'other', label: 'Other' },
]

/** One thing on the calendar, from any source. */
export interface CalendarItem {
  /** Unique across sources. */
  key: string
  source: CalendarSource
  id: string
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  kind: string | null
  /** The page that opens it (none for Google events, which open in Google). */
  link: string | null
  detail: string | null
  assignedTo: string | null
  assignedName: string | null
  ownerId: string | null
  customerId: string | null
  customerName: string | null
  location: string | null
  description: string | null
  googleEventId: string | null
  googleCalendarOwner: string | null
  googleHtmlLink: string | null
  googleError: string | null
}

export interface CalendarEventInput {
  title: string
  kind: EventKind
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string | null
  description: string | null
  customerId: string | null
  assignedTo: string | null
}

/** The person's own Google Calendar connection, as far as the calendar is concerned. */
export interface GoogleCalendarStatus {
  connected: boolean
  account: string | null
  error: string | null
}

export interface CalendarData {
  items: CalendarItem[]
  google: GoogleCalendarStatus
}
