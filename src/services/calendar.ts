import { guarded, mapReadError, mapWriteError, type DbClient } from './db'
import type { ServerApi } from './messages'
import { getSupabase } from './supabase'
import type { Result } from '@/types/api'
import type {
  CalendarData,
  CalendarEventInput,
  CalendarItem,
  CalendarSource,
  GoogleCalendarStatus,
} from '@/types/calendar'
import { err, ok } from '@/utils/result'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

const fromFeed = (r: Row): CalendarItem => ({
  key: `${String(r.source)}:${String(r.id)}`,
  source: String(r.source) as CalendarSource,
  id: String(r.id),
  title: String(r.title ?? ''),
  startsAt: String(r.starts_at),
  endsAt: String(r.ends_at),
  allDay: Boolean(r.all_day),
  kind: str(r.kind),
  link: str(r.link),
  detail: str(r.detail),
  assignedTo: str(r.assigned_to),
  assignedName: str(r.assigned_name),
  ownerId: str(r.owner_id),
  customerId: str(r.customer_id),
  customerName: str(r.customer_name),
  location: str(r.location),
  description: str(r.description),
  googleEventId: str(r.google_event_id),
  googleCalendarOwner: str(r.google_calendar_owner),
  googleHtmlLink: str(r.google_html_link),
  googleError: str(r.google_error),
})

/** Everything dated in Umbane for the period: appointments, tasks, maintenance, invoice due dates. */
export const getCalendarFeed = (from: string, to: string, client?: DbClient) =>
  guarded<CalendarItem[]>('Calendar', client, async (c) => {
    const { data, error } = await c.rpc('calendar_feed', { p_from: from, p_to: to })
    if (error) return err(mapReadError(error, 'Calendar'))
    return ok(((data ?? []) as Row[]).map(fromFeed))
  })

const defaultServer = (): ServerApi => ({
  token: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init),
})

