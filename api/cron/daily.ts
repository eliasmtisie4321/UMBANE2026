import { deliverDue, type AdminClient, type DeliveryConfig } from '../_lib/deliver.js'
import { deliverNotificationEmails } from '../_lib/notify.js'
import {
  adminClient,
  deliveryConfig,
  isCronRequest,
  json,
  missingForEmail,
  readEnv,
  type ServerEnv,
} from '../_lib/server.js'

interface Deps {
  env: ServerEnv
  admin: () => AdminClient
  config: (env: ServerEnv) => DeliveryConfig
}

/**
 * GET /api/cron/daily
 * Vercel Cron calls this each morning with "Authorization: Bearer <CRON_SECRET>". It runs every
 * business's switched-on automations and the data-retention clean-up, then sends the notification and customer emails waiting in
 * the queues (including any the automations just queued). Each step is reported separately, so
 * one failing does not hide the others.
 */
export function createDailyHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (!isCronRequest(request, deps.env.cronSecret)) return json({ error: 'unauthorized' }, 401)
    if (!deps.env.supabaseUrl || !deps.env.serviceKey) {
      return json({ error: 'not_configured', missing: missingForEmail(deps.env) }, 503)
    }
    const admin = deps.admin()
    const report: Record<string, unknown> = {}

    const run = await admin.rpc('run_automations', {})
    report.automations = run.error ? { error: run.error.message } : run.data

    // The data-retention clean-up (docs/SETTINGS.md): old notifications, automation history, answered
    // account requests and audit entries past their keeping period.
    const retention = await admin.rpc('apply_retention', {})
    report.retention = retention.error ? { error: retention.error.message } : retention.data

    const missing = missingForEmail(deps.env)
    if (missing.length > 0) {
      report.email = { status: 'not_configured', missing }
    } else {
      const config = deps.config(deps.env)
      try {
        report.notificationEmails = await deliverNotificationEmails(
          admin,
          config,
          deps.env.appUrl,
          100,
        )
      } catch (e) {
        report.notificationEmails = { error: (e as Error).message }
      }
      try {
        report.customerEmails = await deliverDue(admin, config, 50)
      } catch (e) {
        report.customerEmails = { error: (e as Error).message }
      }
    }
    return json(report, run.error || retention.error ? 500 : 200)
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createDailyHandler({
    env,
    admin: () => adminClient(env) as unknown as AdminClient,
    config: deliveryConfig,
  })(request)
}
