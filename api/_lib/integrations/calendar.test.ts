// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCalendarHandler } from '../../calendar.js'
import { createCallbackHandler } from '../../integrations/callback.js'
import { createIntegrationsHandler } from '../../integrations/index.js'
import type { ServerEnv } from '../server.js'
import { fakeDb } from '../testing/fakeDb.js'
import {
  CALENDAR_SCOPE,
  googleCalendar,
  googleEventId,
  listEvents,
  removeEvent,
  saDate,
  upsertEvent,
} from './calendar.js'
import { encryptionKey, encryptSecrets, sha256Hex } from './crypto.js'
import type { AdapterContext } from './types.js'

const KEY_B64 = randomBytes(32).toString('base64')
const KEY = encryptionKey(KEY_B64)!
const BIZ = '11111111-0000-4000-8000-000000000001'
const OTHER = '11111111-0000-4000-8000-000000000002'
const ADMIN = 'a1000000-0000-4000-8000-000000000001'
const MANAGER = 'a2000000-0000-4000-8000-000000000001'
const STAFF = 'a3000000-0000-4000-8000-000000000001'
const STAFF2 = 'a5000000-0000-4000-8000-000000000001'
const EVENT = 'e7000000-0000-4000-8000-000000000001'
const CAL_STAFF = 'c7000000-0000-4000-8000-000000000001'
const CAL_STAFF2 = 'c7000000-0000-4000-8000-000000000002'

