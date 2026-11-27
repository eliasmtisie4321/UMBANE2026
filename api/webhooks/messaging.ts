import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptionKey, webhookVerifyToken } from '../_lib/integrations/crypto.js'
import {
  metaSignatureOk,
  twilioCallbackUrl,
  twilioSignatureOk,
} from '../_lib/integrations/messaging.js'
import { loadIntegration, loadSecrets } from '../_lib/integrations/store.js'
import {
  adminClient,
  clientAddress,
  json,
  RATE_LIMITS,
  readEnv,
  tooManyRequests,
  withinRateLimit,
  type ServerEnv,
} from '../_lib/server.js'
import { str } from '../_lib/integrations/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
}

const TWILIO_EVENTS: Record<string, string> = {
  delivered: 'message.delivered',
  undelivered: 'message.failed',
  failed: 'message.failed',
}

/**
 * /api/webhooks/messaging?provider=twilio|whatsapp&integration=<id>
 * Delivery reports (and, for WhatsApp, customers' replies) for one connection. Every request must
 * carry the provider's signature made with that connection's own secret; anything else is refused.
 */
export function createMessagingWebhookHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    const { env } = deps
    const key = encryptionKey(env.integrationsKey)
    if (!env.supabaseUrl || !env.serviceKey || !key) return json({ error: 'not_configured' }, 503)
    const db = deps.admin()
    if (!(await withinRateLimit(db, 'webhook:' + clientAddress(request), RATE_LIMITS.webhook)))
      return tooManyRequests()
    const url = new URL(request.url)
    const provider = url.searchParams.get('provider')
    const integrationId = url.searchParams.get('integration') ?? ''
    if (!UUID.test(integrationId) || (provider !== 'twilio' && provider !== 'whatsapp')) {
      return json({ error: 'bad_request' }, 400)
    }
    const row = await loadIntegration(db, integrationId)
    if (!row || row.provider !== provider || row.status === 'disconnected')
      return json({ error: 'not_found' }, 404)

    // Meta checks the webhook address once, with the token shown in Settings → Integrations.
    if (provider === 'whatsapp' && request.method === 'GET') {
      const ok =
        url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === webhookVerifyToken(integrationId, key)
      return ok
        ? new Response(url.searchParams.get('hub.challenge') ?? '', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })
        : json({ error: 'forbidden' }, 403)
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    let secrets: Record<string, unknown>
    try {
      secrets = await loadSecrets(db, row, key)
    } catch {
      return json({ error: 'not_configured' }, 503)
    }
    const raw = await request.text()

    if (provider === 'twilio') {
      const params = new URLSearchParams(raw)
      // Twilio signs the exact status address Umbane gave it, which is built from APP_URL; the
      // address the function sees can differ behind Vercel's proxy.
      const signed = env.appUrl ? twilioCallbackUrl(env.appUrl, integrationId) : request.url
      if (
        !twilioSignatureOk(
          str(secrets.authToken),
          signed,
          params,
          request.headers.get('x-twilio-signature'),
        )
      ) {
        return json({ error: 'invalid_signature' }, 403)
      }
      const sid = params.get('MessageSid') ?? ''
      const status = params.get('MessageStatus') ?? ''
      const event = TWILIO_EVENTS[status]
      if (!sid || !event) return json({ ignored: true })
      const code = params.get('ErrorCode')
      const { error } = await db.rpc('record_provider_event', {
        p_provider_message_id: `twilio:${sid}`,
        p_event: event,
        p_provider_event_id: `twilio:${sid}:${status}`,
        p_detail: { status, ...(code ? { error: `Twilio error ${code}` } : {}) },
        p_occurred_at: null,
      })
      return error ? json({ error: 'not_recorded' }, 500) : json({ recorded: true })
    }

    // WhatsApp
    if (!metaSignatureOk(str(secrets.appSecret), raw, request.headers.get('x-hub-signature-256'))) {
      return json({ error: 'invalid_signature' }, 403)
    }
    let payload: { entry?: { changes?: { value?: Record<string, unknown> }[] }[] }
    try {
      payload = JSON.parse(raw) as typeof payload
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    let recorded = 0
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        for (const s of (value.statuses as Record<string, unknown>[] | undefined) ?? []) {
          const status = str(s.status)
          if (!['delivered', 'read', 'failed'].includes(status) || !str(s.id)) continue
          const errors = Array.isArray(s.errors) ? (s.errors as Record<string, unknown>[]) : []
          const at = Number(s.timestamp)
          await db.rpc('record_provider_event', {
            p_provider_message_id: `whatsapp:${str(s.id)}`,
            p_event: `message.${status}`,
            p_provider_event_id: `whatsapp:${str(s.id)}:${status}`,
            p_detail: {
              status,
              ...(errors[0] ? { error: str(errors[0].title) || str(errors[0].message) } : {}),
            },
            p_occurred_at: at ? new Date(at * 1000).toISOString() : null,
          })
          recorded += 1
        }
        if (!row.capabilities.includes('receive_messages')) continue
        for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
          if (!str(m.id) || !str(m.from)) continue
          const text =
            str((m.text as Record<string, unknown> | undefined)?.body) ||
            `(${str(m.type) || 'message'})`
          const at = Number(m.timestamp)
          await db.rpc('log_inbound_message', {
            p_integration_id: integrationId,
            p_from: str(m.from),
            p_body: text,
            p_provider_message_id: `whatsapp:${str(m.id)}`,
            p_received_at: at ? new Date(at * 1000).toISOString() : null,
          })
          recorded += 1
        }
      }
    }
    return json({ recorded })
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createMessagingWebhookHandler({ env, admin: () => adminClient(env) })(request)
}

export function POST(request: Request) {
  const env = readEnv()
  return createMessagingWebhookHandler({ env, admin: () => adminClient(env) })(request)
}
