import { google } from './email.js'
import { call, form, str } from './http.js'
import type { Adapter, AdapterContext, Credentials } from './types.js'

/**
 * Google Calendar, as each person's own connection: read their events to show beside Umbane's,
 * and keep a copy of Umbane appointments in their calendar. Uses the same Google app as Gmail;
 * only the permission asked for differs.
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const SA_OFFSET_MS = 2 * 60 * 60 * 1000 // South Africa: UTC+2 all year, no daylight saving

/** A Umbane event as Google needs it. */
export interface CalendarEventInput {
  umbaneId: string
  title: string
  description: string | null
  location: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
}

/** An event from the person's Google Calendar, as the Calendar page shows it. */
export interface GoogleEvent {
  id: string
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string | null
  htmlLink: string | null
  /** Set when this is the copy of a Umbane event. */
  umbaneId: string | null
}

export type CalendarResult<T> =
  { ok: true; value: T } | { ok: false; status: number; error: string }

/**
 * The Google event id for a Umbane event. Fixed, so trying again after an uncertain failure finds
 * the same event instead of making a second one. Google allows the letters a–v and digits.
 */
export const googleEventId = (umbaneId: string) => `umb${umbaneId.replace(/-/g, '').toLowerCase()}`

/** The South African date of an instant, YYYY-MM-DD. */
export const saDate = (iso: string) =>
  new Date(new Date(iso).getTime() + SA_OFFSET_MS).toISOString().slice(0, 10)

const headers = (credentials: Credentials) => ({
  Authorization: `Bearer ${str(credentials.accessToken)}`,
  'Content-Type': 'application/json',
})

function bodyFor(e: CalendarEventInput, appUrl: string | null) {
  return {
    summary: e.title,
    ...(e.description ? { description: e.description } : {}),
    ...(e.location ? { location: e.location } : {}),
    start: e.allDay
      ? { date: saDate(e.startsAt) }
      : { dateTime: e.startsAt, timeZone: 'Africa/Johannesburg' },
    end: e.allDay
      ? { date: saDate(e.endsAt) }
      : { dateTime: e.endsAt, timeZone: 'Africa/Johannesburg' },
    status: 'confirmed',
    extendedProperties: { private: { umbaneEventId: e.umbaneId } },
    ...(appUrl
      ? { source: { title: 'Umbane CRM', url: `${appUrl.replace(/\/$/, '')}/calendar` } }
      : {}),
  }
}

const failed = (
  what: string,
  r: Awaited<ReturnType<typeof call>>,
): { ok: false; status: number; error: string } => {
  if (r.network)
    return { ok: false, status: 0, error: `Google Calendar could not be reached (${r.error}).` }
  const err = (r.body.error ?? {}) as Record<string, unknown>
  return {
    ok: false,
    status: r.res.status,
    error: `Google Calendar ${r.res.status}: ${str(err.message) || what}`.slice(0, 300),
  }
}

/** Google's all-day dates are days (end exclusive); timed events are instants. */
function toEvent(item: Record<string, unknown>): GoogleEvent | null {
  const start = (item.start ?? {}) as Record<string, unknown>
  const end = (item.end ?? {}) as Record<string, unknown>
  const allDay = Boolean(start.date)
  const startsAt = allDay ? `${str(start.date)}T00:00:00+02:00` : str(start.dateTime)
  const endsAt = allDay
    ? `${str(end.date) || str(start.date)}T00:00:00+02:00`
    : str(end.dateTime) || startsAt
  if (!str(item.id) || !startsAt || item.status === 'cancelled') return null
  const props = ((item.extendedProperties ?? {}) as Record<string, unknown>).private as
    Record<string, unknown> | undefined
  return {
    id: str(item.id),
    title: str(item.summary) || '(No title)',
    startsAt,
    endsAt,
    allDay,
    location: str(item.location) || null,
    htmlLink: /^https:\/\//.test(str(item.htmlLink)) ? str(item.htmlLink) : null,
    umbaneId: str(props?.umbaneEventId) || null,
  }
}