const env = (over: Partial<ServerEnv> = {}): ServerEnv => ({
  supabaseUrl: 'https://x.supabase.co',
  serviceKey: 'service',
  resendKey: null,
  emailFrom: null,
  replyTo: null,
  webhookSecret: null,
  cronSecret: 'cron',
  appUrl: 'https://crm.umbane.test',
  integrationsKey: KEY_B64,
  oauth: { google: { clientId: 'gid', clientSecret: 'gsecret' } },
  ...over,
})

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
function fakeFetch(routes: [string | RegExp, Handler][]) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const hit = routes.find(([m]) => (typeof m === 'string' ? url.startsWith(m) : m.test(url)))
    if (!hit) throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${url}`)
    return hit[1](url, init)
  })
}
const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })
const ctx = (f: ReturnType<typeof fakeFetch>): AdapterContext => ({
  fetch: f,
  appUrl: 'https://crm.umbane.test',
  oauth: { google: { clientId: 'gid', clientSecret: 'gs' } },
  now: () => 1_800_000_000_000,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = async (r: Response): Promise<any> => r.json()
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

afterEach(() => vi.unstubAllGlobals())

describe('the Google Calendar adapter', () => {
  it('asks only for calendar events, offline, with PKCE', () => {
    const url = new URL(
      googleCalendar.oauth!.authorizeUrl({
        clientId: 'gid',
        redirectUri: 'https://crm/cb',
        state: 's',
        challenge: 'c',
      }),
    )
    expect(url.searchParams.get('scope')).toBe(`openid email ${CALENDAR_SCOPE}`)
    expect(url.searchParams.get('code_challenge')).toBe('c')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  it('connects only when calendar access was actually granted', async () => {
    const who: [string, Handler] = [
      'https://openidconnect.googleapis.com/v1/userinfo',
      () => res(200, { sub: '9', email: 'Thandi@Gmail.com' }),
    ]
    const no = fakeFetch([
      who,
      ['https://oauth2.googleapis.com/tokeninfo', () => res(200, { scope: 'openid email' })],
    ])
    expect(await googleCalendar.verify({ accessToken: 't' }, {}, ctx(no), '')).toMatchObject({
      ok: false,
    })
    const yes = fakeFetch([
      who,
      [
        'https://oauth2.googleapis.com/tokeninfo',
        () => res(200, { scope: `openid email ${CALENDAR_SCOPE}` }),
      ],
    ])
    expect(await googleCalendar.verify({ accessToken: 't' }, {}, ctx(yes), '')).toMatchObject({
      ok: true,
      account: { accountLabel: 'thandi@gmail.com', capabilities: ['calendar_events'] },
    })
  })

  it('reads timed and all-day events, skips cancelled ones, and follows pages', async () => {
    const f = fakeFetch([
      [
        new RegExp(`^${EVENTS}\\?.*pageToken=p2`),
        () =>
          res(200, {
            items: [
              {
                id: 'g3',
                summary: 'Dentist',
                start: { dateTime: '2026-12-03T14:00:00+02:00' },
                end: { dateTime: '2026-12-03T15:00:00+02:00' },
              },
            ],
          }),
      ],
      [
        new RegExp(`^${EVENTS}\\?`),
        () =>
          res(200, {
            nextPageToken: 'p2',
            items: [
              {
                id: 'g1',
                summary: 'Board meeting',
                location: 'Office',
                htmlLink: 'https://calendar.google.com/e/g1',
                start: { dateTime: '2026-12-02T09:00:00+02:00' },
                end: { dateTime: '2026-12-02T10:00:00+02:00' },
              },
              {
                id: 'g2',
                summary: 'Public holiday',
                start: { date: '2026-12-16' },
                end: { date: '2026-12-17' },
              },
              { id: 'gx', status: 'cancelled', start: { date: '2026-12-18' } },
              {
                id: 'umbabc',
                summary: 'Site visit',
                start: { dateTime: '2026-12-04T09:00:00+02:00' },
                end: { dateTime: '2026-12-04T10:00:00+02:00' },
                extendedProperties: { private: { umbaneEventId: EVENT } },
              },
            ],
          }),
      ],
    ])
    const r = await listEvents(
      { accessToken: 't' },
      '2026-12-01T00:00:00Z',
      '2026-12-31T00:00:00Z',
      ctx(f),
    )
    expect(r.ok && r.value.map((e) => e.id)).toEqual(['g1', 'g2', 'umbabc', 'g3'])
    expect(r.ok && r.value[1]).toMatchObject({
      allDay: true,
      startsAt: '2026-12-16T00:00:00+02:00',
      endsAt: '2026-12-17T00:00:00+02:00',
    })
    expect(r.ok && r.value[2].umbaneId).toBe(EVENT)
    expect(String(f.mock.calls[0][0])).toContain('singleEvents=true')
  })

  it('adds a Umbane event with a fixed id, and updates it when it is already there', async () => {
    expect(googleEventId(EVENT)).toMatch(/^[a-v0-9]{5,1024}$/)
    const e = {
      umbaneId: EVENT,
      title: 'Site visit',
      description: null,
      location: 'Karoo Office',
      startsAt: '2026-12-03T09:00:00+02:00',
      endsAt: '2026-12-03T10:00:00+02:00',
      allDay: false,
    }
    const f = fakeFetch([
      [
        new RegExp(`^${EVENTS}/umb`),
        () => res(200, { id: googleEventId(EVENT), htmlLink: 'https://calendar.google.com/e/1' }),
      ],
      [EVENTS, () => res(409, { error: { message: 'The requested identifier already exists.' } })],
    ])
    const r = await upsertEvent({ accessToken: 't' }, e, ctx(f))
    expect(r).toEqual({
      ok: true,
      value: { id: googleEventId(EVENT), htmlLink: 'https://calendar.google.com/e/1' },
    })
    const sent = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body))
    expect(sent).toMatchObject({
      id: googleEventId(EVENT),
      summary: 'Site visit',
      location: 'Karoo Office',
      start: { dateTime: e.startsAt, timeZone: 'Africa/Johannesburg' },
      extendedProperties: { private: { umbaneEventId: EVENT } },
    })
    expect((f.mock.calls[1][1] as RequestInit).method).toBe('PATCH')
  })

  it('sends an all-day event as South African dates', async () => {
    const f = fakeFetch([[EVENTS, () => res(200, { id: 'x' })]])
    await upsertEvent(
      { accessToken: 't' },
      {
        umbaneId: EVENT,
        title: 'Stocktake',
        description: null,
        location: null,
        startsAt: '2026-12-04T22:00:00Z',
        endsAt: '2026-12-05T22:00:00Z',
        allDay: true,
      },
      ctx(f),
    )
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      start: { date: '2026-12-05' },
      end: { date: '2026-12-06' },
    })
    expect(saDate('2026-12-31T23:30:00Z')).toBe('2027-01-01')
  })

  it('counts an event that is already gone as removed', async () => {
    expect(
      await removeEvent({ accessToken: 't' }, 'umb1', ctx(fakeFetch([[EVENTS, () => res(410)]]))),
    ).toEqual({ ok: true, value: null })
    expect(
      await removeEvent(
        { accessToken: 't' },
        'umb1',
        ctx(fakeFetch([[EVENTS, () => res(500, { error: { message: 'down' } })]])),
      ),
    ).toMatchObject({ ok: false, status: 500 })
  })
})

// The calendar endpoint -------------------------------------------------------------------------------
const people = [
  { id: ADMIN, business_id: BIZ, role: 'administrator', is_active: true },
  { id: MANAGER, business_id: BIZ, role: 'manager', is_active: true },
  { id: STAFF, business_id: BIZ, role: 'staff', is_active: true },
  { id: STAFF2, business_id: BIZ, role: 'staff', is_active: true },
]
const users = {
  'admin-token': { id: ADMIN },
  'manager-token': { id: MANAGER },
  'staff-token': { id: STAFF },
  'staff2-token': { id: STAFF2 },
}
const connection = (id: string, profileId: string, over: Record<string, unknown> = {}) => ({
  id,
  business_id: BIZ,
  provider: 'google_calendar',
  channel: 'calendar',
  status: 'connected',
  profile_id: profileId,
  account_label: `${profileId.slice(0, 2)}@gmail.test`,
  capabilities: ['calendar_events'],
  settings: {},
  is_default: false,
  ...over,
})
const secret = (id: string) => ({
  integration_id: id,
  business_id: BIZ,
  ciphertext: encryptSecrets({ accessToken: 'tok-' + id, refreshToken: 'r' }, KEY, id),
})
const event = (over: Record<string, unknown> = {}) => ({
  id: EVENT,
  business_id: BIZ,
  title: 'Site visit: Karoo Office',
  description: null,
  location: 'Beaufort West',
  starts_at: '2026-12-03T07:00:00.000Z',
  ends_at: '2026-12-03T08:30:00.000Z',
  all_day: false,
  owner_id: STAFF,
  assigned_to: STAFF,
  google_event_id: null,
  google_calendar_owner: null,
  ...over,
})

function setup(seed: Record<string, Record<string, unknown>[]> = {}) {
  const fake = fakeDb(
    {
      profiles: people,
      integrations: [connection(CAL_STAFF, STAFF)],
      integration_secrets: [secret(CAL_STAFF)],
      calendar_events: [event()],
      ...seed,
    },
    { auth: { users } },
  )
  return { ...fake, handle: createCalendarHandler({ env: env(), admin: () => fake.db as never }) }
}
const post = (token: string, body: unknown) =>
  new Request('https://crm/api/calendar', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const get = (token: string, query = 'from=2026-12-01T00:00:00Z&to=2026-12-31T00:00:00Z') =>
  new Request(`https://crm/api/calendar?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  })

