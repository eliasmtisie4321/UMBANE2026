import { describe, expect, it, vi } from 'vitest'
import { createDailyHandler } from '../cron/daily.js'
import { createFlushHandler } from '../notifications/flush.js'
import type { AdminClient } from './deliver.js'
import { deliverNotificationEmails, notificationEmail } from './notify.js'
import type { OutgoingEmail, SendResult } from './resend.js'
import { createWebhookHandler } from '../webhooks/resend.js'
import { isCronRequest, withinRateLimit, type ServerEnv } from './server.js'

const env = (over: Partial<ServerEnv> = {}): ServerEnv => ({
  supabaseUrl: 'https://x.supabase.co',
  serviceKey: 'service',
  resendKey: 're_key',
  emailFrom: 'Umbane <a@b.co>',
  replyTo: null,
  webhookSecret: null,
  cronSecret: 'cron-secret',
  appUrl: 'https://crm.umbane.test',
  ...over,
})

type Reply = { data?: unknown; error?: { message: string } | null }

/** A service-role client double: records RPC calls and answers from `replies`. */
function fakeAdmin(
  replies: Record<string, Reply> = {},
  user: { id: string; active?: boolean } | null = null,
) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const admin = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args])
      const r = replies[fn] ?? { data: null, error: null }
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
    auth: {
      getUser: async (token: string) =>
        token === 'good' && user
          ? { data: { user: { id: user.id } }, error: null }
          : { data: { user: null }, error: { message: 'bad' } },
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: user ? { id: user.id, business_id: 'b1', is_active: user.active ?? true } : null,
          error: null,
        }),
      }
      return q
    },
  }
  return { admin, calls }
}

const note = {
  id: 'n1',
  recipient: 'sam@umbane.test',
  title: 'Invoice INV-2026-00042 is overdue',
  body: 'Kagiso owes R 1,250.00.',
  link: '/invoices/i1',
  business_name: 'Umbane',
}

describe('notification emails', () => {
  it('links to the record in the app and says how to stop these emails', () => {
    const e = notificationEmail(note, 'https://crm.umbane.test/')
    expect(e.subject).toBe('Invoice INV-2026-00042 is overdue')
    expect(e.text).toContain('Open it in Umbane: https://crm.umbane.test/invoices/i1')
    expect(e.text).toContain('Notifications → Settings')
    expect(
      notificationEmail({ ...note, link: 'https://evil.test' }, 'https://crm.umbane.test').text,
    ).toContain('Sign in to Umbane to see it.')
    expect(notificationEmail(note, null).text).not.toContain('http')
  })

  it('claims, sends once per notification and records each result', async () => {
    const { admin, calls } = fakeAdmin({
      claim_notification_emails: { data: [note, { ...note, id: 'n2' }, { ...note, id: 'n3' }] },
    })
    let n = 0
    const send = vi.fn<(e: OutgoingEmail) => Promise<SendResult>>(async () => {
      n += 1
      if (n === 2) return { ok: false, retryable: false, error: 'Resend 422' }
      if (n === 3) throw new Error('socket hang up')
      return { ok: true, id: 're_1' }
    })
    const out = await deliverNotificationEmails(
      admin as unknown as AdminClient,
      { from: 'U <a@b.co>', send },
      null,
      10,
      'b1',
    )
    expect(out).toEqual({ sent: 1, failed: 2, error: 0 })
    expect(calls[0]).toEqual(['claim_notification_emails', { p_limit: 10, p_business_id: 'b1' }])
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'sam@umbane.test',
      idempotencyKey: 'notification:n1',
    })
    expect(calls.slice(1)).toEqual([
      ['record_notification_email', { p_id: 'n1', p_ok: true, p_error: null, p_retryable: false }],
      [
        'record_notification_email',
        { p_id: 'n2', p_ok: false, p_error: 'Resend 422', p_retryable: false },
      ],
      [
        'record_notification_email',
        { p_id: 'n3', p_ok: false, p_error: 'Send failed: socket hang up', p_retryable: true },
      ],
    ])
  })

  it('stops if the queue cannot be read', async () => {
    const { admin } = fakeAdmin({ claim_notification_emails: { error: { message: 'down' } } })
    await expect(
      deliverNotificationEmails(
        admin as unknown as AdminClient,
        { from: 'x', send: vi.fn() },
        null,
        10,
      ),
    ).rejects.toThrow('down')
  })
})

const cron = (secret: string | null = 'cron-secret') =>
  new Request('https://umbane.test/api/cron/daily', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })

describe('the daily run', () => {
  const handler = (a: ReturnType<typeof fakeAdmin>, e = env()) =>
    createDailyHandler({
      env: e,
      admin: () => a.admin as unknown as AdminClient,
      config: () => ({ from: 'x', send: async () => ({ ok: true, id: 're' }) }),
    })

  it('answers only Vercel Cron, with the right secret', async () => {
    expect(isCronRequest(cron(), null)).toBe(false)
    expect((await handler(fakeAdmin())(cron(null))).status).toBe(401)
    expect((await handler(fakeAdmin())(cron('wrong'))).status).toBe(401)
    expect((await handler(fakeAdmin(), env({ cronSecret: null }))(cron())).status).toBe(401)
  })

  it('runs the automations, then sends waiting emails', async () => {
    const a = fakeAdmin({
      run_automations: { data: { runs: [{ key: 'overdue_invoices', done: 2 }] } },
    })
    const res = await handler(a)(cron())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      automations: { runs: [{ key: 'overdue_invoices', done: 2 }] },
      notificationEmails: { sent: 0, failed: 0, error: 0 },
      customerEmails: { sent: 0 },
    })
    expect(a.calls.map(([fn]) => fn)).toEqual([
      'run_automations',
      'apply_retention',
      'claim_notification_emails',
      'due_messages',
    ])
  })

  it('still runs the automations when email is not set up', async () => {
    const a = fakeAdmin()
    const res = await handler(a, env({ resendKey: null }))(cron())
    expect(await res.json()).toMatchObject({
      email: { status: 'not_configured', missing: ['RESEND_API_KEY'] },
    })
    expect(a.calls.map(([fn]) => fn)).toEqual(['run_automations', 'apply_retention'])
  })

  it('reports a failed run but still sends email', async () => {
    const a = fakeAdmin({ run_automations: { error: { message: 'boom' } } })
    const res = await handler(a)(cron())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ automations: { error: 'boom' } })
    expect(a.calls.map(([fn]) => fn)).toContain('claim_notification_emails')
  })

  it('needs the server settings', async () => {
    expect((await handler(fakeAdmin(), env({ serviceKey: null }))(cron())).status).toBe(503)
  })
})

const flushRequest = (token = 'good', method = 'POST') =>
  new Request('https://umbane.test/api/notifications/flush', {
    method,
    headers: { authorization: `Bearer ${token}` },
  })

describe('flushing emails from the app', () => {
  const handler = (a: ReturnType<typeof fakeAdmin>, e = env()) =>
    createFlushHandler({
      env: e,
      admin: () => a.admin as never,
      config: () => ({ from: 'x', send: async () => ({ ok: true, id: 're' }) }),
    })

  it('sends what is queued for the caller’s own business', async () => {
    const a = fakeAdmin(
      { claim_notification_emails: { data: [note] }, due_messages_for: { data: [] } },
      { id: 'u1' },
    )
    const res = await handler(a)(flushRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ notifications: { sent: 1 }, customerEmails: 0 })
    expect(a.calls[1]).toEqual(['claim_notification_emails', { p_limit: 10, p_business_id: 'b1' }])
    expect(a.calls).toContainEqual(['due_messages_for', { p_business_id: 'b1', p_limit: 5 }])
  })

  it('refuses anyone not signed in or no longer active', async () => {
    expect((await handler(fakeAdmin({}, { id: 'u1' }))(flushRequest('bad'))).status).toBe(401)
    expect((await handler(fakeAdmin({}, { id: 'u1', active: false }))(flushRequest())).status).toBe(
      401,
    )
    expect((await handler(fakeAdmin({}, { id: 'u1' }))(flushRequest('good', 'GET'))).status).toBe(
      405,
    )
  })

  it('does nothing until email is set up', async () => {
    const a = fakeAdmin({}, { id: 'u1' })
    const res = await handler(a, env({ emailFrom: null }))(flushRequest())
    expect(res.status).toBe(202)
    expect(a.calls).toEqual([])
  })
})

describe('rate limits', () => {
  it('allows a call within the limit and refuses one over it', async () => {
    const allowed = fakeAdmin({ rate_limit_hit: { data: true } })
    expect(await withinRateLimit(allowed.admin, 'send:u1', 20)).toBe(true)
    expect(allowed.calls[0]).toEqual([
      'rate_limit_hit',
      { p_key: 'send:u1', p_limit: 20, p_window_seconds: 60 },
    ])
    expect(
      await withinRateLimit(fakeAdmin({ rate_limit_hit: { data: false } }).admin, 'k', 1),
    ).toBe(false)
  })

  it('lets calls through if the limiter itself is broken', async () => {
    expect(
      await withinRateLimit(
        fakeAdmin({ rate_limit_hit: { error: { message: 'missing' } } }).admin,
        'k',
        1,
      ),
    ).toBe(true)
    const throwing = { rpc: () => Promise.reject(new Error('down')) }
    expect(await withinRateLimit(throwing, 'k', 1)).toBe(true)
  })

  it('answers 429 with a retry time once a person is over the limit', async () => {
    const a = fakeAdmin({ rate_limit_hit: { data: false } }, { id: 'u1' })
    const res = await createFlushHandler({
      env: env(),
      admin: () => a.admin as never,
      config: () => ({ from: 'x', send: async () => ({ ok: true, id: 're' }) }),
    })(flushRequest())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(a.calls.map(([fn]) => fn)).toEqual(['rate_limit_hit'])
    expect(a.calls[0][1]).toMatchObject({ p_key: 'flush:u1' })
  })

  it('limits the webhook by address before checking signatures', async () => {
    const a = fakeAdmin({ rate_limit_hit: { data: false } })
    const res = await createWebhookHandler(
      env({ webhookSecret: 'whsec_dGVzdA==' }),
      () => a.admin as unknown as AdminClient,
    )(
      new Request('https://umbane.test/api/webhooks/resend', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(429)
    expect(a.calls[0][1]).toMatchObject({ p_key: 'webhook:203.0.113.9' })
  })
})