/** The person's events between two instants (at most 1,000). */
export async function listEvents(
  credentials: Credentials,
  from: string,
  to: string,
  ctx: AdapterContext,
): Promise<CalendarResult<GoogleEvent[]>> {
  const events: GoogleEvent[] = []
  let pageToken = ''
  for (let page = 0; page < 4; page++) {
    const r = await call(
      ctx.fetch,
      `${EVENTS}?${form({
        timeMin: from,
        timeMax: to,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      })}`,
      { headers: headers(credentials) },
    )
    if (r.network || !r.res.ok) return failed('could not list events', r)
    for (const item of (Array.isArray(r.body.items) ? r.body.items : []) as Record<
      string,
      unknown
    >[]) {
      const e = toEvent(item)
      if (e) events.push(e)
    }
    pageToken = str(r.body.nextPageToken)
    if (!pageToken) break
  }
  return { ok: true, value: events }
}

/** Adds or updates the copy of a Umbane event. Safe to repeat: the id is fixed. */
export async function upsertEvent(
  credentials: Credentials,
  e: CalendarEventInput,
  ctx: AdapterContext,
): Promise<CalendarResult<{ id: string; htmlLink: string | null }>> {
  const id = googleEventId(e.umbaneId)
  const body = bodyFor(e, ctx.appUrl)
  const created = await call(ctx.fetch, EVENTS, {
    method: 'POST',
    headers: headers(credentials),
    body: JSON.stringify({ id, ...body }),
  })
  const link = (b: Record<string, unknown>) =>
    /^https:\/\//.test(str(b.htmlLink)) ? str(b.htmlLink) : null
  if (!created.network && created.res.ok)
    return { ok: true, value: { id, htmlLink: link(created.body) } }
  // Already there (made before, or a retry after an uncertain answer): update it instead.
  if (!created.network && created.res.status === 409) {
    const patched = await call(ctx.fetch, `${EVENTS}/${id}`, {
      method: 'PATCH',
      headers: headers(credentials),
      body: JSON.stringify(body),
    })
    if (!patched.network && patched.res.ok)
      return { ok: true, value: { id, htmlLink: link(patched.body) } }
    return failed('could not update the event', patched)
  }
  return failed('could not add the event', created)
}

/** Removes the copy. Already gone counts as removed. */
export async function removeEvent(
  credentials: Credentials,
  googleId: string,
  ctx: AdapterContext,
): Promise<CalendarResult<null>> {
  const r = await call(ctx.fetch, `${EVENTS}/${encodeURIComponent(googleId)}`, {
    method: 'DELETE',
    headers: headers(credentials),
  })
  if (!r.network && (r.res.ok || r.res.status === 404 || r.res.status === 410))
    return { ok: true, value: null }
  return failed('could not remove the event', r)
}

export const googleCalendar: Adapter = {
  provider: 'google_calendar',
  // Event ids are fixed, so repeating an add cannot make a second event.
  idempotent: true,
  oauth: {
    app: 'google',
    authorizeUrl: ({ clientId, redirectUri, state, challenge }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${form({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: `openid email ${CALENDAR_SCOPE}`,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    // The same Google token exchange as Gmail; the scope was chosen on the sign-in page.
    exchange: (p, ctx) => google.oauth!.exchange(p, ctx),
  },
  refresh: (credentials, ctx) => google.refresh!(credentials, ctx),
  revoke: (credentials, ctx) => google.revoke!(credentials, ctx),
  async verify(credentials, _settings, ctx) {
    const auth = { Authorization: `Bearer ${str(credentials.accessToken)}` }
    const who = await call(ctx.fetch, 'https://openidconnect.googleapis.com/v1/userinfo', {
      headers: auth,
    })
    if (who.network) return { ok: false, error: `Could not reach Google: ${who.error}` }
    if (!who.res.ok || !str(who.body.email)) {
      return { ok: false, error: 'Google did not confirm the account. Connect again.' }
    }
    const info = await call(
      ctx.fetch,
      `https://oauth2.googleapis.com/tokeninfo?${form({ access_token: str(credentials.accessToken) })}`,
      {},
    )
    const granted = info.network
      ? ((credentials.scopes as string[] | undefined) ?? [])
      : str(info.body.scope).split(/\s+/)
    if (!granted.includes(CALENDAR_SCOPE)) {
      return {
        ok: false,
        error:
          'Permission to see and add calendar events was not granted. Connect again and allow it.',
      }
    }
    const address = str(who.body.email).toLowerCase()
    return {
      ok: true,
      account: {
        accountLabel: address,
        accountId: str(who.body.sub) || address,
        capabilities: ['calendar_events'],
        settings: { address },
      },
    }
  },
  async send() {
    return { ok: false, retryable: false, error: 'A calendar does not send messages.' }
  },
}
