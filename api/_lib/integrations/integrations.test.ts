// @vitest-environment node
import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDERS } from '../../../shared/integrations.js'
import { createDocumentsHandler } from '../../documents.js'
import { createCallbackHandler } from '../../integrations/callback.js'
import { createIntegrationsHandler } from '../../integrations/index.js'
import { createSendHandler } from '../../messages/send.js'
import { createInvitationsHandler } from '../../team/invitations.js'
import { createMessagingWebhookHandler } from '../../webhooks/messaging.js'
import { deliverMessage, type AdminClient } from '../deliver.js'
import { deliveryConfig, type ServerEnv } from '../server.js'
import { fakeDb } from '../testing/fakeDb.js'
import {
  decryptSecrets,
  encryptionKey,
  encryptSecrets,
  sha256Hex,
  webhookVerifyToken,
} from './crypto.js'
import { google, microsoft, resend } from './email.js'
import { failure } from './http.js'
import { buildMime, mailbox } from './mime.js'
import { metaSignatureOk, twilio, twilioSignatureOk, whatsapp } from './messaging.js'
import { ADAPTERS } from './registry.js'
import { routeFor } from './sender.js'
import { facebook, instagram, linkedin } from './social.js'
import type { AdapterContext, Connection, OutgoingMessage } from './types.js'

const KEY_B64 = randomBytes(32).toString('base64')
const KEY = encryptionKey(KEY_B64)!
const BIZ = '11111111-0000-4000-8000-000000000001'
const OTHER = '11111111-0000-4000-8000-000000000002'
const ADMIN = 'a1000000-0000-4000-8000-000000000001'
const STAFF = 'a3000000-0000-4000-8000-000000000001'
const OTHER_ADMIN = 'b1000000-0000-4000-8000-000000000001'
const INTEG = 'f1700000-0000-4000-8000-000000000001'
const MSG = 'c0000000-0000-4000-8000-000000000001'

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
/** A fetch that answers by address; anything unexpected fails the test. */
function fakeFetch(routes: [string | RegExp, Handler][]) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const hit = routes.find(([m]) => (typeof m === 'string' ? url.startsWith(m) : m.test(url)))
    if (!hit) throw new Error(`Unexpected request: ${url}`)
    return hit[1](url, init)
  })
}
const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers })

const ctx = (
  fetchImpl: ReturnType<typeof fakeFetch>,
  over: Partial<AdapterContext> = {},
): AdapterContext => ({
  fetch: fetchImpl,
  appUrl: 'https://crm.umbane.test',
  oauth: {
    google: { clientId: 'gid', clientSecret: 'gs' },
    microsoft: { clientId: 'mid', clientSecret: 'ms' },
    meta: { clientId: 'fid', clientSecret: 'fs' },
    linkedin: { clientId: 'lid', clientSecret: 'ls' },
  },
  now: () => 1_800_000_000_000,
  ...over,
})

const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  id: MSG,
  to: 'cleo@example.co.za',
  toName: 'Cleo Client',
  subject: 'Invoice INV-2026-00001',
  text: 'Your invoice is attached.',
  html: '<p>Your invoice is attached.</p>',
  attachments: [],
  documentUrl: null,
  linkUrl: null,
  imageUrl: null,
  idempotencyKey: `${MSG}:cleo@example.co.za`,
  purpose: 'transactional',
  ...over,
})

const connection = (over: Partial<Connection> = {}): Connection => ({
  id: INTEG,
  businessId: BIZ,
  provider: 'resend',
  accountLabel: 'accounts@umbane.co.za',
  accountId: 'x',
  capabilities: ['send_email', 'attachments'],
  settings: { fromAddress: 'accounts@umbane.co.za', fromName: 'Umbane Accounts' },
  ...over,
})

const bodyOf = (call: unknown[]) => String((call[1] as RequestInit).body)

afterEach(() => vi.unstubAllGlobals())

// Responses are checked field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
const read = async (r: Response): Promise<Json> => r.json()

describe('credentials encryption', () => {
  it('round-trips, and the stored text does not contain the secret', () => {
    const text = encryptSecrets({ apiKey: 're_live_secret_123' }, KEY, INTEG)
    expect(text).toMatch(/^v1\./)
    expect(text).not.toContain('re_live_secret_123')
    expect(decryptSecrets(text, KEY, INTEG)).toEqual({ apiKey: 're_live_secret_123' })
  })

  it('refuses text that was changed, moved to another connection or made with another key', () => {
    const text = encryptSecrets({ apiKey: 'k' }, KEY, INTEG)
    const flipped = text.slice(0, -4) + (text.endsWith('A') ? 'B' : 'A') + text.slice(-3)
    expect(() => decryptSecrets(flipped, KEY, INTEG)).toThrow()
    expect(() => decryptSecrets(text, KEY, 'another-integration')).toThrow()
    expect(() => decryptSecrets(text, randomBytes(32), INTEG)).toThrow()
  })

  it('accepts a 32-byte key as base64 or hex, and nothing weaker', () => {
    expect(encryptionKey(randomBytes(32).toString('hex'))?.length).toBe(32)
    expect(encryptionKey(KEY_B64)?.length).toBe(32)
    expect(encryptionKey('short')).toBeNull()
    expect(encryptionKey(null)).toBeNull()
  })

  it('gives each WhatsApp connection its own webhook token', () => {
    expect(webhookVerifyToken(INTEG, KEY)).not.toBe(webhookVerifyToken('other', KEY))
    expect(webhookVerifyToken(INTEG, KEY)).toHaveLength(40)
  })
})

describe('email format', () => {
  it('encodes names and subjects, and header injection is impossible', () => {
    expect(mailbox('a@b.co', 'Umbane Accounts')).toBe('"Umbane Accounts" <a@b.co>')
    expect(mailbox('a@b.co', 'Evil\r\nBcc: x@y.z')).not.toMatch(/\r|\n/)
    const mime = buildMime(
      {
        from: mailbox('a@b.co', 'Thandeka Ndlovu'),
        to: 'c@d.co',
        subject: 'Faktuur – Umbane',
        text: 'Hallo',
        html: '<p>Hallo</p>',
        attachments: [
          { filename: 'INV-1.pdf', contentType: 'application/pdf', content: 'JVBERi0=', bytes: 5 },
        ],
        messageId: '<m1@umbane.crm>',
      },
      'seed',
    )
    expect(mime).toContain('Subject: =?UTF-8?B?')
    expect(mime).toContain('Content-Disposition: attachment; filename="INV-1.pdf"')
    expect(mime).toContain('JVBERi0=')
    expect(mime.split('\r\n\r\n').length).toBeGreaterThan(3)
  })
})

