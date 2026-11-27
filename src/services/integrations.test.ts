import { describe, expect, it, vi } from 'vitest'
import integrations from '../../supabase/migrations/20261201000017_integrations.sql?raw'
import calendar from '../../supabase/migrations/20261202000018_search_calendar.sql?raw'
import {
  CAPABILITIES,
  CONNECTABLE,
  PROVIDERS,
  fieldProblem,
  providerInfo,
} from '@shared/integrations'
import { callbackNotice, connectWithKeys, getIntegrations } from './integrations'
import { e164, getMessageStates, queueMessage, reachabilityOf, sendMessages } from './share'
import { invitationAction } from './team'
import type { ServerApi } from './messages'

const server = (
  status: number,
  body: unknown,
  token: string | null = 'tok',
): ServerApi & { fetch: ReturnType<typeof vi.fn> } => ({
  token: async () => token,
  fetch: vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ),
})

describe('the provider registry', () => {
  it('matches the providers and capabilities the database allows', () => {
    // The latest definitions of the provider and capability checks.
    const migration = integrations + calendar
    for (const key of CONNECTABLE) expect(migration).toContain(`'${key}'`)
    for (const c of CAPABILITIES) expect(migration).toContain(`'${c}'`)
    expect(migration).not.toMatch(/provider in \([^)]*'tiktok'/)
  })

  it('declares only real capabilities, and every field pattern is a valid expression', () => {
    for (const p of PROVIDERS) {
      for (const c of p.capabilities) expect(CAPABILITIES).toContain(c)
      for (const f of [...(p.fields ?? []), ...(p.settings ?? [])])
        if (f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow()
    }
    expect(providerInfo('instagram')?.needsImage).toBe(true)
    expect(providerInfo('tiktok')?.connect).toBe('unavailable')
  })

  it('checks typed values against the provider’s rules', () => {
    const sid = providerInfo('twilio')!.fields!.find((f) => f.name === 'accountSid')!
    expect(fieldProblem(sid, '')).toBe('Enter the account sid.')
    expect(fieldProblem(sid, 'AC123')).toMatch(/valid/)
    expect(fieldProblem(sid, `AC${'a'.repeat(32)}`)).toBeNull()
  })
})

describe('who can be reached where', () => {
  it('reads South African numbers like the database does', () => {
    expect(e164('082 555 0101')).toBe('+27825550101')
    expect(e164('27825550101')).toBe('+27825550101')
    expect(e164('+44 20 7946 0958')).toBe('+442079460958')
    expect(e164('12345')).toBeNull()
  })

  it('names what blocks each channel', () => {
    expect(
      reachabilityOf(
        { email: 'a@b.co', phone: '0825550101' },
        { isCustomer: true, smsOptOut: true },
      ).blocked,
    ).toEqual({
      sms: 'Asked not to receive SMS',
      whatsapp: 'Has not agreed to WhatsApp',
    })
    expect(reachabilityOf({ email: null, phone: null }).blocked).toMatchObject({
      email: 'No email address on file',
      sms: 'No mobile number on file',
    })
    expect(
      reachabilityOf({ email: 'a@b.co', phone: null }, { suppressed: true }).blocked.email,
    ).toBe('Email to this address bounced')
  })
})

describe('sharing', () => {
  it('queues through the database with the recipient on file and the idempotency key', async () => {
    const rpc = vi.fn(async () => ({ data: 'm1', error: null }))
    const r = await queueMessage(
      {
        channel: 'sms',
        integrationId: 'i1',
        recipient: { kind: 'customer', id: 'c1', name: 'N' },
        subject: null,
        body: 'Hi',
        purpose: 'transactional',
        shareId: 's1',
        idempotencyKey: 's1:sms:customer:c1',
      },
      { rpc, from: vi.fn() } as never,
    )
    expect(r).toEqual({ ok: true, data: { id: 'm1' } })
    expect(rpc).toHaveBeenCalledWith(
      'queue_message',
      expect.objectContaining({
        p_channel: 'sms',
        p_integration_id: 'i1',
        p_customer_id: 'c1',
        p_address: null,
        p_share_id: 's1',
        p_idempotency_key: 's1:sms:customer:c1',
      }),
    )
  })

  it('maps a refusal to words', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23514', message: 'message_no_whatsapp_consent' },
    }))
    const r = await queueMessage(
      {
        channel: 'whatsapp',
        integrationId: null,
        recipient: { kind: 'customer', id: 'c1', name: 'N' },
        subject: null,
        body: 'Hi',
        purpose: 'transactional',
        shareId: 's',
        idempotencyKey: 'sxxxxxxx',
      },
      { rpc, from: vi.fn() } as never,
    )
    expect(r.ok === false && r.error.message).toMatch(/not agreed to WhatsApp/)
  })

  it('sends all of a share in one call, and keeps them queued if the server cannot be reached', async () => {
    const ok = server(200, { results: [] })
    expect(await sendMessages(['a', 'b'], ok)).toBe('sent')
    expect(JSON.parse(String(ok.fetch.mock.calls[0][1].body))).toEqual({ messageIds: ['a', 'b'] })
    expect(
      await sendMessages(['a'], {
        token: async () => 'x',
        fetch: async () => {
          throw new Error('offline')
        },
      }),
    ).toBe('queued')
  })

  it('reads each message’s state from the history', async () => {
    const from = vi.fn(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: 'a', status: 'bounced', error: 'gone', external_url: null },
            { id: 'b', status: 'delivered', error: null, external_url: null },
          ],
          error: null,
        }),
      }),
    }))
    const r = await getMessageStates(['a', 'b'], { from, rpc: vi.fn() } as never)
    expect(r.ok && r.data).toEqual({
      a: { state: 'failed', error: 'gone', externalUrl: null },
      b: { state: 'delivered', error: null, externalUrl: null },
    })
  })
})

