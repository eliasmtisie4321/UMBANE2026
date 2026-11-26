import { timingSafeEqual } from 'node:crypto'
import { deliverDue, type AdminClient } from '../_lib/deliver.js'
import {
  adminClient,
  deliveryConfig,
  json,
  missingForEmail,
  readEnv,
  type ServerEnv,
} from '../_lib/server.js'

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * GET /api/messages/retry-due
 * Called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>". Sends emails that are due for
 * another try. Without CRON_SECRET set, it refuses every request.
 */
export function createRetryHandler(env: ServerEnv, admin: () => AdminClient) {
  return async function handle(request: Request): Promise<Response> {
    const header = request.headers.get('authorization') ?? ''
    if (!env.cronSecret || !sameSecret(header, `Bearer ${env.cronSecret}`)) {
      return json({ error: 'unauthorized' }, 401)
    }
    const missing = missingForEmail(env)
    if (missing.length > 0) return json({ error: 'not_configured', missing }, 503)
    const outcomes = await deliverDue(admin(), deliveryConfig(env), 25)
    return json(outcomes)
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createRetryHandler(env, () => adminClient(env) as unknown as AdminClient)(request)
}