describe('the calendar endpoint', () => {
  it('shows a person their own Google events, and says when they have not connected', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch([
        [
          EVENTS,
          (_url, init) => {
            expect((init.headers as Record<string, string>).Authorization).toBe(
              `Bearer tok-${CAL_STAFF}`,
            )
            return res(200, {
              items: [
                {
                  id: 'g1',
                  summary: 'Dentist',
                  start: { dateTime: '2026-12-03T14:00:00+02:00' },
                  end: { dateTime: '2026-12-03T15:00:00+02:00' },
                },
              ],
            })
          },
        ],
      ]),
    )
    const { handle } = setup()
    const mine = await read(await handle(get('staff-token')))
    expect(mine).toMatchObject({ connected: true, events: [{ id: 'g1', title: 'Dentist' }] })
    expect(await read(await handle(get('manager-token')))).toEqual({
      connected: false,
      account: null,
      error: null,
      events: [],
    })
  })

  it('refuses a missing or too-long period, and anyone not signed in', async () => {
    const { handle } = setup()
    expect((await handle(get('staff-token', 'from=2026-01-01&to=2026-12-31'))).status).toBe(400)
    expect((await handle(get('staff-token', 'from=nope'))).status).toBe(400)
    expect(
      (await handle(new Request('https://crm/api/calendar?from=2026-12-01&to=2026-12-02'))).status,
    ).toBe(401)
  })

  it('adds an event to the person’s Google Calendar and records the copy', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch([
        [
          EVENTS,
          () => res(200, { id: googleEventId(EVENT), htmlLink: 'https://calendar.google.com/e/1' }),
        ],
      ]),
    )
    const { handle, rows } = setup()
    const r = await read(await handle(post('staff-token', { action: 'push', eventId: EVENT })))
    expect(r).toEqual({ synced: true, htmlLink: 'https://calendar.google.com/e/1' })
    expect(rows('calendar_events')[0]).toMatchObject({
      google_event_id: googleEventId(EVENT),
      google_calendar_owner: STAFF,
      google_error: null,
    })
  })

  it('asks people to connect first', async () => {
    const { handle } = setup({
      calendar_events: [event({ owner_id: MANAGER, assigned_to: MANAGER })],
    })
    const r = await handle(post('manager-token', { action: 'push', eventId: EVENT }))
    expect(r.status).toBe(409)
    expect((await read(r)).message).toMatch(/Connect your Google Calendar first/)
  })

  it('keeps the copy in the calendar that already has it when someone else edits the event', async () => {
    const f = fakeFetch([
      [new RegExp(`${EVENTS}/umb`), () => res(200, { id: 'x' })],
      [
        EVENTS,
        (_url, init) => {
          expect((init.headers as Record<string, string>).Authorization).toBe(
            `Bearer tok-${CAL_STAFF}`,
          )
          return res(409, {})
        },
      ],
    ])
    vi.stubGlobal('fetch', f)
    const { handle } = setup({
      calendar_events: [
        event({ google_event_id: googleEventId(EVENT), google_calendar_owner: STAFF }),
      ],
    })
    expect((await handle(post('manager-token', { action: 'push', eventId: EVENT }))).status).toBe(
      200,
    )
  })

  it('only the organiser, the person it is for, or a manager can change an event', async () => {
    const { handle } = setup({
      integrations: [connection(CAL_STAFF, STAFF), connection(CAL_STAFF2, STAFF2)],
      integration_secrets: [secret(CAL_STAFF), secret(CAL_STAFF2)],
    })
    expect((await handle(post('staff2-token', { action: 'push', eventId: EVENT }))).status).toBe(
      403,
    )
    expect((await handle(post('staff2-token', { action: 'delete', eventId: EVENT }))).status).toBe(
      403,
    )
  })

  it('deletes the Google copy first, then the event', async () => {
    const f = fakeFetch([[new RegExp(`${EVENTS}/umb`), () => res(204)]])
    vi.stubGlobal('fetch', f)
    const { handle, rows } = setup({
      calendar_events: [
        event({ google_event_id: googleEventId(EVENT), google_calendar_owner: STAFF }),
      ],
    })
    expect(
      await read(await handle(post('staff-token', { action: 'delete', eventId: EVENT }))),
    ).toEqual({ deleted: true, googleCopyLeft: false })
    expect((f.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
    expect(rows('calendar_events')).toHaveLength(0)
  })

  it('still deletes the event when Google cannot be reached, and says the copy may remain', async () => {
    vi.stubGlobal('fetch', fakeFetch([[EVENTS, () => res(500, { error: { message: 'down' } })]]))
    const { handle, rows } = setup({
      calendar_events: [
        event({ google_event_id: googleEventId(EVENT), google_calendar_owner: STAFF }),
      ],
    })
    expect(
      await read(await handle(post('staff-token', { action: 'delete', eventId: EVENT }))),
    ).toEqual({ deleted: true, googleCopyLeft: true })
    expect(rows('calendar_events')).toHaveLength(0)
  })

  it('never touches another business’s events', async () => {
    const { handle } = setup({ calendar_events: [event({ business_id: OTHER })] })
    expect((await handle(post('manager-token', { action: 'delete', eventId: EVENT }))).status).toBe(
      404,
    )
  })
})