async function callServer(
  init: { method: 'GET' | 'POST'; query?: string; body?: unknown },
  server: ServerApi,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null> {
  try {
    const token = await server.token()
    if (!token) return null
    const res = await server.fetch(`/api/calendar${init.query ? `?${init.query}` : ''}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    })
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null
    return { ok: res.ok, status: res.status, body: (await res.json()) as Record<string, unknown> }
  } catch {
    return null
  }
}

/** The person's own Google Calendar events for the period, read live (never stored in Umbane). */
export async function getGoogleEvents(
  from: string,
  to: string,
  server: ServerApi = defaultServer(),
): Promise<{ status: GoogleCalendarStatus; items: CalendarItem[] }> {
  const r = await callServer(
    { method: 'GET', query: new URLSearchParams({ from, to }).toString() },
    server,
  )
  if (!r || !r.ok) return { status: { connected: false, account: null, error: null }, items: [] }
  const events = Array.isArray(r.body.events) ? (r.body.events as Row[]) : []
  return {
    status: {
      connected: Boolean(r.body.connected),
      account: str(r.body.account),
      error: str(r.body.error),
    },
    items: events.map((e) => ({
      key: `google:${String(e.id)}`,
      source: 'google' as const,
      id: String(e.id),
      title: String(e.title ?? ''),
      startsAt: String(e.startsAt),
      endsAt: String(e.endsAt),
      allDay: Boolean(e.allDay),
      kind: null,
      link: null,
      detail: null,
      assignedTo: null,
      assignedName: null,
      ownerId: null,
      customerId: null,
      customerName: null,
      location: str(e.location),
      description: null,
      googleEventId: String(e.id),
      googleCalendarOwner: null,
      googleHtmlLink: str(e.htmlLink),
      googleError: null,
      // The copy of a Umbane event is shown once, as the Umbane event.
      ...(str(e.umbaneId) ? { detail: `umbane:${str(e.umbaneId)}` } : {}),
    })),
  }
}

/** The calendar for a period: Umbane's items and the person's Google events, without doubles. */
export async function loadCalendar(from: string, to: string): Promise<Result<CalendarData>> {
  const [feed, google] = await Promise.all([getCalendarFeed(from, to), getGoogleEvents(from, to)])
  if (!feed.ok) return feed
  const umbaneIds = new Set(feed.data.filter((i) => i.source === 'event').map((i) => i.id))
  const googleItems = google.items.filter(
    (g) => !(g.detail?.startsWith('umbane:') && umbaneIds.has(g.detail.slice(7))),
  )
  return ok({
    items: [...feed.data, ...googleItems.map((g) => ({ ...g, detail: null }))].sort((a, b) =>
      a.startsAt < b.startsAt
        ? -1
        : a.startsAt > b.startsAt
          ? 1
          : Number(b.allDay) - Number(a.allDay),
    ),
    google: google.status,
  })
}

const toRow = (e: CalendarEventInput) => ({
  title: e.title.trim(),
  kind: e.kind,
  starts_at: e.startsAt,
  ends_at: e.endsAt,
  all_day: e.allDay,
  location: e.location?.trim() || null,
  description: e.description?.trim() || null,
  customer_id: e.customerId,
  assigned_to: e.assignedTo,
})

export const createCalendarEvent = (input: CalendarEventInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'event',
    client,
    async (c) => {
      const { data, error } = await c
        .from('calendar_events')
        .insert(toRow(input))
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'event'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const updateCalendarEvent = (id: string, input: CalendarEventInput, client?: DbClient) =>
  guarded<null>(
    'event',
    client,
    async (c) => {
      const { data, error } = await c
        .from('calendar_events')
        .update(toRow(input))
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'event'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message: 'Only the organiser, the person it is for, or a manager can change this event.',
        })
      }
      return ok(null)
    },
    mapWriteError,
  )

/** Copies the event into the person's Google Calendar, or updates the copy. */
export async function syncToGoogle(
  id: string,
  server: ServerApi = defaultServer(),
): Promise<Result<{ htmlLink: string | null }>> {
  const r = await callServer({ method: 'POST', body: { action: 'push', eventId: id } }, server)
  if (!r)
    return err({
      code: 'network',
      message: 'Google Calendar could not be reached. Please try again.',
    })
  if (!r.ok)
    return err({
      code: 'unknown',
      message: str(r.body.message) ?? 'It could not be added to Google Calendar.',
    })
  return ok({ htmlLink: str(r.body.htmlLink) })
}

export async function removeFromGoogle(
  id: string,
  server: ServerApi = defaultServer(),
): Promise<Result<null>> {
  const r = await callServer({ method: 'POST', body: { action: 'remove', eventId: id } }, server)
  if (!r)
    return err({
      code: 'network',
      message: 'Google Calendar could not be reached. Please try again.',
    })
  if (!r.ok)
    return err({
      code: 'unknown',
      message: str(r.body.message) ?? 'It could not be removed from Google Calendar.',
    })
  return ok(null)
}

/**
 * Deletes the event and its copy in Google Calendar (through the server). If the server cannot be
 * reached, the event is deleted directly and any Google copy stays: the answer says so.
 */
export async function deleteCalendarEvent(
  id: string,
  server: ServerApi = defaultServer(),
  client?: DbClient,
): Promise<Result<{ googleCopyLeft: boolean }>> {
  const r = await callServer({ method: 'POST', body: { action: 'delete', eventId: id } }, server)
  if (r?.ok) return ok({ googleCopyLeft: Boolean(r.body.googleCopyLeft) })
  if (r && r.status === 403) {
    return err({
      code: 'forbidden',
      message: 'Only the organiser, the person it is for, or a manager can delete this event.',
    })
  }
  return guarded<{ googleCopyLeft: boolean }>(
    'event',
    client,
    async (c) => {
      const { data, error } = await c
        .from('calendar_events')
        .delete()
        .eq('id', id)
        .select('google_event_id')
      if (error) return err(mapWriteError(error, 'event'))
      if (!data || data.length === 0)
        return err({ code: 'forbidden', message: 'This event could not be deleted.' })
      return ok({ googleCopyLeft: Boolean((data[0] as Row).google_event_id) })
    },
    mapWriteError,
  )
}

/**
 * The person's own Google Calendar connection, if any. (Administrators can see everyone's, so it is
 * picked out by the person's id.)
 */
export const getCalendarConnection = (profileId: string, client?: DbClient) =>
  guarded<{ id: string; status: string; account: string | null; error: string | null } | null>(
    'Google Calendar',
    client,
    async (c) => {
      const { data, error } = await c
        .from('integrations')
        .select('id, status, account_label, last_error, profile_id')
        .eq('provider', 'google_calendar')
        .eq('profile_id', profileId)
        .neq('status', 'disconnected')
      if (error) return err(mapReadError(error, 'Google Calendar'))
      const own = ((data ?? []) as Row[])[0]
      return ok(
        own
          ? {
              id: String(own.id),
              status: String(own.status),
              account: str(own.account_label),
              error: str(own.last_error),
            }
          : null,
      )
    },
  )
