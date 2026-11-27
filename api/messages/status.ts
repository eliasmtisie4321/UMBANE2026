import type { SupabaseClient } from '@supabase/supabase-js'
import {
  adminClient,
  json,
  missingForEmail,
  readEnv,
  staffCaller,
  type ServerEnv,
  RATE_LIMITS,
  tooManyRequests,
  withinRateLimit,
} from '../_lib/server.js'

/**
 * GET /api/messages/status
 * Tells staff whether email is set up, and which setting names are missing. Never the values.
 */
export function createStatusHandler(env: ServerEnv, admin: () => SupabaseClient) {
  return async function handle(request: Request): Promise<Response> {
    const missing = missingForEmail(env)
    if (env.supabaseUrl && env.serviceKey) {
      const client = admin()
      const caller = await staffCaller(client, request)
      if (!caller) return json({ error: 'unauthorized' }, 401)
      if (!(await withinRateLimit(client, 'status:' + caller.id, RATE_LIMITS.status))) {
        return tooManyRequests()
      }
    }
    return json({
      email: missing.length === 0,
      missing,
      deliveryReports: Boolean(env.webhookSecret),
      // Connections in Settings → Integrations can be used (their credentials can be decrypted).
      integrations: Boolean(env.integrationsKey),
      retries: Boolean(env.cronSecret),
      from: env.emailFrom,
    })
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createStatusHandler(env, () => adminClient(env))(request)
}