describe('when a send fails', () => {
  it('always retries a rate limit: the provider did nothing', () => {
    expect(failure('Gmail', { status: 429, message: 'slow down' }, false).retryable).toBe(true)
  })

  it('retries an unknown outcome only where the provider refuses duplicates', () => {
    expect(failure('Resend', { network: true, error: 'ECONNRESET' }, true).retryable).toBe(true)
    const gmail = failure('Gmail', { network: true, error: 'ECONNRESET' }, false)
    expect(gmail.retryable).toBe(false)
    expect(gmail.error).toMatch(/may have been sent/)
    expect(failure('Twilio', { status: 503, message: 'down' }, false).retryable).toBe(false)
  })

  it('never retries a refusal', () => {
    expect(
      failure('Twilio', { status: 400, code: '21211', message: 'Invalid To' }, false),
    ).toMatchObject({
      retryable: false,
      error: 'Twilio 400 21211: Invalid To',
    })
  })
})

describe('the provider registry', () => {
  it('has an adapter for every provider that can be connected, and none for TikTok', () => {
    for (const p of PROVIDERS) expect(Boolean(ADAPTERS[p.key])).toBe(p.connect !== 'unavailable')
  })

  it('has OAuth for every OAuth provider', () => {
    for (const p of PROVIDERS.filter((x) => x.connect === 'oauth'))
      expect(ADAPTERS[p.key]?.oauth).toBeTruthy()
  })
})

describe('Resend', () => {
  it('connects when the sending domain is verified', async () => {
    const f = fakeFetch([
      [
        'https://api.resend.com/domains',
        () => res(200, { data: [{ name: 'umbane.co.za', status: 'verified' }] }),
      ],
    ])
    const r = await resend.verify(
      { apiKey: 're_x', webhookSecret: 'whsec_x' },
      { fromAddress: 'Accounts@Umbane.co.za' },
      ctx(f),
      '',
    )
    expect(r).toEqual({
      ok: true,
      account: {
        accountLabel: 'accounts@umbane.co.za',
        accountId: 'accounts@umbane.co.za',
        capabilities: ['send_email', 'attachments', 'delivery_tracking'],
      },
    })
  })

  it('does not connect a domain that is not verified, or a bad key', async () => {
    const pending = fakeFetch([
      [
        'https://api.resend.com/domains',
        () => res(200, { data: [{ name: 'umbane.co.za', status: 'pending' }] }),
      ],
    ])
    expect(
      await resend.verify({ apiKey: 're_x' }, { fromAddress: 'a@umbane.co.za' }, ctx(pending), ''),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/not verified/) })
    const bad = fakeFetch([
      ['https://api.resend.com/domains', () => res(401, { name: 'validation_error' })],
    ])
    expect(
      await resend.verify({ apiKey: 're_x' }, { fromAddress: 'a@umbane.co.za' }, ctx(bad), ''),
    ).toMatchObject({ ok: false })
  })

  it('accepts a sending-only key (Resend confirms it is real) without delivery reports unless a secret is given', async () => {
    const f = fakeFetch([
      ['https://api.resend.com/domains', () => res(401, { name: 'restricted_api_key' })],
    ])
    const r = await resend.verify({ apiKey: 're_x' }, { fromAddress: 'a@umbane.co.za' }, ctx(f), '')
    expect(r.ok && r.account.capabilities).toEqual(['send_email', 'attachments'])
  })

  it('sends from the configured address with the idempotency key', async () => {
    const f = fakeFetch([['https://api.resend.com/emails', () => res(200, { id: 're_1' })]])
    const r = await resend.send(message(), { apiKey: 're_x' }, connection(), ctx(f))
    expect(r).toEqual({ ok: true, id: 're_1', sender: 'accounts@umbane.co.za' })
    const init = f.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      `${MSG}:cleo@example.co.za`,
    )
    expect(JSON.parse(String(init.body)).from).toBe('"Umbane Accounts" <accounts@umbane.co.za>')
  })
})

describe('Gmail / Google Workspace', () => {
  it('asks for sending only, offline, with PKCE', () => {
    const url = new URL(
      google.oauth!.authorizeUrl({
        clientId: 'gid',
        redirectUri: 'https://crm/cb',
        state: 's1',
        challenge: 'c1',
      }),
    )
    expect(url.searchParams.get('scope')).toBe(
      'openid email https://www.googleapis.com/auth/gmail.send',
    )
    expect(url.searchParams.get('code_challenge')).toBe('c1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  it('exchanges the code with the verifier and keeps the granted scopes', async () => {
    const f = fakeFetch([
      [
        'https://oauth2.googleapis.com/token',
        () =>
          res(200, {
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: 'openid https://www.googleapis.com/auth/gmail.send',
          }),
      ],
    ])
    const g = await google.oauth!.exchange(
      { code: 'code', verifier: 'v'.repeat(43), redirectUri: 'https://crm/cb' },
      ctx(f),
    )
    expect(g.credentials).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1_800_000_000_000 + 3_600_000,
    })
    expect(new URLSearchParams(bodyOf(f.mock.calls[0])).get('code_verifier')).toBe('v'.repeat(43))
  })

  it('only connects when sending was actually granted', async () => {
    const who: [string, Handler] = [
      'https://openidconnect.googleapis.com/v1/userinfo',
      () => res(200, { sub: '42', email: 'Accounts@Umbane.co.za' }),
    ]
    const denied = fakeFetch([
      who,
      ['https://oauth2.googleapis.com/tokeninfo', () => res(200, { scope: 'openid email' })],
    ])
    expect(await google.verify({ accessToken: 'at' }, {}, ctx(denied), '')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not granted/),
    })
    const granted = fakeFetch([
      who,
      [
        'https://oauth2.googleapis.com/tokeninfo',
        () => res(200, { scope: 'openid email https://www.googleapis.com/auth/gmail.send' }),
      ],
    ])
    expect(await google.verify({ accessToken: 'at' }, {}, ctx(granted), '')).toMatchObject({
      ok: true,
      account: {
        accountLabel: 'accounts@umbane.co.za',
        settings: { address: 'accounts@umbane.co.za' },
      },
    })
  })

  it('sends a complete email and says when it is unsure whether it went', async () => {
    const f = fakeFetch([
      [
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        () => res(200, { id: 'g1' }),
      ],
    ])
    const conn = connection({ provider: 'google', settings: { address: 'accounts@umbane.co.za' } })
    const r = await google.send(
      message({
        attachments: [
          { filename: 'INV.pdf', contentType: 'application/pdf', content: 'JVBERi0=', bytes: 5 },
        ],
      }),
      { accessToken: 'at' },
      conn,
      ctx(f),
    )
    expect(r).toMatchObject({ ok: true, id: 'gmail:g1' })
    const raw = Buffer.from(JSON.parse(bodyOf(f.mock.calls[0])).raw, 'base64url').toString('utf8')
    expect(raw).toContain('To: "Cleo Client" <cleo@example.co.za>')
    expect(raw).toContain('filename="INV.pdf"')
    const down = fakeFetch([
      ['https://gmail.googleapis.com', () => Promise.reject(new Error('socket hang up'))],
    ])
    expect(await google.send(message(), { accessToken: 'at' }, conn, ctx(down))).toMatchObject({
      ok: false,
      retryable: false,
    })
  })

  it('renews an expired token, and reports when it cannot', async () => {
    const ok = fakeFetch([
      [
        'https://oauth2.googleapis.com/token',
        () => res(200, { access_token: 'new', expires_in: 3600 }),
      ],
    ])
    expect(
      await google.refresh!({ refreshToken: 'rt', accessToken: 'old' }, ctx(ok)),
    ).toMatchObject({ accessToken: 'new', refreshToken: 'rt' })
    const revoked = fakeFetch([
      ['https://oauth2.googleapis.com/token', () => res(400, { error: 'invalid_grant' })],
    ])
    expect(await google.refresh!({ refreshToken: 'rt' }, ctx(revoked))).toBeNull()
  })
})

