import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deliverDue,
  deliverMessage,
  type AdminClient,
  type DeliveryConfig,
} from '../_lib/deliver.js'
import {
  adminClient,
  canSend,
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
/** One Share action can reach several platforms; it is sent in one call. */
const MAX_PER_CALL = 10

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
  config: (env: ServerEnv, admin?: unknown) => DeliveryConfig
}

function readIds(body: unknown): string[] | null {
  const b = (body ?? {}) as { messageId?: unknown; messageIds?: unknown }
  const raw = Array.isArray(b.messageIds)
    ? b.messageIds
    : b.messageId !== undefined
      ? [b.messageId]
      : []
  const ids = [...new Set(raw.map((x) => String(x ?? '')))]
  if (!ids.length || ids.length > MAX_PER_CALL || !ids.every((id) => UUID.test(id))) return null
  return ids
}

/**
 * POST /api/messages/send  { messageId } or { messageIds: [...] }
 * Sends messages a staff member has just queued (an email, or one Share to several platforms),
 * then a few others that are due for a retry. Every message must be in the caller's business.
 * Each goes through its own connection (Settings → Integrations), or the built-in email sender.
 */
export function createSendHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!deps.env.serviceKey || !deps.env.supabaseUrl) {
      return json({ error: 'not_configured', missing: missingForEmail(deps.env) }, 503)
    }
    const admin = deps.admin()
    const caller = await staffCaller(admin, request)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!(await withinRateLimit(admin, 'send:' + caller.id, RATE_LIMITS.send)))
      return tooManyRequests()

    let ids: string[] | null
    try {
      ids = readIds(await request.json())
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    if (!ids) return json({ error: 'bad_request' }, 400)

    const owned = await admin.from('communication_logs').select('id, business_id').in('id', ids)
    const rows = (owned.data ?? []) as { id: string; business_id: string }[]
    if (
      owned.error ||
      rows.length !== ids.length ||
      rows.some((r) => r.business_id !== caller.businessId)
    ) {
      return json({ error: 'not_found' }, 404)
    }
    // Queued safely; they go out once sending is set up.
    if (!canSend(deps.env)) {
      return json({ status: 'queued', configured: false, missing: missingForEmail(deps.env) }, 202)
    }

    const config = deps.config(deps.env, admin)
    const results: { id: string; outcome: string; status: string | null; error: string | null }[] =
      []
    for (const id of ids) {
      let outcome = 'error'
      try {
        outcome = await deliverMessage(admin as unknown as AdminClient, config, id)
      } catch {
        // Left in the queue for the next try; its status says what happened.
      }
      results.push({ id, outcome, status: null, error: null })
    }
    try {
      await deliverDue(admin as unknown as AdminClient, config, 5)
    } catch {
      // Retrying others is best effort; these results are already recorded.
    }
    const after = await admin.from('communication_logs').select('id, status, error').in('id', ids)
    for (const row of (after.data ?? []) as {
      id: string
      status: string
      error: string | null
    }[]) {
      const r = results.find((x) => x.id === row.id)
      if (r) Object.assign(r, { status: row.status, error: row.error })
    }
    // One message: the same answer as before Share existed, plus the list.
    if (results.length === 1) {
      const [one] = results
      return json({ outcome: one.outcome, status: one.status, error: one.error, results })
    }
    return json({ results })
  }
}

export function POST(request: Request) {
  const env = readEnv()
  return createSendHandler({ env, admin: () => adminClient(env), config: deliveryConfig })(request)
}
