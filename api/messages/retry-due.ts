import { deliverDue, type AdminClient } from '../_lib/deliver.js'
import {
  adminClient,
  deliveryConfig,
  isCronRequest,
  json,
  canSend,
  missingForEmail,
  readEnv,
  type ServerEnv,
} from '../_lib/server.js'

/**
 * GET /api/messages/retry-due
 * Called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>". Sends emails that are due for
 * another try. Without CRON_SECRET set, it refuses every request.
 */
export function createRetryHandler(env: ServerEnv, admin: () => AdminClient) {
  return async function handle(request: Request): Promise<Response> {
    if (!isCronRequest(request, env.cronSecret)) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (!canSend(env)) return json({ error: 'not_configured', missing: missingForEmail(env) }, 503)
    const client = admin()
    const outcomes = await deliverDue(client, deliveryConfig(env, client), 25)
    return json(outcomes)
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createRetryHandler(env, () => adminClient(env) as unknown as AdminClient)(request)
}
