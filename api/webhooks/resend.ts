import type { AdminClient } from '../_lib/deliver.js'
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
import { TRACKED_EVENTS, verifyWebhook } from '../_lib/webhook.js'
import { encryptionKey } from '../_lib/integrations/crypto.js'
import { str } from '../_lib/integrations/http.js'
import { loadIntegration, loadSecrets, type Db } from '../_lib/integrations/store.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The signing secret of a business's own Resend connection (Settings → Integrations). */
export type SecretFor = (integrationId: string) => Promise<string | null>

interface ResendEvent {
  type?: string
  created_at?: string
  data?: { email_id?: string; to?: unknown; bounce?: unknown; subject?: unknown }
}

/**
 * POST /api/webhooks/resend
 * Delivery reports from Resend. Unsigned or stale requests are refused. A report the database
 * cannot store yet is answered with an error so Resend tries again later. With ?integration=<id>
 * the report is for a business's own Resend account, checked with that connection's secret.
 */
export function createWebhookHandler(
  env: ServerEnv,
  admin: () => AdminClient,
  secretFor?: SecretFor,
) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    const integration = new URL(request.url).searchParams.get('integration')
    const secret = integration
      ? UUID.test(integration) && secretFor
        ? await secretFor(integration)
        : null
      : env.webhookSecret
    if (!secret) return json({ error: 'not_configured' }, 503)
    // Before anything else, so a flood of forged requests costs little.
    if (
      !(await withinRateLimit(admin(), 'webhook:' + clientAddress(request), RATE_LIMITS.webhook))
    ) {
      return tooManyRequests()
    }
    const raw = await request.text()
    const id = request.headers.get('svix-id')
    const ok = verifyWebhook(
      secret,
      {
        id,
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
      raw,
    )
    if (!ok) return json({ error: 'invalid_signature' }, 400)

    let event: ResendEvent
    try {
      event = JSON.parse(raw) as ResendEvent
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    const type = event.type ?? ''
    const emailId = event.data?.email_id
    if (!(TRACKED_EVENTS as readonly string[]).includes(type) || typeof emailId !== 'string') {
      return json({ ignored: true })
    }
    // Keep what helps explain a delivery problem; never the message content.
    const detail = { type, bounce: event.data?.bounce ?? null }
    const { data, error } = await admin().rpc('record_provider_event', {
      p_provider_message_id: emailId,
      p_event: type,
      p_provider_event_id: id,
      p_detail: detail,
      p_occurred_at: event.created_at ?? null,
    })
    if (error) return json({ error: 'not_recorded' }, 500)
    return json({ recorded: data === true })
  }
}

export function POST(request: Request) {
  const env = readEnv()
  const secretFor: SecretFor = async (id) => {
    const key = encryptionKey(env.integrationsKey)
    if (!key || !env.supabaseUrl || !env.serviceKey) return null
    const db = adminClient(env) as unknown as Db
    const row = await loadIntegration(db, id)
    if (!row || row.provider !== 'resend' || row.status === 'disconnected') return null
    try {
      return str((await loadSecrets(db, row, key)).webhookSecret) || null
    } catch {
      return null
    }
  }
  return createWebhookHandler(
    env,
    () => adminClient(env) as unknown as AdminClient,
    secretFor,
  )(request)
}
