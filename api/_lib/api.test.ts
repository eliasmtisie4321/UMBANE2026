// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRetryHandler } from '../messages/retry-due.js'
import { createSendHandler } from '../messages/send.js'
import { createStatusHandler } from '../messages/status.js'
import { createWebhookHandler } from '../webhooks/resend.js'
import { deliverDue, deliverMessage, type AdminClient } from './deliver.js'
import { sendViaResend, textToHtml, type OutgoingEmail, type SendResult } from './resend.js'
import { missingForEmail, readEnv, type ServerEnv } from './server.js'
import { verifyWebhook } from './webhook.js'

const email: OutgoingEmail = {
  from: 'Umbane <billing@umbane.co.za>',
  to: 'cleo@example.co.za',
  subject: 'Invoice INV-2026-00001',
  text: 'Hello',
  html: '<p>Hello</p>',
  idempotencyKey: 'm1:cleo@example.co.za',
}
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('sending through Resend', () => {
  it('sends with the key, an idempotency key and the attachment', async () => {
    const fetchImpl = vi.fn(() => reply(200, { id: 're_123' }))
    const r = await sendViaResend(
      { ...email, attachments: [{ filename: 'INV.pdf', content: 'JVBERi0=' }] },
      'key',
      fetchImpl,
    )
    expect(r).toEqual({ ok: true, id: 're_123' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer key',
      'Idempotency-Key': 'm1:cleo@example.co.za',
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ['cleo@example.co.za'],
      attachments: [{ filename: 'INV.pdf', content: 'JVBERi0=' }],
    })
  })

  it.each([
    [429, { name: 'rate_limit_exceeded', message: 'Too many requests' }, true],
    [503, { message: 'Unavailable' }, true],
    [409, { name: 'concurrent_idempotent_requests', message: 'In progress' }, true],
    [409, { name: 'invalid_idempotent_request', message: 'Different body' }, false],
    [422, { name: 'validation_error', message: 'Invalid `to` field' }, false],
    [403, { name: 'validation_error', message: 'Domain not verified' }, false],
  ])('treats %i %j as retryable: %s', async (status, body, retryable) => {
    const r = await sendViaResend(email, 'key', () => reply(status, body))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.retryable).toBe(retryable)
    expect(!r.ok && r.error).toMatch(new RegExp(`^Resend ${status}`))
  })

  it('retries a network failure', async () => {
    const r = await sendViaResend(email, 'key', () => Promise.reject(new Error('ECONNRESET')))
    expect(r).toEqual({ ok: false, retryable: true, error: 'Network error: ECONNRESET' })
  })

  it('turns text into safe HTML', () => {
    const html = textToHtml('Hi <b>Cleo</b> & co\nLine two\n\nNew "paragraph"')
    expect(html).toContain('Hi &lt;b&gt;Cleo&lt;/b&gt; &amp; co<br>Line two</p>')
    expect(html).toContain('New &quot;paragraph&quot;</p>')
    expect(html).not.toContain('<b>')
  })
})

describe('webhook signatures', () => {
  const secret = `whsec_${Buffer.from('test-secret-key-123').toString('base64')}`
  const sign = (id: string, ts: number, body: string) =>
    `v1,${createHmac('sha256', Buffer.from('test-secret-key-123')).update(`${id}.${ts}.${body}`).digest('base64')}`
  const now = 1_790_000_000
  const body = '{"type":"email.delivered"}'

  it('accepts a correctly signed, recent request', () => {
    const headers = {
      id: 'msg_1',
      timestamp: String(now),
      signature: `v1,bogus ${sign('msg_1', now, body)}`,
    }
    expect(verifyWebhook(secret, headers, body, now)).toBe(true)
  })

  it('refuses a changed body, a wrong secret, a stale timestamp or missing headers', () => {
    const good = { id: 'msg_1', timestamp: String(now), signature: sign('msg_1', now, body) }
    expect(verifyWebhook(secret, good, body.replace('delivered', 'bounced'), now)).toBe(false)
    expect(verifyWebhook(`whsec_${Buffer.from('other').toString('base64')}`, good, body, now)).toBe(
      false,
    )
    expect(verifyWebhook(secret, good, body, now + 301)).toBe(false)
    expect(verifyWebhook(secret, { ...good, signature: null }, body, now)).toBe(false)
    expect(verifyWebhook('', good, body, now)).toBe(false)
  })
})

