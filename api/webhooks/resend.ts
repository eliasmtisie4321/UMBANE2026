import type { AdminClient } from '../_lib/deliver.js'
import { adminClient, json, readEnv, type ServerEnv } from '../_lib/server.js'
import { TRACKED_EVENTS, verifyWebhook } from '../_lib/webhook.js'

interface ResendEvent {
  type?: string
  created_at?: string
  data?: { email_id?: string; to?: unknown; bounce?: unknown; subject?: unknown }
}

/**
 * POST /api/webhooks/resend
 * Delivery reports from Resend. Unsigned or stale requests are refused. A report the database
 * cannot store yet is answered with an error so Resend tries again later.
 */
export function createWebhookHandler(env: ServerEnv, admin: () => AdminClient) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!env.webhookSecret) return json({ error: 'not_configured' }, 503)
    const raw = await request.text()
    const id = request.headers.get('svix-id')
    const ok = verifyWebhook(
      env.webhookSecret,
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
  return createWebhookHandler(env, () => adminClient(env) as unknown as AdminClient)(request)
}
