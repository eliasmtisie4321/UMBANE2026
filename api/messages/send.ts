import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deliverDue,
  deliverMessage,
  type AdminClient,
  type DeliveryConfig,
} from '../_lib/deliver.js'
import {
  adminClient,
  deliveryConfig,
  json,
  missingForEmail,
  readEnv,
  staffCaller,
  type ServerEnv,
  RATE_LIMITS,
  tooManyRequests,
  withinRateLimit,
} from '../_lib/server.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
  config: (env: ServerEnv) => DeliveryConfig
}

/**
 * POST /api/messages/send  { messageId }
 * Sends an email that a staff member has just queued, then a few others that are due for a retry.
 * The caller must be active staff in the email's business.
 */
export function createSendHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    const missing = missingForEmail(deps.env)
    if (missing.includes('SUPABASE_SERVICE_ROLE_KEY') || missing.includes('SUPABASE_URL')) {
      return json({ error: 'not_configured', missing }, 503)
    }
    const admin = deps.admin()
    const caller = await staffCaller(admin, request)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!(await withinRateLimit(admin, 'send:' + caller.id, RATE_LIMITS.send)))
      return tooManyRequests()

    let messageId: string
    try {
      messageId = String(((await request.json()) as { messageId?: unknown }).messageId ?? '')
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    if (!UUID.test(messageId)) return json({ error: 'bad_request' }, 400)

    const owned = await admin
      .from('communication_logs')
      .select('id, business_id')
      .eq('id', messageId)
      .maybeSingle()
    const row = owned.data as { business_id: string } | null
    if (owned.error || !row || row.business_id !== caller.businessId) {
      return json({ error: 'not_found' }, 404)
    }
    // Queued safely; it goes out once email is set up.
    if (missing.length > 0) return json({ status: 'queued', configured: false, missing }, 202)

    const config = deps.config(deps.env)
    const outcome = await deliverMessage(admin as unknown as AdminClient, config, messageId)
    try {
      await deliverDue(admin as unknown as AdminClient, config, 5)
    } catch {
      // Retrying others is best effort; this email's result is already recorded.
    }
    const after = await admin
      .from('communication_logs')
      .select('status, error')
      .eq('id', messageId)
      .maybeSingle()
    const final = after.data as { status: string; error: string | null } | null
    return json({ outcome, status: final?.status ?? null, error: final?.error ?? null })
  }
}

export function POST(request: Request) {
  const env = readEnv()
  return createSendHandler({ env, admin: () => adminClient(env), config: deliveryConfig })(request)
}
