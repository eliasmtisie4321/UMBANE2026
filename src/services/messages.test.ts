import { describe, expect, it, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import {
  cancelMessage,
  getEmailSetup,
  listMessages,
  logContact,
  queueEmail,
  retryMessage,
  saveTemplate,
  sendNow,
  setCustomerPreferences,
  type ServerApi,
} from './messages'

const server = (
  status: number,
  body: unknown,
  type = 'application/json',
): ServerApi & { fetch: ReturnType<typeof vi.fn> } => ({
  token: async () => 'jwt',
  fetch: vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': type },
      }),
  ),
})

describe('queueing and sending', () => {
  it('queues through the database, which checks consent and links', async () => {
    const { client, log } = fake({ 'rpc:queue_email': { data: 'm1' } })
    const r = await queueEmail(
      {
        customerId: 'c1',
        subject: 'Invoice',
        body: 'Hello',
        templateKey: 'invoice_issued',
        purpose: 'transactional',
        invoiceId: 'i1',
        attachment: { path: 'b1/k/INV.pdf', name: 'INV.pdf' },
      },
      client,
    )
    expect(r.ok && r.data.id).toBe('m1')
    expect(JSON.parse(log[0].ops[0])).toEqual({
      p_customer_id: 'c1',
      p_subject: 'Invoice',
      p_body: 'Hello',
      p_template_key: 'invoice_issued',
      p_purpose: 'transactional',
      p_invoice_id: 'i1',
      p_ticket_id: null,
      p_attachment_path: 'b1/k/INV.pdf',
      p_attachment_name: 'INV.pdf',
    })
  })

  it.each([
    ['message_opted_out', /asked not/],
    ['message_recipient_suppressed', /bounced or was marked as spam/],
    ['message_no_consent', /consent/],
  ])('explains %s', async (message, text) => {
    const r = await queueEmail(
      { customerId: 'c1', subject: 's', body: 'b', templateKey: null, purpose: 'transactional' },
      fake({ 'rpc:queue_email': { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('asks the server to send, with the person’s session', async () => {
    const s = server(200, { outcome: 'sent', status: 'sent' })
    expect(await sendNow('m1', s)).toEqual({ state: 'sent' })
    const [url, init] = s.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/messages/send')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' })
    expect(JSON.parse(String(init.body))).toEqual({ messageId: 'm1' })
  })

  it.each([
    [202, { status: 'queued', configured: false }, { state: 'queued', reason: 'not_configured' }],
    [503, { error: 'not_configured' }, { state: 'queued', reason: 'not_configured' }],
    [
      200,
      { status: 'failed', error: 'Resend 503' },
      { state: 'failed', error: 'Resend 503', willRetry: true },
    ],
    [500, { error: 'x' }, { state: 'queued', reason: 'unavailable' }],
  ])('reports %i %j as %j', async (status, body, expected) => {
    expect(await sendNow('m1', server(status, body))).toEqual(expected)
  })

  it('keeps the email queued when the server is not there (local development)', async () => {
    expect(await sendNow('m1', server(200, '<!doctype html>', 'text/html'))).toEqual({
      state: 'queued',
      reason: 'unavailable',
    })
    const offline: ServerApi = {
      token: async () => 'jwt',
      fetch: () => Promise.reject(new Error('offline')),
    }
    expect((await sendNow('m1', offline)).state).toBe('queued')
  })

  it('reads the email setup, never inventing it', async () => {
    const ok = await getEmailSetup(
      server(200, {
        email: false,
        missing: ['RESEND_API_KEY'],
        deliveryReports: false,
        retries: true,
        from: null,
      }),
    )
    expect(ok.ok && ok.data).toEqual({
      email: false,
      missing: ['RESEND_API_KEY'],
      deliveryReports: false,
      retries: true,
      from: null,
    })
    expect((await getEmailSetup(server(200, '<html>', 'text/html'))).ok).toBe(false)
  })

  it('retries and cancels through the database', async () => {
    const r = fake({ 'rpc:retry_message': {} })
    await retryMessage('m1', r.client)
    expect(r.log[0]).toMatchObject({ table: 'rpc:retry_message', ops: ['{"p_id":"m1"}'] })
    const c = await cancelMessage(
      'm1',
      fake({
        'rpc:cancel_message': { error: { code: '23514', message: 'message_not_cancellable' } },
      }).client,
    )
    expect(c.ok ? '' : c.error.message).toMatch(/already gone/)
  })
})

describe('history, contacts, preferences and templates', () => {
  it('filters messages needing attention and by customer', async () => {
    const { client, log } = fake({ message_list: { data: [], count: 0 } })
    await listMessages(
      { search: '', sort: 'created_at', ascending: false, page: 1, pageSize: 10 },
      { status: 'attention', channel: 'email', customerId: 'c1' },
      client,
    )
    expect(log[0].ops).toContain('in("status",["failed","bounced","complained"])')
    expect(log[0].ops).toContain('eq("channel","email")')
    expect(log[0].ops).toContain('eq("customer_id","c1")')
  })

  it('logs a contact without author or status: the database sets them', async () => {
    const { client, log } = fake({ communication_logs: { data: { id: 'l1' } } })
    await logContact(
      { customerId: 'c1', channel: 'call', direction: 'inbound', subject: null, body: ' Called ' },
      client,
    )
    expect(log[0].ops[0]).toBe(
      'insert({"customer_id":"c1","channel":"call","direction":"inbound","subject":null,"body":"Called"})',
    )
  })

  it('saves preferences', async () => {
    const { client, log } = fake({ customers: { data: [{ id: 'c1' }] } })
    await setCustomerPreferences('c1', { emailOptOut: true, marketingConsent: false }, client)
    expect(log[0].ops[0]).toBe('update({"email_opt_out":true,"marketing_consent":false})')
  })

  it('adds a template with its key, and never changes the key of an existing one', async () => {
    const input = {
      key: 'winter_tips',
      name: 'Winter',
      purpose: 'marketing' as const,
      subject: 'S',
      body: 'B',
      isActive: true,
    }
    const add = fake({ message_templates: { data: [{ id: 't1' }] } })
    await saveTemplate(null, input, add.client)
    expect(add.log[0].ops[0]).toContain('"key":"winter_tips"')
    const edit = fake({ message_templates: { data: [{ id: 't1' }] } })
    await saveTemplate('t1', input, edit.client)
    expect(edit.log[0].ops[0]).not.toContain('key')
    const staff = await saveTemplate('t1', input, fake({ message_templates: { data: [] } }).client)
    expect(staff.ok ? '' : staff.error.message).toMatch(/Only a manager/)
  })
})