function fakeAdmin(
  over: Partial<Record<string, { data?: unknown; error?: { message: string } | null }>> = {},
) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const download = vi.fn(async () => ({ data: new Blob(['%PDF-1.7']), error: null }))
  const admin: AdminClient = {
    rpc: (fn, args) => {
      calls.push([fn, args])
      const r = over[fn] ?? { data: null, error: null }
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
    storage: { from: () => ({ download }) },
  }
  return { admin, calls, download }
}
const claimed = {
  id: 'm1',
  recipient: 'cleo@example.co.za',
  subject: 'Invoice',
  body: 'Hello <Cleo>',
  attachment_path: null,
  attachment_name: null,
}

describe('delivering an email', () => {
  it('claims, sends and records success with the provider id', async () => {
    const { admin, calls } = fakeAdmin({ claim_message: { data: [claimed] } })
    const send = vi.fn<(e: OutgoingEmail) => Promise<SendResult>>(async () => ({
      ok: true,
      id: 're_9',
    }))
    expect(await deliverMessage(admin, { from: 'U <a@b.co>', send }, 'm1')).toBe('sent')
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'cleo@example.co.za',
      idempotencyKey: 'm1:cleo@example.co.za',
      text: 'Hello <Cleo>',
    })
    expect(send.mock.calls[0][0].html).toContain('Hello &lt;Cleo&gt;')
    expect(calls.at(-1)).toEqual([
      'record_message_result',
      { p_id: 'm1', p_ok: true, p_provider_message_id: 're_9', p_error: null, p_retryable: false },
    ])
  })

  it('does nothing when the database will not hand the email over', async () => {
    const { admin, calls } = fakeAdmin({ claim_message: { data: [] } })
    const send = vi.fn()
    expect(await deliverMessage(admin, { from: 'x', send }, 'm1')).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it('attaches the stored PDF', async () => {
    const { admin, download } = fakeAdmin({
      claim_message: {
        data: [{ ...claimed, attachment_path: 'b1/m1/INV.pdf', attachment_name: 'INV.pdf' }],
      },
    })
    const send = vi.fn<(e: OutgoingEmail) => Promise<SendResult>>(async () => ({
      ok: true,
      id: 're_1',
    }))
    await deliverMessage(admin, { from: 'x', send }, 'm1')
    expect(download).toHaveBeenCalledWith('b1/m1/INV.pdf')
    expect(send.mock.calls[0][0].attachments).toEqual([
      { filename: 'INV.pdf', content: Buffer.from('%PDF-1.7').toString('base64') },
    ])
  })

  it('records a thrown send as a retryable failure', async () => {
    const { admin, calls } = fakeAdmin({ claim_message: { data: [claimed] } })
    const send = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await deliverMessage(admin, { from: 'x', send }, 'm1')).toBe('failed')
    expect(calls.at(-1)?.[1]).toMatchObject({
      p_ok: false,
      p_retryable: true,
      p_error: 'Send failed: boom',
    })
  })

  it('works through due emails and keeps going after an error', async () => {
    const { admin } = fakeAdmin({
      due_messages: { data: ['a', 'b'] },
      claim_message: { data: [claimed] },
    })
    let n = 0
    const send = vi.fn(async () => {
      n += 1
      if (n === 1) throw new Error('first fails')
      return { ok: true as const, id: 're_2' }
    })
    expect(await deliverDue(admin, { from: 'x', send }, 5)).toEqual({
      sent: 1,
      failed: 1,
      skipped: 0,
      error: 0,
    })
  })
})

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

describe('settings', () => {
  it('reads settings, falling back to the app URL, and lists what is missing', () => {
    const e = readEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', RESEND_API_KEY: ' ' })
    expect(e.supabaseUrl).toBe('https://x.supabase.co')
    expect(missingForEmail(e)).toEqual([
      'SUPABASE_SERVICE_ROLE_KEY',
      'RESEND_API_KEY',
      'EMAIL_FROM',
    ])
    expect(missingForEmail(env())).toEqual([])
  })
})

