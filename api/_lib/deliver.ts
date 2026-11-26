import type { OutgoingEmail, SendResult } from './resend.js'
import { textToHtml } from './resend.js'

/** The parts of a Supabase service-role client the delivery code uses; tests pass a fake. */
export interface AdminClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>
    }
  }
}

export interface DeliveryConfig {
  from: string
  replyTo?: string
  send: (email: OutgoingEmail) => Promise<SendResult>
}

interface ClaimedMessage {
  id: string
  recipient: string
  subject: string
  body: string
  attachment_path: string | null
  attachment_name: string | null
}

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped'

async function record(
  admin: AdminClient,
  id: string,
  result: SendResult,
): Promise<DeliveryOutcome> {
  const { error } = await admin.rpc('record_message_result', {
    p_id: id,
    p_ok: result.ok,
    p_provider_message_id: result.ok ? result.id : null,
    p_error: result.ok ? null : result.error,
    p_retryable: result.ok ? false : result.retryable,
  })
  if (error) throw new Error(`Could not record the result for ${id}: ${error.message}`)
  return result.ok ? 'sent' : 'failed'
}

/**
 * Claims one email, sends it and records what happened. Returns "skipped" if the database would
 * not hand it over (not due, already being sent, or no longer allowed).
 */
export async function deliverMessage(
  admin: AdminClient,
  config: DeliveryConfig,
  id: string,
): Promise<DeliveryOutcome> {
  const claim = await admin.rpc('claim_message', { p_id: id })
  if (claim.error) throw new Error(`Could not claim ${id}: ${claim.error.message}`)
  const m = (Array.isArray(claim.data) ? claim.data[0] : null) as ClaimedMessage | null
  if (!m) return 'skipped'

  const attachments: OutgoingEmail['attachments'] = []
  if (m.attachment_path) {
    const file = await admin.storage.from('message-attachments').download(m.attachment_path)
    if (file.error || !file.data) {
      return record(admin, m.id, {
        ok: false,
        retryable: true,
        error: `The attachment could not be read: ${file.error?.message ?? 'missing'}`,
      })
    }
    attachments.push({
      filename: m.attachment_name ?? 'attachment.pdf',
      content: Buffer.from(await file.data.arrayBuffer()).toString('base64'),
    })
  }

  let result: SendResult
  try {
    result = await config.send({
      from: config.from,
      to: m.recipient,
      replyTo: config.replyTo,
      subject: m.subject,
      text: m.body,
      html: textToHtml(m.body),
      attachments,
      // Same email to the same address: never sent twice, however often it is retried.
      idempotencyKey: `${m.id}:${m.recipient}`,
      tags: [{ name: 'message_id', value: m.id }],
    })
  } catch (e) {
    result = { ok: false, retryable: true, error: `Send failed: ${(e as Error).message}` }
  }
  return record(admin, m.id, result)
}

/** Sends emails that are due, one at a time, and keeps going if one fails. */
export async function deliverDue(admin: AdminClient, config: DeliveryConfig, limit: number) {
  const due = await admin.rpc('due_messages', { p_limit: limit })
  if (due.error) throw new Error(`Could not list due emails: ${due.error.message}`)
  const ids = (Array.isArray(due.data) ? due.data : []).map((d) =>
    typeof d === 'string' ? d : String((d as Record<string, unknown>).due_messages),
  )
  const outcomes: Record<DeliveryOutcome | 'error', number> = {
    sent: 0,
    failed: 0,
    skipped: 0,
    error: 0,
  }
  for (const id of ids) {
    try {
      outcomes[await deliverMessage(admin, config, id)] += 1
    } catch {
      outcomes.error += 1
    }
  }
  return outcomes
}