describe('Outlook / Microsoft 365', () => {
  it('needs Mail.Send granted', async () => {
    const f = fakeFetch([
      [
        'https://graph.microsoft.com/v1.0/me',
        () => res(200, { id: 'u1', mail: 'Accounts@Umbane.co.za' }),
      ],
    ])
    expect(
      await microsoft.verify({ accessToken: 'at', scopes: ['User.Read'] }, {}, ctx(f), ''),
    ).toMatchObject({ ok: false })
    expect(
      await microsoft.verify(
        { accessToken: 'at', scopes: ['https://graph.microsoft.com/Mail.Send'] },
        {},
        ctx(f),
        '',
      ),
    ).toMatchObject({ ok: true, account: { accountLabel: 'accounts@umbane.co.za' } })
  })

  it('sends with the file attached; accepted means sent', async () => {
    const f = fakeFetch([['https://graph.microsoft.com/v1.0/me/sendMail', () => res(202)]])
    const r = await microsoft.send(
      message({
        attachments: [
          { filename: 'INV.pdf', contentType: 'application/pdf', content: 'JVBERi0=', bytes: 5 },
        ],
      }),
      { accessToken: 'at' },
      connection({ provider: 'microsoft', settings: { address: 'a@umbane.co.za' } }),
      ctx(f),
    )
    expect(r).toMatchObject({ ok: true, id: null, sender: 'a@umbane.co.za' })
    const sent = JSON.parse(bodyOf(f.mock.calls[0]))
    expect(sent.message.attachments[0]).toMatchObject({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'INV.pdf',
      contentBytes: 'JVBERi0=',
    })
  })
})

describe('SMS through Twilio', () => {
  const sid = `AC${'0'.repeat(32)}`

  it('connects an active account with a number it owns', async () => {
    const f = fakeFetch([
      [
        `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
        () => res(200, { status: 'active' }),
      ],
      [/IncomingPhoneNumbers\.json/, () => res(200, { incoming_phone_numbers: [{ sid: 'PN1' }] })],
    ])
    expect(
      await twilio.verify(
        { accountSid: sid, authToken: 't' },
        { from: '+27870000001' },
        ctx(f),
        '',
      ),
    ).toEqual({
      ok: true,
      account: {
        accountLabel: '+27870000001',
        accountId: sid,
        capabilities: ['direct_message', 'document_links', 'delivery_tracking'],
      },
    })
  })

  it('does not connect a number from someone else’s account', async () => {
    const f = fakeFetch([
      [
        `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
        () => res(200, { status: 'active' }),
      ],
      [/IncomingPhoneNumbers\.json/, () => res(200, { incoming_phone_numbers: [] })],
    ])
    expect(
      await twilio.verify(
        { accountSid: sid, authToken: 't' },
        { from: '+27870000001' },
        ctx(f),
        '',
      ),
    ).toMatchObject({ ok: false })
  })

  it('sends the text with the document link and asks for delivery reports', async () => {
    const f = fakeFetch([[/Messages\.json$/, () => res(201, { sid: 'SM1', status: 'queued' })]])
    const r = await twilio.send(
      message({ to: '+27825550101', documentUrl: 'https://crm.umbane.test/api/documents?t=abc' }),
      { accountSid: sid, authToken: 't' },
      connection({ provider: 'twilio', settings: { from: '+27870000001' } }),
      ctx(f),
    )
    expect(r).toMatchObject({ ok: true, id: 'twilio:SM1' })
    const sent = new URLSearchParams(bodyOf(f.mock.calls[0]))
    expect(sent.get('Body')).toBe(
      'Your invoice is attached.\n\nhttps://crm.umbane.test/api/documents?t=abc',
    )
    expect(sent.get('StatusCallback')).toBe(
      `https://crm.umbane.test/api/webhooks/messaging?provider=twilio&integration=${INTEG}`,
    )
  })

  it('checks Twilio’s signature', () => {
    const url = 'https://crm.umbane.test/api/webhooks/messaging?provider=twilio&integration=x'
    const params = new URLSearchParams({
      MessageStatus: 'delivered',
      MessageSid: 'SM1',
      AccountSid: sid,
    })
    const good = createHmac('sha1', 'token')
      .update(`${url}AccountSid${sid}MessageSidSM1MessageStatusdelivered`)
      .digest('base64')
    expect(twilioSignatureOk('token', url, params, good)).toBe(true)
    expect(twilioSignatureOk('token', url, params, 'forged')).toBe(false)
    expect(twilioSignatureOk('other', url, params, good)).toBe(false)
  })
})

