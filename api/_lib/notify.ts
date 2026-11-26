import type { AdminClient, DeliveryConfig } from './deliver.js'
import { textToHtml } from './resend.js'

interface ClaimedNotification {
  id: string
  recipient: string
  title: string
  body: string | null
  link: string | null
  business_name: string | null
}

/** Only links inside the app are turned into addresses. */
const safeLink = (link: string | null) => (link && /^\/[A-Za-z0-9/_-]*$/.test(link) ? link : null)

/** The email for one notification: what happened, a link to it, and how to stop these emails. */
export function notificationEmail(n: ClaimedNotification, appUrl: string | null) {
  const link = safeLink(n.link)
  const open = appUrl && link ? `${appUrl.replace(/\/$/, '')}${link}` : null
  const text = [
    n.title,
    n.body ?? '',
    open ? `Open it in Umbane: ${open}` : 'Sign in to Umbane to see it.',
    `You get this email because email is switched on for this kind of notification. To change that, go to Notifications → Settings in ${n.business_name ?? 'Umbane'}.`,
  ]
    .filter(Boolean)
    .join('\n\n')
  return { subject: n.title, text, html: textToHtml(text) }
}

export interface NotificationOutcomes {
  sent: number
  failed: number
  error: number
}

/**
 * Sends queued notification emails. Each one is claimed first, so two servers never send the same
 * one, and carries an idempotency key, so a retry after an uncertain failure is not sent twice.
 */
export async function deliverNotificationEmails(
  admin: AdminClient,
  config: DeliveryConfig,
  appUrl: string | null,
  limit: number,
  businessId: string | null = null,
): Promise<NotificationOutcomes> {
  const claim = await admin.rpc('claim_notification_emails', {
    p_limit: limit,
    p_business_id: businessId,
  })
  if (claim.error) throw new Error(`Could not claim notification emails: ${claim.error.message}`)
  const claimed = (Array.isArray(claim.data) ? claim.data : []) as ClaimedNotification[]
  const outcomes: NotificationOutcomes = { sent: 0, failed: 0, error: 0 }
  for (const n of claimed) {
    const email = notificationEmail(n, appUrl)
    let result
    try {
      result = await config.send({
        from: config.from,
        to: n.recipient,
        replyTo: config.replyTo,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [],
        idempotencyKey: `notification:${n.id}`,
        tags: [{ name: 'notification_id', value: n.id }],
      })
    } catch (e) {
      result = {
        ok: false as const,
        retryable: true,
        error: `Send failed: ${(e as Error).message}`,
      }
    }
    const recorded = await admin.rpc('record_notification_email', {
      p_id: n.id,
      p_ok: result.ok,
      p_error: result.ok ? null : result.error,
      p_retryable: result.ok ? false : result.retryable,
    })
    if (recorded.error) outcomes.error += 1
    else if (result.ok) outcomes.sent += 1
    else outcomes.failed += 1
  }
  return outcomes
}