/** A Supabase client double for the endpoints: a caller, their profile and one message. */
function fakeSupabase(opts: {
  user?: string | null
  role?: string
  business?: string
  messageBusiness?: string
}) {
  const rows: Record<string, unknown> = {
    profiles: opts.user
      ? {
          id: opts.user,
          business_id: opts.business ?? 'b1',
          role: opts.role ?? 'staff',
          is_active: true,
        }
      : null,
    communication_logs: {
      id: 'm',
      business_id: opts.messageBusiness ?? 'b1',
      status: 'sent',
      error: null,
    },
  }
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    }
    return q
  }
  return {
    auth: {
      getUser: async (token: string) =>
        token === 'good' && opts.user
          ? { data: { user: { id: opts.user } }, error: null }
          : { data: { user: null }, error: { message: 'bad' } },
    },
    from: query,
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
  }
}
const ID = '0b1e7c1e-0000-4000-8000-000000000001'
const post = (body: unknown, token = 'good') =>
  new Request('https://umbane.test/api/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('the send endpoint', () => {
  const handler = (sb: ReturnType<typeof fakeSupabase>, e = env()) =>
    createSendHandler({
      env: e,
      admin: () => sb as never,
      config: () => ({ from: 'x', send: async () => ({ ok: true, id: 're' }) }),
    })

  it('refuses someone who is not signed in as staff', async () => {
    expect(
      (await handler(fakeSupabase({ user: 'u1' }))(post({ messageId: ID }, 'bad'))).status,
    ).toBe(401)
    expect(
      (await handler(fakeSupabase({ user: 'u1', role: 'client' }))(post({ messageId: ID }))).status,
    ).toBe(401)
  })

  it('refuses another business’s email and a malformed id', async () => {
    expect(
      (await handler(fakeSupabase({ user: 'u1', messageBusiness: 'b2' }))(post({ messageId: ID })))
        .status,
    ).toBe(404)
    expect((await handler(fakeSupabase({ user: 'u1' }))(post({ messageId: 'x' }))).status).toBe(400)
  })

  it('leaves the email queued when the provider is not set up yet', async () => {
    const res = await handler(
      fakeSupabase({ user: 'u1' }),
      env({ resendKey: null }),
    )(post({ messageId: ID }))
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({
      status: 'queued',
      configured: false,
      missing: ['RESEND_API_KEY'],
    })
  })

  it('reports the email’s status after sending', async () => {
    const res = await handler(fakeSupabase({ user: 'u1' }))(post({ messageId: ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'skipped', status: 'sent' })
  })
})

describe('the other endpoints', () => {
  it('runs scheduled retries only with the cron secret', async () => {
    const { admin } = fakeAdmin({ due_messages: { data: [] } })
    const h = createRetryHandler(env(), () => admin)
    const call = (auth?: string) =>
      h(
        new Request('https://u/api/messages/retry-due', {
          headers: auth ? { authorization: auth } : {},
        }),
      )
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    expect((await call('Bearer cron-secret')).status).toBe(200)
    expect(
      (
        await createRetryHandler(
          env({ cronSecret: null }),
          () => admin,
        )(new Request('https://u', { headers: { authorization: 'Bearer null' } }))
      ).status,
    ).toBe(401)
  })

  it('tells staff what is set up, never the values', async () => {
    const res = await createStatusHandler(
      env({ resendKey: null }),
      () => fakeSupabase({ user: 'u1' }) as never,
    )(new Request('https://u/api/messages/status', { headers: { authorization: 'Bearer good' } }))
    const body = await res.json()
    expect(body).toMatchObject({
      email: false,
      missing: ['RESEND_API_KEY'],
      deliveryReports: false,
    })
    expect(JSON.stringify(body)).not.toContain('service')
  })

  it('records a signed delivery report and refuses an unsigned one', async () => {
    const raw = 'c2VjcmV0LWtleQ=='
    const { admin, calls } = fakeAdmin({ record_provider_event: { data: true } })
    const h = createWebhookHandler(env({ webhookSecret: `whsec_${raw}` }), () => admin)
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-11-27T08:00:00Z',
      data: { email_id: 're_1', subject: 'Private', bounce: { type: 'Permanent' } },
    })
    const ts = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', Buffer.from(raw, 'base64'))
      .update(`evt_1.${ts}.${body}`)
      .digest('base64')
    const req = (signature: string) =>
      new Request('https://u/api/webhooks/resend', {
        method: 'POST',
        headers: { 'svix-id': 'evt_1', 'svix-timestamp': String(ts), 'svix-signature': signature },
        body,
      })
    expect((await h(req('v1,forged'))).status).toBe(400)
    const res = await h(req(`v1,${sig}`))
    expect(await res.json()).toEqual({ recorded: true })
    expect(calls.find(([fn]) => fn === 'record_provider_event')).toEqual([
      'record_provider_event',
      {
        p_provider_message_id: 're_1',
        p_event: 'email.bounced',
        p_provider_event_id: 'evt_1',
        p_detail: { type: 'email.bounced', bounce: { type: 'Permanent' } },
        p_occurred_at: '2026-11-27T08:00:00Z',
      },
    ])
  })
})