describe('WhatsApp Business', () => {
  const conn = (settings: Record<string, string> = {}) =>
    connection({ provider: 'whatsapp', accountLabel: 'Umbane (+27 87 000 0001)', settings })

  it('reports and replies only with the app secret', async () => {
    const f = fakeFetch([
      [
        /graph\.facebook\.com\/v21\.0\/123\?/,
        () => res(200, { verified_name: 'Umbane', display_phone_number: '+27 87 000 0001' }),
      ],
    ])
    const without = await whatsapp.verify(
      { phoneNumberId: '123', accessToken: 'tok' },
      {},
      ctx(f),
      '',
    )
    expect(without.ok && without.account.capabilities).toEqual(['direct_message', 'attachments'])
    const withSecret = await whatsapp.verify(
      { phoneNumberId: '123', accessToken: 'tok', appSecret: 'sec' },
      {},
      ctx(f),
      '',
    )
    expect(withSecret.ok && withSecret.account.capabilities).toEqual([
      'direct_message',
      'attachments',
      'delivery_tracking',
      'receive_messages',
    ])
  })

  it('sends with the approved template when one is set', async () => {
    const f = fakeFetch([[/\/messages$/, () => res(200, { messages: [{ id: 'wamid.1' }] })]])
    const r = await whatsapp.send(
      message({ to: '+27835550102' }),
      { phoneNumberId: '123', accessToken: 'tok' },
      conn({ templateName: 'invoice_ready', templateLanguage: 'en' }),
      ctx(f),
    )
    expect(r).toMatchObject({ ok: true, id: 'whatsapp:wamid.1' })
    const sent = JSON.parse(bodyOf(f.mock.calls[0]))
    expect(sent).toMatchObject({
      to: '27835550102',
      type: 'template',
      template: { name: 'invoice_ready', language: { code: 'en' } },
    })
    expect(sent.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'Cleo Client',
      'Your invoice is attached.',
    ])
  })

  it('explains the 24-hour rule instead of failing silently', async () => {
    const f = fakeFetch([
      [
        /\/messages$/,
        () => res(400, { error: { code: 131047, message: 'Re-engagement message' } }),
      ],
    ])
    const r = await whatsapp.send(
      message({ to: '+27835550102' }),
      { phoneNumberId: '123', accessToken: 'tok' },
      conn(),
      ctx(f),
    )
    expect(r).toMatchObject({
      ok: false,
      retryable: false,
      error: expect.stringMatching(/24 hours/),
    })
  })

  it('will not drop a document a template cannot carry', async () => {
    const f = fakeFetch([])
    const r = await whatsapp.send(
      message({
        attachments: [
          { filename: 'INV.pdf', contentType: 'application/pdf', content: 'JVBERi0=', bytes: 5 },
        ],
      }),
      { phoneNumberId: '123', accessToken: 'tok' },
      conn({ templateName: 'invoice_ready', templateHeader: 'none' }),
      ctx(f),
    )
    expect(r).toMatchObject({ ok: false, retryable: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('uploads the document, then sends it', async () => {
    const f = fakeFetch([
      [/\/media$/, () => res(200, { id: 'media1' })],
      [/\/messages$/, () => res(200, { messages: [{ id: 'wamid.2' }] })],
    ])
    const r = await whatsapp.send(
      message({
        to: '+27835550102',
        attachments: [
          { filename: 'INV.pdf', contentType: 'application/pdf', content: 'JVBERi0=', bytes: 5 },
        ],
      }),
      { phoneNumberId: '123', accessToken: 'tok' },
      conn(),
      ctx(f),
    )
    expect(r).toMatchObject({ ok: true })
    expect(JSON.parse(bodyOf(f.mock.calls[1]))).toMatchObject({
      type: 'document',
      document: { id: 'media1', filename: 'INV.pdf' },
    })
  })

  it('checks Meta’s signature', () => {
    const body = '{"entry":[]}'
    const sig = `sha256=${createHmac('sha256', 'sec').update(body).digest('hex')}`
    expect(metaSignatureOk('sec', body, sig)).toBe(true)
    expect(metaSignatureOk('sec', body + ' ', sig)).toBe(false)
    expect(metaSignatureOk('sec', body, null)).toBe(false)
  })
})

describe('social posts', () => {
  it('Facebook: needs permission to post, then posts to the chosen Page with its link', async () => {
    const pages: [string | RegExp, Handler] = [
      /\/me\/accounts\?/,
      () =>
        res(200, {
          data: [
            { id: '111', name: 'Umbane Energy', access_token: 'pt', tasks: ['CREATE_CONTENT'] },
          ],
        }),
    ]
    expect(
      await facebook.verify(
        { userToken: 'u', scopes: ['pages_show_list'] },
        {},
        ctx(fakeFetch([pages])),
        '',
      ),
    ).toMatchObject({ ok: false })
    const v = await facebook.verify(
      { userToken: 'u', scopes: ['pages_manage_posts'] },
      {},
      ctx(fakeFetch([pages])),
      '',
    )
    expect(v).toMatchObject({
      ok: true,
      account: {
        accountLabel: 'Umbane Energy',
        accountId: '111',
        credentials: { pageToken: 'pt', pageId: '111' },
      },
    })
    const f = fakeFetch([[/\/111\/feed$/, () => res(200, { id: '111_222' })]])
    const r = await facebook.send(
      message({ to: null, linkUrl: 'https://umbane.co.za/meters' }),
      { pageId: '111', pageToken: 'pt' },
      connection({ provider: 'facebook', accountId: '111' }),
      ctx(f),
    )
    expect(r).toMatchObject({
      ok: true,
      id: 'facebook:111_222',
      externalUrl: 'https://www.facebook.com/111_222',
    })
    expect(new URLSearchParams(bodyOf(f.mock.calls[0])).get('link')).toBe(
      'https://umbane.co.za/meters',
    )
  })

  it('Instagram: refuses a post without an image; publishes in two steps with the permalink', async () => {
    const conn = connection({ provider: 'instagram', accountId: '900' })
    expect(
      await instagram.send(
        message({ imageUrl: null }),
        { igUserId: '900', pageToken: 'pt' },
        conn,
        ctx(fakeFetch([])),
      ),
    ).toMatchObject({ ok: false, retryable: false })
    const f = fakeFetch([
      [/\/900\/media$/, () => res(200, { id: 'container1' })],
      [/\/900\/media_publish$/, () => res(200, { id: 'media9' })],
      [/\/media9\?/, () => res(200, { permalink: 'https://www.instagram.com/p/abc/' })],
    ])
    const r = await instagram.send(
      message({ imageUrl: 'https://umbane.co.za/a.jpg' }),
      { igUserId: '900', pageToken: 'pt' },
      conn,
      ctx(f),
    )
    expect(r).toMatchObject({
      ok: true,
      id: 'instagram:media9',
      externalUrl: 'https://www.instagram.com/p/abc/',
    })
  })

  it('LinkedIn: needs w_member_social; posts as the member', async () => {
    const who = fakeFetch([
      [
        'https://api.linkedin.com/v2/userinfo',
        () => res(200, { sub: 'abc', name: 'Thandi Admin' }),
      ],
    ])
    expect(
      await linkedin.verify({ accessToken: 't', scopes: ['openid'] }, {}, ctx(who), ''),
    ).toMatchObject({ ok: false })
    expect(
      await linkedin.verify({ accessToken: 't', scopes: ['w_member_social'] }, {}, ctx(who), ''),
    ).toMatchObject({ ok: true, account: { accountId: 'abc' } })
    const f = fakeFetch([
      [
        'https://api.linkedin.com/v2/ugcPosts',
        () => res(201, {}, { 'x-restli-id': 'urn:li:share:7' }),
      ],
    ])
    const r = await linkedin.send(
      message({ linkUrl: 'https://umbane.co.za' }),
      { accessToken: 't' },
      connection({ provider: 'linkedin', accountId: 'abc' }),
      ctx(f),
    )
    expect(r).toMatchObject({
      ok: true,
      id: 'linkedin:urn:li:share:7',
      externalUrl: 'https://www.linkedin.com/feed/update/urn:li:share:7',
    })
    expect(JSON.parse(bodyOf(f.mock.calls[0])).author).toBe('urn:li:person:abc')
  })
})

// The server pieces -----------------------------------------------------------------------------------
const integrationRow = (over: Record<string, unknown> = {}) => ({
  id: INTEG,
  business_id: BIZ,
  provider: 'twilio',
  channel: 'sms',
  status: 'connected',
  account_label: '+27870000001',
  account_id: `AC${'0'.repeat(32)}`,
  capabilities: ['direct_message', 'document_links', 'delivery_tracking'],
  settings: { from: '+27870000001' },
  is_default: true,
  connected_by: ADMIN,
  connected_at: '2026-11-01T00:00:00Z',
  last_checked_at: null,
  last_error: null,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
})
const secretRow = (credentials: Record<string, unknown>, id = INTEG) => ({
  integration_id: id,
  business_id: BIZ,
  ciphertext: encryptSecrets(credentials, KEY, id),
})
const people = [
  {
    id: ADMIN,
    business_id: BIZ,
    role: 'administrator',
    is_active: true,
    email: 'admin@umbane.test',
    full_name: 'Ada Admin',
  },
  {
    id: STAFF,
    business_id: BIZ,
    role: 'staff',
    is_active: true,
    email: 'staff@umbane.test',
    full_name: 'Sam Staff',
  },
  {
    id: OTHER_ADMIN,
    business_id: OTHER,
    role: 'administrator',
    is_active: true,
    email: 'o@x.test',
    full_name: 'Olu',
  },
]
const users = {
  'admin-token': { id: ADMIN },
  'staff-token': { id: STAFF },
  'other-token': { id: OTHER_ADMIN },
}
const post = (url: string, token: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('choosing how a message goes out', () => {
  it('uses the business’s default connection, then the built-in email sender', async () => {
    const { db } = fakeDb({
      integrations: [integrationRow()],
      integration_secrets: [secretRow({ accountSid: 'AC', authToken: 't' })],
    })
    const deps = { db: db as never, key: KEY, ctx: ctx(fakeFetch([])) }
    expect(await routeFor(deps, null, BIZ, 'sms', null)).toMatchObject({
      provider: 'twilio',
      integrationId: INTEG,
    })
    const builtIn = { from: 'Umbane <a@b.co>', send: vi.fn() }
    expect(await routeFor(deps, builtIn, BIZ, 'email', null)).toMatchObject({
      provider: 'resend',
      integrationId: null,
    })
    expect(await routeFor(deps, null, BIZ, 'email', null)).toMatchObject({
      reason: 'not_configured',
    })
    expect(await routeFor(deps, null, OTHER, 'sms', INTEG)).toMatchObject({ reason: 'unavailable' })
  })

  it('marks a connection that can no longer sign in, and does not use it', async () => {
    const row = integrationRow({
      provider: 'google',
      channel: 'email',
      capabilities: ['send_email', 'attachments'],
    })
    const { db, rows } = fakeDb({
      integrations: [row],
      integration_secrets: [secretRow({ accessToken: 'old', refreshToken: 'rt', expiresAt: 1 })],
    })
    const f = fakeFetch([
      ['https://oauth2.googleapis.com/token', () => res(400, { error: 'invalid_grant' })],
    ])
    const r = await routeFor({ db: db as never, key: KEY, ctx: ctx(f) }, null, BIZ, 'email', INTEG)
    expect(r).toMatchObject({ reason: 'unavailable' })
    expect(rows('integrations')[0]).toMatchObject({ status: 'error', is_default: false })
  })
})

describe('delivering through a connection', () => {
  const claimed = (over: Record<string, unknown> = {}) => ({
    id: MSG,
    business_id: BIZ,
    channel: 'sms',
    integration_id: INTEG,
    recipient: '+27825550101',
    recipient_name: 'Sindi',
    subject: null,
    body: 'Your invoice:',
    purpose: 'transactional',
    attachment_path: null,
    attachment_name: null,
    document_link_id: 'd1',
    ...over,
  })

  function setup(fetchRoutes: [string | RegExp, Handler][], claim = claimed()) {
    const fake = fakeDb(
      {
        integrations: [integrationRow()],
        integration_secrets: [secretRow({ accountSid: `AC${'0'.repeat(32)}`, authToken: 't' })],
        communication_logs: [
          {
            id: MSG,
            business_id: BIZ,
            channel: claim.channel,
            integration_id: claim.integration_id,
          },
        ],
        document_links: [{ id: 'd1', token: 'f'.repeat(48) }],
      },
      { rpc: { claim_message: () => ({ data: [claim], error: null }) } },
    )
    const f = fakeFetch(fetchRoutes)
    const config = {
      from: '',
      send: vi.fn(),
      integrations: { db: fake.db as never, key: KEY, ctx: ctx(f) },
    }
    return { ...fake, f, config }
  }

  it('sends an SMS with its private document link and records the provider and sender', async () => {
    const { db, rpcCalls, f, config } = setup([
      [/Messages\.json$/, () => res(201, { sid: 'SM9', status: 'queued' })],
    ])
    expect(await deliverMessage(db as unknown as AdminClient, config, MSG)).toBe('sent')
    expect(new URLSearchParams(bodyOf(f.mock.calls[0])).get('Body')).toContain(
      `/api/documents?t=${'f'.repeat(48)}`,
    )
    expect(rpcCalls.find((c) => c.fn === 'record_message_result')?.args).toMatchObject({
      p_ok: true,
      p_provider_message_id: 'twilio:SM9',
      p_provider: 'twilio',
      p_sender: '+27870000001',
      p_response: { status: 'queued' },
    })
  })

  it('keeps a message waiting, without using a try, when nothing can send it yet', async () => {
    const { db, rpcCalls, config } = setup([], claimed({ channel: 'email', integration_id: null }))
    expect(await deliverMessage(db as unknown as AdminClient, config, MSG)).toBe('skipped')
    expect(rpcCalls.find((c) => c.fn === 'claim_message')).toBeUndefined()
  })

  it('records a provider refusal as a failure that waits for a person', async () => {
    const { db, rpcCalls, config } = setup([
      [/Messages\.json$/, () => res(400, { code: 21211, message: 'Invalid To' })],
    ])
    expect(await deliverMessage(db as unknown as AdminClient, config, MSG)).toBe('failed')
    expect(rpcCalls.find((c) => c.fn === 'record_message_result')?.args).toMatchObject({
      p_ok: false,
      p_retryable: false,
      p_error: 'Twilio 400 21211: Invalid To',
    })
  })

  it('marks the connection when the provider refuses its credentials', async () => {
    const { db, rows, config } = setup([
      [/Messages\.json$/, () => res(401, { code: 20003, message: 'Authenticate' })],
    ])
    await deliverMessage(db as unknown as AdminClient, config, MSG)
    expect(rows('integrations')[0]).toMatchObject({ status: 'error' })
  })
})

describe('Settings → Integrations endpoint', () => {
  const handler = (seed: Record<string, Record<string, unknown>[]> = {}, e = env()) => {
    const fake = fakeDb({ profiles: people, ...seed }, { auth: { users } })
    return { ...fake, handle: createIntegrationsHandler({ env: e, admin: () => fake.db as never }) }
  }

  it('shows the team what is connected, without credentials or webhook secrets', async () => {
    const { handle } = handler({
      integrations: [integrationRow()],
      integration_secrets: [secretRow({ authToken: 'secret-token' })],
    })
    const r = await handle(
      new Request('https://crm/api/integrations', {
        headers: { authorization: 'Bearer staff-token' },
      }),
    )
    const body = await read(r)
    expect(r.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain('secret-token')
    expect(body.connections[0]).toMatchObject({
      provider: 'twilio',
      status: 'connected',
      webhook: null,
    })
    expect(body.providers.find((p: { key: string }) => p.key === 'microsoft')).toMatchObject({
      ready: false,
      missing: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    })
  })

  it('lets only administrators change connections', async () => {
    const { handle } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'staff-token', {
        action: 'connect',
        provider: 'resend',
      }),
    )
    expect(r.status).toBe(403)
  })

  it('connects a provider only after it confirms the credentials, and stores them encrypted', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch([
        [
          'https://api.resend.com/domains',
          () => res(200, { data: [{ name: 'umbane.co.za', status: 'verified' }] }),
        ],
      ]),
    )
    const { handle, rows } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', {
        action: 'connect',
        provider: 'resend',
        fields: { apiKey: 're_live_123456789' },
        settings: { fromAddress: 'accounts@umbane.co.za' },
      }),
    )
    expect(r.status).toBe(200)
    const saved = rows('integrations')[0]
    expect(saved).toMatchObject({
      provider: 'resend',
      status: 'connected',
      capabilities: ['send_email', 'attachments'],
      is_default: true,
    })
    const secret = rows('integration_secrets')[0]
    expect(String(secret.ciphertext)).not.toContain('re_live_123456789')
    expect(decryptSecrets(String(secret.ciphertext), KEY, String(saved.id))).toEqual({
      apiKey: 're_live_123456789',
    })
    expect(rows('audit_logs')[0]).toMatchObject({
      action: 'integration.connected',
      actor_id: ADMIN,
    })
  })

  it('saves nothing when the provider refuses, and explains why', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch([['https://api.resend.com/domains', () => res(401, { name: 'validation_error' })]]),
    )
    const { handle, rows } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', {
        action: 'connect',
        provider: 'resend',
        fields: { apiKey: 're_live_123456789' },
        settings: { fromAddress: 'accounts@umbane.co.za' },
      }),
    )
    expect(r.status).toBe(422)
    expect((await read(r)).message).toMatch(/refused/)
    expect(rows('integrations')).toHaveLength(0)
    expect(rows('integration_secrets')).toHaveLength(0)
  })

  it('checks what is typed before asking the provider', async () => {
    const { handle } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', {
        action: 'connect',
        provider: 'twilio',
        fields: { accountSid: 'nope', authToken: '' },
        settings: {},
      }),
    )
    expect(r.status).toBe(422)
    expect(Object.keys((await read(r)).fields)).toEqual(['accountSid', 'authToken', 'from'])
  })

  it('starts a sign-in with a single-use state and PKCE', async () => {
    const { handle, rows } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', {
        action: 'oauth_start',
        provider: 'google',
      }),
    )
    const url = new URL((await read(r)).url)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://crm.umbane.test/api/integrations/callback',
    )
    const state = rows('integration_oauth_states')[0]
    expect(state).toMatchObject({
      business_id: BIZ,
      provider: 'google',
      created_by: ADMIN,
      state_hash: sha256Hex(url.searchParams.get('state')!),
    })
  })

  it('will not start a sign-in the server is not set up for', async () => {
    const { handle } = handler()
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', {
        action: 'oauth_start',
        provider: 'linkedin',
      }),
    )
    expect(r.status).toBe(503)
    expect((await read(r)).missing).toEqual(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'])
  })

  it('disconnects: deletes the credentials and stops using it', async () => {
    const { handle, rows } = handler({
      integrations: [integrationRow()],
      integration_secrets: [secretRow({ accountSid: 'AC', authToken: 't' })],
    })
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', { action: 'disconnect', id: INTEG }),
    )
    expect(r.status).toBe(200)
    expect(rows('integration_secrets')).toHaveLength(0)
    expect(rows('integrations')[0]).toMatchObject({
      status: 'disconnected',
      is_default: false,
      capabilities: [],
    })
  })

  it('never touches another business’s connection', async () => {
    const { handle } = handler({ integrations: [integrationRow()] })
    const r = await handle(
      post('https://crm/api/integrations', 'other-token', { action: 'disconnect', id: INTEG }),
    )
    expect(r.status).toBe(404)
  })

  it('a failed test marks the connection as needing attention', async () => {
    vi.stubGlobal('fetch', fakeFetch([[/Accounts\/.*\.json$/, () => res(401, {})]]))
    const { handle, rows } = handler({
      integrations: [integrationRow()],
      integration_secrets: [secretRow({ accountSid: `AC${'0'.repeat(32)}`, authToken: 't' })],
    })
    const r = await handle(
      post('https://crm/api/integrations', 'admin-token', { action: 'test', id: INTEG }),
    )
    expect(r.status).toBe(422)
    expect(rows('integrations')[0]).toMatchObject({ status: 'error', is_default: false })
  })
})

