import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listEvents,
  removeEvent,
  upsertEvent,
  type CalendarEventInput,
} from './_lib/integrations/calendar.js'
import { encryptionKey } from './_lib/integrations/crypto.js'
import { adapterFor } from './_lib/integrations/registry.js'
import {
  freshCredentials,
  loadSecrets,
  markError,
  type IntegrationRow,
} from './_lib/integrations/store.js'
import type { Credentials } from './_lib/integrations/types.js'
import {
  adapterContext,
  adminClient,
  json,
  RATE_LIMITS,
  readEnv,
  staffCaller,
  tooManyRequests,
  withinRateLimit,
  type ServerEnv,
  type StaffCaller,
} from './_lib/server.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1000

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
}

interface EventRow {
  id: string
  business_id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  owner_id: string
  assigned_to: string | null
  google_event_id: string | null
  google_calendar_owner: string | null
}

type Ready = { row: IntegrationRow; credentials: Credentials }

/** A person's own Google Calendar connection, ready to use; or why not. */
async function calendarOf(
  db: SupabaseClient,
  env: ServerEnv,
  businessId: string,
  profileId: string,
): Promise<Ready | { missing: true; account: string | null; error: string | null }> {
  const key = encryptionKey(env.integrationsKey)
  const { data } = await db
    .from('integrations')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', 'google_calendar')
    .eq('profile_id', profileId)
    .neq('status', 'disconnected')
    .limit(1)
  const row = ((data ?? []) as IntegrationRow[])[0]
  if (!row) return { missing: true, account: null, error: null }
  if (row.status !== 'connected' || !key) {
    return {
      missing: true,
      account: row.account_label,
      error: row.last_error ?? 'Connect Google Calendar again.',
    }
  }
  const adapter = adapterFor('google_calendar')!
  try {
    const stored = await loadSecrets(db, row, key)
    const credentials = await freshCredentials(db, adapter, row, stored, key, adapterContext(env))
    if (!credentials)
      return {
        missing: true,
        account: row.account_label,
        error: 'The Google sign-in has expired. Connect again.',
      }
    return { row, credentials }
  } catch (e) {
    await markError(db, row.id, (e as Error).message)
    return { missing: true, account: row.account_label, error: (e as Error).message }
  }
}

const mayChange = (caller: StaffCaller, e: EventRow) =>
  e.owner_id === caller.id ||
  e.assigned_to === caller.id ||
  caller.role === 'administrator' ||
  caller.role === 'manager'

const toInput = (e: EventRow): CalendarEventInput => ({
  umbaneId: e.id,
  title: e.title,
  description: e.description,
  location: e.location,
  startsAt: e.starts_at,
  endsAt: e.ends_at,
  allDay: e.all_day,
})

/**
 * GET  /api/calendar?from=…&to=…   the caller's own Google Calendar events in that period
 * POST /api/calendar { action, eventId }
 *   push    adds the Umbane event to the caller's Google Calendar, or updates the copy that is
 *           already in someone's calendar
 *   remove  takes the copy out of Google Calendar
 *   delete  deletes the Umbane event and its Google copy
 * Signed-in team members only; an event may be changed by its organiser, the person it is for, or a
 * manager. Google events are read live and never stored in Umbane.
 */
export function createCalendarHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    const { env } = deps
    if (!env.supabaseUrl || !env.serviceKey) return json({ error: 'not_configured' }, 503)
    const db = deps.admin()
    const caller = await staffCaller(db, request)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!(await withinRateLimit(db, 'calendar:' + caller.id, RATE_LIMITS.calendar)))
      return tooManyRequests()
    const ctx = adapterContext(env)

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const from = new Date(url.searchParams.get('from') ?? '')
      const to = new Date(url.searchParams.get('to') ?? '')
      if (
        isNaN(from.getTime()) ||
        isNaN(to.getTime()) ||
        to <= from ||
        to.getTime() - from.getTime() > MAX_RANGE_MS
      ) {
        return json({ error: 'bad_request' }, 400)
      }
      const mine = await calendarOf(db, env, caller.businessId, caller.id)
      if ('missing' in mine)
        return json({ connected: false, account: mine.account, error: mine.error, events: [] })
      const listed = await listEvents(mine.credentials, from.toISOString(), to.toISOString(), ctx)
      if (!listed.ok) {
        if (listed.status === 401 || listed.status === 403)
          await markError(db, mine.row.id, listed.error)
        return json({
          connected: true,
          account: mine.row.account_label,
          error: listed.error,
          events: [],
        })
      }
      return json({
        connected: true,
        account: mine.row.account_label,
        error: null,
        events: listed.value,
      })
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    let body: { action?: unknown; eventId?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    const action = String(body.action ?? '')
    const eventId = String(body.eventId ?? '')
    if (!UUID.test(eventId) || !['push', 'remove', 'delete'].includes(action))
      return json({ error: 'bad_request' }, 400)

    const found = await db.from('calendar_events').select('*').eq('id', eventId).maybeSingle()
    const event = found.data as EventRow | null
    if (found.error || !event || event.business_id !== caller.businessId)
      return json({ error: 'not_found' }, 404)
    if (!mayChange(caller, event)) return json({ error: 'forbidden' }, 403)

    // The copy lives in one person's calendar: whoever added it first (or the caller, to add it now).
    const holder = event.google_calendar_owner ?? (action === 'push' ? caller.id : null)
    const calendar = holder ? await calendarOf(db, env, caller.businessId, holder) : null
    const record = (fields: Record<string, unknown>) =>
      db.from('calendar_events').update(fields).eq('id', eventId)

    if (action === 'push') {
      if (!calendar || 'missing' in calendar) {
        const yours = holder === caller.id
        return json(
          {
            error: 'not_connected',
            message: yours
              ? 'Connect your Google Calendar first (Calendar → Connect Google Calendar).'
              : 'The person whose Google Calendar has this event has disconnected it.',
          },
          409,
        )
      }
      const r = await upsertEvent(calendar.credentials, toInput(event), ctx)
      if (!r.ok) {
        await record({ google_error: r.error })
        return json({ error: 'google', message: r.error }, 502)
      }
      await record({
        google_event_id: r.value.id,
        google_calendar_owner: holder,
        google_html_link: r.value.htmlLink,
        google_synced_at: new Date().toISOString(),
        google_error: null,
      })
      return json({ synced: true, htmlLink: r.value.htmlLink })
    }

    // remove and delete: take the copy out first, so it never stays behind in someone's calendar.
    let left = false
    if (event.google_event_id) {
      if (calendar && !('missing' in calendar)) {
        const r = await removeEvent(calendar.credentials, event.google_event_id, ctx)
        if (!r.ok) {
          if (action === 'remove') return json({ error: 'google', message: r.error }, 502)
          left = true
        }
      } else {
        if (action === 'remove') {
          return json(
            {
              error: 'not_connected',
              message: 'The Google Calendar that has this event is not connected.',
            },
            409,
          )
        }
        left = true
      }
    }
    if (action === 'remove') {
      await record({
        google_event_id: null,
        google_calendar_owner: null,
        google_html_link: null,
        google_synced_at: null,
        google_error: null,
      })
      return json({ removed: true })
    }
    const deleted = await db.from('calendar_events').delete().eq('id', eventId)
    if (deleted.error) return json({ error: 'not_deleted' }, 500)
    return json({ deleted: true, googleCopyLeft: left })
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createCalendarHandler({ env, admin: () => adminClient(env) })(request)
}

export function POST(request: Request) {
  const env = readEnv()
  return createCalendarHandler({ env, admin: () => adminClient(env) })(request)
}
