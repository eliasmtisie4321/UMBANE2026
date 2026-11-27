import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverMessage, type AdminClient, type DeliveryConfig } from '../_lib/deliver.js'
import { deliverNotificationEmails } from '../_lib/notify.js'
import {
  adminClient,
  deliveryConfig,
  json,
  canSend,
  missingForEmail,
  readEnv,
  signedInCaller,
  type ServerEnv,
  RATE_LIMITS,
  tooManyRequests,
  withinRateLimit,
} from '../_lib/server.js'

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
  config: (env: ServerEnv, admin?: unknown) => DeliveryConfig
}

/**
 * POST /api/notifications/flush
 * The app calls this now and then while someone is signed in, so emails go out within minutes
 * rather than at the next daily run. It only sends what is already queued for the caller's own
 * business, a few at a time; calling it more often changes nothing else.
 */
export function createFlushHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!canSend(deps.env)) {
      return json({ status: 'not_configured', missing: missingForEmail(deps.env) }, 202)
    }
    const client = deps.admin()
    const caller = await signedInCaller(client, request)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!(await withinRateLimit(client, 'flush:' + caller.id, RATE_LIMITS.flush)))
      return tooManyRequests()
    const admin = client as unknown as AdminClient
    const config = deps.config(deps.env, client)

    let notifications: Awaited<ReturnType<typeof deliverNotificationEmails>> | { error: string }
    try {
      notifications = await deliverNotificationEmails(
        admin,
        config,
        deps.env.appUrl,
        10,
        caller.businessId,
      )
    } catch (e) {
      notifications = { error: (e as Error).message }
    }
    const due = await admin.rpc('due_messages_for', {
      p_business_id: caller.businessId,
      p_limit: 5,
    })
    let customerEmails = 0
    if (!due.error && Array.isArray(due.data)) {
      for (const d of due.data) {
        const id =
          typeof d === 'string' ? d : String((d as Record<string, unknown>).due_messages_for)
        try {
          if ((await deliverMessage(admin, config, id)) === 'sent') customerEmails += 1
        } catch {
          // Left in the queue for the next try.
        }
      }
    }
    return json({ status: 'ok', notifications, customerEmails })
  }
}

export function POST(request: Request) {
  const env = readEnv()
  return createFlushHandler({ env, admin: () => adminClient(env), config: deliveryConfig })(request)
}