describe('signing in with a provider (OAuth callback)', () => {
  const state = 'state-abc'
  const seed = (over: Record<string, unknown> = {}) => ({
    profiles: people,
    integration_oauth_states: [
      {
        state_hash: sha256Hex(state),
        business_id: BIZ,
        provider: 'google',
        created_by: ADMIN,
        code_verifier: 'v'.repeat(43),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...over,
      },
    ],
  })
  const google200: [string | RegExp, Handler][] = [
    [
      /^https:\/\/oauth2\.googleapis\.com\/token$/,
      () =>
        res(200, {
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/gmail.send',
        }),
    ],
    [
      'https://openidconnect.googleapis.com/v1/userinfo',
      () => res(200, { sub: '42', email: 'accounts@umbane.co.za' }),
    ],
    [
      'https://oauth2.googleapis.com/tokeninfo',
      () => res(200, { scope: 'openid email https://www.googleapis.com/auth/gmail.send' }),
    ],
  ]

  it('connects once the provider confirms, and the state cannot be used again', async () => {
    vi.stubGlobal('fetch', fakeFetch(google200))
    const fake = fakeDb(seed())
    const handle = createCallbackHandler({ env: env(), admin: () => fake.db as never })
    const r = await handle(
      new Request(`https://crm/api/integrations/callback?code=c1&state=${state}`),
    )
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe(
      'https://crm.umbane.test/settings/integrations?connected=google',
    )
    expect(fake.rows('integrations')[0]).toMatchObject({
      provider: 'google',
      status: 'connected',
      account_label: 'accounts@umbane.co.za',
      capabilities: ['send_email', 'attachments'],
    })
    const again = await handle(
      new Request(`https://crm/api/integrations/callback?code=c1&state=${state}`),
    )
    expect(again.headers.get('location')).toContain('error=expired')
  })

  it('refuses an expired state, or one started by someone who is no longer an administrator', async () => {
    const expired = fakeDb(seed({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    const r1 = await createCallbackHandler({ env: env(), admin: () => expired.db as never })(
      new Request(`https://crm/cb?code=c&state=${state}`),
    )
    expect(r1.headers.get('location')).toContain('error=expired')
    const demoted = fakeDb({
      ...seed(),
      profiles: people.map((p) => (p.id === ADMIN ? { ...p, role: 'staff' } : p)),
    })
    const r2 = await createCallbackHandler({ env: env(), admin: () => demoted.db as never })(
      new Request(`https://crm/cb?code=c&state=${state}`),
    )
    expect(r2.headers.get('location')).toContain('error=forbidden')
    expect(demoted.rows('integrations')).toHaveLength(0)
  })

  it('does not connect when the person did not grant sending', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch([
        google200[0],
        google200[1],
        ['https://oauth2.googleapis.com/tokeninfo', () => res(200, { scope: 'openid email' })],
      ]),
    )
    const fake = fakeDb(seed())
    const r = await createCallbackHandler({ env: env(), admin: () => fake.db as never })(
      new Request(`https://crm/cb?code=c&state=${state}`),
    )
    expect(r.headers.get('location')).toContain('error=verify')
    expect(fake.rows('integrations')).toHaveLength(0)
  })
})

describe('team invitations by email', () => {
  const INV = 'e1000000-0000-4000-8000-000000000001'
  const invitation = (over: Record<string, unknown> = {}) => ({
    id: INV,
    business_id: BIZ,
    email: 'nomvula@example.co.za',
    full_name: 'Nomvula New',
    role: 'staff',
    status: 'pending',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    send_count: 0,
    auth_user_id: null,
    invited_by: ADMIN,
    ...over,
  })
  const link = {
    data: {
      properties: { action_link: 'https://x.supabase.co/auth/v1/verify?token=t1&type=invite' },
      user: { id: 'u-new', email_confirmed_at: null },
    },
    error: null,
  }

  function setup(
    seed: Record<string, Record<string, unknown>[]> = {},
    generateLink = () => link,
    e = env({ resendKey: 're_key', emailFrom: 'Umbane <hello@umbane.co.za>' }),
  ) {
    const fake = fakeDb(
      {
        profiles: people,
        businesses: [{ id: BIZ, name: 'Umbane Energy' }],
        staff_invitations: [invitation()],
        ...seed,
      },
      {
        auth: {
          users,
          generateLink,
          getUserById: () => ({
            data: { user: { id: 'u-new', email_confirmed_at: null } },
            error: null,
          }),
        },
      },
    )
    const sent: unknown[] = []
    const config = (cfgEnv: ServerEnv, admin?: unknown) => ({
      ...deliveryConfig(cfgEnv, admin),
      send: vi.fn(async (email: unknown) => {
        sent.push(email)
        return { ok: true as const, id: 're_inv1' }
      }),
    })
    return {
      ...fake,
      sent,
      handle: createInvitationsHandler({ env: e, admin: () => fake.db as never, config }),
    }
  }

  it('sends the Supabase invitation link through the business’s email and records it', async () => {
    const { handle, rows, sent } = setup()
    const r = await handle(
      post('https://crm/api/team/invitations', 'admin-token', {
        action: 'send',
        invitationId: INV,
      }),
    )
    expect(await read(r)).toMatchObject({ state: 'sent' })
    expect(sent[0]).toMatchObject({
      to: 'nomvula@example.co.za',
      subject: 'You are invited to join Umbane Energy on Umbane',
      idempotencyKey: `invitation:${INV}:1`,
    })
    expect((sent[0] as { text: string }).text).toContain(
      'https://x.supabase.co/auth/v1/verify?token=t1',
    )
    expect(rows('staff_invitations')[0]).toMatchObject({
      delivery_status: 'sent',
      send_count: 1,
      auth_user_id: 'u-new',
    })
    const log = rows('communication_logs')[0]
    expect(log).toMatchObject({
      invitation_id: INV,
      status: 'sent',
      recipient: 'nomvula@example.co.za',
      provider: 'resend',
    })
    expect(String(log.body)).not.toContain('token=t1')
  })

  it('records a failure, and the link can still be copied', async () => {
    const { handle, rows } = setup({}, () => link, env())
    const r = await handle(
      post('https://crm/api/team/invitations', 'admin-token', {
        action: 'send',
        invitationId: INV,
      }),
    )
    expect(await read(r)).toMatchObject({ state: 'failed', canCopyLink: true })
    expect(rows('staff_invitations')[0]).toMatchObject({ delivery_status: 'failed' })
    const copied = await handle(
      post('https://crm/api/team/invitations', 'admin-token', {
        action: 'link',
        invitationId: INV,
      }),
    )
    expect(await read(copied)).toMatchObject({ link: link.data.properties.action_link })
    expect(rows('audit_logs')[0]).toMatchObject({ action: 'invitation.link_copied' })
  })

  it('uses a sign-in link for an account that exists but never joined, and refuses a member', async () => {
    const calls: string[] = []
    const { handle } = setup({}, ((args: Record<string, unknown>) => {
      calls.push(String(args.type))
      return args.type === 'invite'
        ? { data: null, error: { message: 'already registered' } }
        : {
            data: {
              properties: { action_link: 'https://x/magic' },
              user: { id: STAFF, email_confirmed_at: '2026-01-01' },
            },
            error: null,
          }
    }) as never)
    const r = await handle(
      post('https://crm/api/team/invitations', 'admin-token', {
        action: 'send',
        invitationId: INV,
      }),
    )
    expect(calls).toEqual(['invite', 'magiclink'])
    expect(r.status).toBe(409)
  })

  it('cancelling removes the unused sign-in account', async () => {
    const { handle, rows, deletedUsers } = setup({
      staff_invitations: [invitation({ auth_user_id: 'u-new' })],
    })
    await handle(
      post('https://crm/api/team/invitations', 'admin-token', {
        action: 'cancel',
        invitationId: INV,
      }),
    )
    expect(rows('staff_invitations')[0]).toMatchObject({ status: 'cancelled' })
    expect(deletedUsers).toEqual(['u-new'])
  })

  it('is for administrators of the same business only', async () => {
    const { handle } = setup()
    expect(
      (
        await handle(
          post('https://crm/api/team/invitations', 'staff-token', {
            action: 'send',
            invitationId: INV,
          }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handle(
          post('https://crm/api/team/invitations', 'other-token', {
            action: 'send',
            invitationId: INV,
          }),
        )
      ).status,
    ).toBe(404)
  })

  it('will not send an invitation that was accepted or cancelled', async () => {
    const { handle } = setup({ staff_invitations: [invitation({ status: 'accepted' })] })
    expect(
      (
        await handle(
          post('https://crm/api/team/invitations', 'admin-token', {
            action: 'send',
            invitationId: INV,
          }),
        )
      ).status,
    ).toBe(409)
  })
})

describe('delivery reports and replies (SMS, WhatsApp)', () => {
  const url = (p: string) =>
    `https://crm.umbane.test/api/webhooks/messaging?provider=${p}&integration=${INTEG}`

  it('records a signed Twilio report and refuses an unsigned one', async () => {
    const fake = fakeDb({
      integrations: [integrationRow()],
      integration_secrets: [secretRow({ accountSid: 'AC', authToken: 'tok' })],
    })
    const handle = createMessagingWebhookHandler({ env: env(), admin: () => fake.db as never })
    const body = new URLSearchParams({ MessageSid: 'SM9', MessageStatus: 'delivered' })
    const sig = createHmac('sha1', 'tok')
      .update(`${url('twilio')}MessageSidSM9MessageStatusdelivered`)
      .digest('base64')
    const bad = await handle(
      new Request(url('twilio'), {
        method: 'POST',
        body: body.toString(),
        headers: { 'x-twilio-signature': 'forged' },
      }),
    )
    expect(bad.status).toBe(403)
    const good = await handle(
      new Request(url('twilio'), {
        method: 'POST',
        body: body.toString(),
        headers: { 'x-twilio-signature': sig },
      }),
    )
    expect(good.status).toBe(200)
    expect(fake.rpcCalls.filter((c) => c.fn !== 'rate_limit_hit')[0]).toMatchObject({
      fn: 'record_provider_event',
      args: { p_provider_message_id: 'twilio:SM9', p_event: 'message.delivered' },
    })
  })

  it('answers Meta’s check with the connection’s token, and records statuses and replies', async () => {
    const row = integrationRow({
      provider: 'whatsapp',
      channel: 'whatsapp',
      capabilities: ['direct_message', 'delivery_tracking', 'receive_messages'],
    })
    const fake = fakeDb({
      integrations: [row],
      integration_secrets: [secretRow({ accessToken: 'tok', appSecret: 'sec' })],
    })
    const handle = createMessagingWebhookHandler({ env: env(), admin: () => fake.db as never })
    const token = webhookVerifyToken(INTEG, KEY)
    const ok = await handle(
      new Request(
        `${url('whatsapp')}&hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`,
      ),
    )
    expect(await ok.text()).toBe('42')
    expect(
      (
        await handle(
          new Request(
            `${url('whatsapp')}&hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`,
          ),
        )
      ).status,
    ).toBe(403)
    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1800000000' }],
                messages: [
                  {
                    id: 'wamid.in',
                    from: '27835550102',
                    type: 'text',
                    text: { body: 'Thanks!' },
                    timestamp: '1800000001',
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    const sig = `sha256=${createHmac('sha256', 'sec').update(payload).digest('hex')}`
    const r = await handle(
      new Request(url('whatsapp'), {
        method: 'POST',
        body: payload,
        headers: { 'x-hub-signature-256': sig },
      }),
    )
    expect(await read(r)).toEqual({ recorded: 2 })
    const calls = fake.rpcCalls.filter((c) => c.fn !== 'rate_limit_hit')
    expect(calls.map((c) => c.fn)).toEqual(['record_provider_event', 'log_inbound_message'])
    expect(calls[1].args).toMatchObject({
      p_from: '27835550102',
      p_body: 'Thanks!',
      p_provider_message_id: 'whatsapp:wamid.in',
    })
  })
})

describe('private document links', () => {
  const token = 'a'.repeat(48)
  const linkRow = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    bucket: 'message-attachments',
    path: `${BIZ}/m/INV.pdf`,
    file_name: 'INV.pdf',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    opened_count: 0,
    token,
    ...over,
  })

  it('opens a short-lived download and counts the visit', async () => {
    const fake = fakeDb(
      { document_links: [linkRow()] },
      {
        storage: {
          createSignedUrl: () => ({
            data: { signedUrl: 'https://x.supabase.co/storage/signed' },
            error: null,
          }),
        },
      },
    )
    const r = await createDocumentsHandler({ env: env(), admin: () => fake.db as never })(
      new Request(`https://crm/api/documents?t=${token}`),
    )
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://x.supabase.co/storage/signed')
    expect(fake.rows('document_links')[0]).toMatchObject({ opened_count: 1 })
  })

  it.each([
    ['expired', linkRow({ expires_at: new Date(Date.now() - 1000).toISOString() }), token],
    ['revoked', linkRow({ revoked_at: new Date().toISOString() }), token],
    ['unknown', linkRow(), 'b'.repeat(48)],
    ['malformed', linkRow(), '../etc'],
  ])('a %s link shows nothing about the document', async (_label, row, t) => {
    const fake = fakeDb(
      { document_links: [row] },
      { storage: { createSignedUrl: () => ({ data: { signedUrl: 'https://x' }, error: null }) } },
    )
    const r = await createDocumentsHandler({ env: env(), admin: () => fake.db as never })(
      new Request(`https://crm/api/documents?t=${t}`),
    )
    expect(r.status).toBe(410)
    expect(await r.text()).not.toContain('INV.pdf')
  })
})

describe('sending one Share to several platforms', () => {
  const M2 = 'c0000000-0000-4000-8000-000000000002'
  it('sends each message in the caller’s business and reports each result', async () => {
    const fake = fakeDb(
      {
        profiles: people,
        communication_logs: [
          { id: MSG, business_id: BIZ, status: 'sent', error: null },
          { id: M2, business_id: BIZ, status: 'failed', error: 'Twilio 400' },
        ],
      },
      { auth: { users } },
    )
    const handle = createSendHandler({
      env: env({ resendKey: 're', emailFrom: 'a@b.co' }),
      admin: () => fake.db as never,
      config: () => ({ from: 'a@b.co', send: vi.fn() }),
    })
    const r = await handle(
      post('https://crm/api/messages/send', 'staff-token', { messageIds: [MSG, M2] }),
    )
    const body = await read(r)
    expect(body.results.map((x: { status: string }) => x.status)).toEqual(['sent', 'failed'])
  })

  it('refuses a message from another business, and more than ten at once', async () => {
    const fake = fakeDb(
      { profiles: people, communication_logs: [{ id: MSG, business_id: OTHER }] },
      { auth: { users } },
    )
    const handle = createSendHandler({
      env: env({ resendKey: 're', emailFrom: 'a@b.co' }),
      admin: () => fake.db as never,
      config: () => ({ from: 'a@b.co', send: vi.fn() }),
    })
    expect(
      (await handle(post('https://crm/api/messages/send', 'staff-token', { messageIds: [MSG] })))
        .status,
    ).toBe(404)
    const many = Array.from(
      { length: 11 },
      (_, i) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    expect(
      (await handle(post('https://crm/api/messages/send', 'staff-token', { messageIds: many })))
        .status,
    ).toBe(400)
  })
})