describe('a personal calendar connection', () => {
  it('lets any team member start connecting their own calendar, but only administrators the business’s accounts', async () => {
    const fake = fakeDb({ profiles: people }, { auth: { users } })
    const handle = createIntegrationsHandler({ env: env(), admin: () => fake.db as never })
    const req = (token: string, provider: string) =>
      new Request('https://crm/api/integrations', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'oauth_start', provider }),
      })
    const mine = await handle(req('staff-token', 'google_calendar'))
    expect(mine.status).toBe(200)
    expect(new URL((await read(mine)).url).searchParams.get('scope')).toContain(CALENDAR_SCOPE)
    expect((await handle(req('staff-token', 'google'))).status).toBe(403)
  })

  it('is its owner’s to disconnect, and colleagues never see it', async () => {
    const fake = fakeDb(
      {
        profiles: people,
        integrations: [connection(CAL_STAFF, STAFF)],
        integration_secrets: [secret(CAL_STAFF)],
      },
      { auth: { users } },
    )
    const handle = createIntegrationsHandler({ env: env(), admin: () => fake.db as never })
    const listOf = async (token: string) =>
      (
        await read(
          await handle(
            new Request('https://crm/api/integrations', {
              headers: { authorization: `Bearer ${token}` },
            }),
          ),
        )
      ).connections
    expect(await listOf('staff-token')).toHaveLength(1)
    expect(await listOf('staff2-token')).toHaveLength(0)
    const disconnect = (token: string) =>
      handle(
        new Request('https://crm/api/integrations', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', id: CAL_STAFF }),
        }),
      )
    expect((await disconnect('staff2-token')).status).toBe(403)
    expect((await disconnect('staff-token')).status).toBe(200)
    expect(fake.rows('integrations')[0]).toMatchObject({ status: 'disconnected' })
  })

  it('is saved as the person’s own after they sign in with Google, and they return to the Calendar', async () => {
    const state = 'cal-state'
    vi.stubGlobal(
      'fetch',
      fakeFetch([
        [
          /^https:\/\/oauth2\.googleapis\.com\/token$/,
          () =>
            res(200, {
              access_token: 'at',
              refresh_token: 'rt',
              expires_in: 3600,
              scope: `openid email ${CALENDAR_SCOPE}`,
            }),
        ],
        [
          'https://openidconnect.googleapis.com/v1/userinfo',
          () => res(200, { sub: '9', email: 'staff@gmail.test' }),
        ],
        [
          'https://oauth2.googleapis.com/tokeninfo',
          () => res(200, { scope: `openid email ${CALENDAR_SCOPE}` }),
        ],
      ]),
    )
    const fake = fakeDb({
      profiles: people,
      integrations: [connection(CAL_STAFF2, STAFF2)],
      integration_oauth_states: [
        {
          state_hash: sha256Hex(state),
          business_id: BIZ,
          provider: 'google_calendar',
          created_by: STAFF,
          code_verifier: 'v'.repeat(43),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    })
    const r = await createCallbackHandler({ env: env(), admin: () => fake.db as never })(
      new Request(`https://crm/api/integrations/callback?code=c&state=${state}`),
    )
    expect(r.headers.get('location')).toBe(
      'https://crm.umbane.test/calendar?connected=google_calendar',
    )
    const mine = fake.rows('integrations').find((i) => i.profile_id === STAFF)
    expect(mine).toMatchObject({
      provider: 'google_calendar',
      status: 'connected',
      is_default: false,
      account_label: 'staff@gmail.test',
    })
    expect(fake.rows('integrations').find((i) => i.id === CAL_STAFF2)).toMatchObject({
      status: 'connected',
    })
  })
})