describe('Settings → Integrations service', () => {
  it('reads the overview with the signed-in person’s token', async () => {
    const s = server(200, {
      providers: [],
      connections: [],
      builtInEmail: { ready: true, from: 'a@b.co' },
      redirectUri: null,
    })
    expect((await getIntegrations(s)).ok).toBe(true)
    expect(s.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('passes on the provider’s reason and the fields it rejected', async () => {
    const r = await connectWithKeys(
      'twilio',
      {},
      {},
      server(422, { error: 'invalid', fields: { accountSid: 'Enter the account sid.' } }),
    )
    expect(r.ok).toBe(false)
    expect(r.fields).toEqual({ accountSid: 'Enter the account sid.' })
    const refused = await connectWithKeys(
      'resend',
      {},
      {},
      server(422, {
        error: 'verification_failed',
        message: 'umbane.co.za is not verified in Resend yet.',
      }),
    )
    expect(refused.ok === false && refused.error.message).toBe(
      'umbane.co.za is not verified in Resend yet.',
    )
    const forbidden = await connectWithKeys('resend', {}, {}, server(403, { error: 'forbidden' }))
    expect(forbidden.ok === false && forbidden.error.message).toBe(
      'Only administrators can change integrations.',
    )
  })

  it('explains the sign-in result in words', () => {
    const label = (k: string) => (k === 'google' ? 'Gmail' : k)
    expect(callbackNotice(new URLSearchParams('connected=google'), label)).toEqual({
      tone: 'success',
      text: 'Gmail is connected.',
    })
    expect(callbackNotice(new URLSearchParams('error=denied&provider=google'), label)?.text).toBe(
      'Gmail was not connected: permission was not given.',
    )
    expect(callbackNotice(new URLSearchParams(''), label)).toBeNull()
  })
})

describe('team invitations service', () => {
  it('sends, copies links and cancels through the server', async () => {
    expect(
      await invitationAction('send', 'i1', server(200, { state: 'sent', via: 'Gmail (hr@x.co)' })),
    ).toEqual({ ok: true, data: { state: 'sent', via: 'Gmail (hr@x.co)' } })
    expect(await invitationAction('link', 'i1', server(200, { link: 'https://x/verify' }))).toEqual(
      { ok: true, data: { state: 'link', link: 'https://x/verify' } },
    )
    expect(
      await invitationAction(
        'send',
        'i1',
        server(200, { state: 'failed', error: 'No email account.' }),
      ),
    ).toEqual({ ok: true, data: { state: 'failed', error: 'No email account.' } })
    const closed = await invitationAction('send', 'i1', server(409, { error: 'closed' }))
    expect(closed.ok === false && closed.error.message).toMatch(/already accepted or cancelled/)
    expect((await invitationAction('cancel', 'i1', server(200, {}, null))).ok).toBe(false)
  })
})
