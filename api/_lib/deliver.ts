import {
  capabilityFor,
  isRoute,
  routeFor,
  type BuiltInEmail,
  type IntegrationDeps,
  type NoRoute,
  type Route,
} from './integrations/sender.js'
import type { OutgoingAttachment, OutgoingMessage, SendResult } from './integrations/types.js'
import type { OutgoingEmail, SendResult as ResendResult } from './resend.js'
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
  /** The built-in email sender (Resend with the keys in Vercel). Empty when it is not set up. */
  from: string
  replyTo?: string
  send: (email: OutgoingEmail) => Promise<ResendResult>
  /** Connections from Settings → Integrations. Without them only the built-in sender is used. */
  integrations?: IntegrationDeps | null
}

interface ClaimedMessage {
  id: string
  business_id?: string
  channel?: string
  integration_id?: string | null
  recipient: string | null
  recipient_name?: string | null
  subject: string | null
  body: string
  purpose?: 'transactional' | 'marketing'
  attachment_path: string | null
  attachment_name: string | null
  document_link_id?: string | null
  link_url?: string | null
  image_url?: string | null
}

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped'

export const builtInOf = (config: DeliveryConfig): BuiltInEmail | null =>
  config.from ? { from: config.from, replyTo: config.replyTo, send: config.send } : null

async function record(
  admin: AdminClient,
  id: string,
  result: SendResult,
  route: Route | null,
): Promise<DeliveryOutcome> {
  const { error } = await admin.rpc('record_message_result', {
    p_id: id,
    p_ok: result.ok,
    p_provider_message_id: result.ok ? result.id : null,
    p_error: result.ok ? null : result.error,
    p_retryable: result.ok ? false : result.retryable,
    ...(route
      ? {
          p_provider: route.provider,
          p_response: result.response ?? null,
          p_external_url: result.ok ? (result.externalUrl ?? null) : null,
          p_sender: result.ok ? (result.sender ?? route.sender) : null,
        }
      : {}),
  })
  if (error) throw new Error(`Could not record the result for ${id}: ${error.message}`)
  return result.ok ? 'sent' : 'failed'
}

const fail = (error: string, retryable = false): SendResult => ({ ok: false, retryable, error })

async function documentUrl(deps: IntegrationDeps, linkId: string): Promise<string | null> {
  if (!deps.ctx.appUrl) return null
  const { data } = await deps.db
    .from('document_links')
    .select('token')
    .eq('id', linkId)
    .maybeSingle()
  const token = (data as { token?: string } | null)?.token
  return token ? `${deps.ctx.appUrl.replace(/\/$/, '')}/api/documents?t=${token}` : null
}

/**
 * Claims one message, sends it through its route and records what happened. Returns "skipped" if
 * the database would not hand it over (not due, already being sent, no longer allowed), or if
 * there is nothing to send it with yet, in which case it keeps waiting without using up a try.
 */
export async function deliverMessage(
  admin: AdminClient,
  config: DeliveryConfig,
  id: string,
): Promise<DeliveryOutcome> {
  const deps = config.integrations ?? null
  let route: Route | NoRoute | null = null
  if (deps) {
    const peek = await deps.db
      .from('communication_logs')
      .select('id, business_id, channel, integration_id')
      .eq('id', id)
      .maybeSingle()
    const row = peek.data as {
      business_id: string
      channel: string
      integration_id: string | null
    } | null
    if (!row) return 'skipped'
    route = await routeFor(
      deps,
      builtInOf(config),
      row.business_id,
      row.channel,
      row.integration_id,
    )
    if (!isRoute(route) && route.reason === 'not_configured') return 'skipped'
  }

  const claim = await admin.rpc('claim_message', { p_id: id })
  if (claim.error) throw new Error(`Could not claim ${id}: ${claim.error.message}`)
  const m = (Array.isArray(claim.data) ? claim.data[0] : null) as ClaimedMessage | null
  if (!m) return 'skipped'
  const channel = m.channel ?? 'email'
  if (!route)
    route = await routeFor(
      null,
      builtInOf(config),
      m.business_id ?? '',
      channel,
      m.integration_id ?? null,
    )
  if (!isRoute(route)) return record(admin, m.id, fail(route.error), null)
  const sending = route
  // With connections the provider is recorded too; the built-in path records as it always has.
  const done = (r: SendResult) => record(admin, m.id, r, deps ? sending : null)
  if (!route.capabilities.includes(capabilityFor(channel))) {
    return done(fail(`${route.provider} cannot send this kind of message.`))
  }

  const attachments: OutgoingAttachment[] = []
  let docUrl: string | null = null
  if (m.document_link_id && deps) {
    docUrl = await documentUrl(deps, m.document_link_id)
    if (!docUrl) return done(fail('The document link needs APP_URL set on the server.'))
  } else if (m.attachment_path) {
    if (!route.capabilities.includes('attachments')) {
      return done(fail(`${route.provider} cannot carry attachments.`))
    }
    const file = await admin.storage.from('message-attachments').download(m.attachment_path)
    if (file.error || !file.data) {
      return done(
        fail(`The attachment could not be read: ${file.error?.message ?? 'missing'}`, true),
      )
    }
    const bytes = Buffer.from(await file.data.arrayBuffer())
    if (route.maxAttachmentBytes && bytes.length > route.maxAttachmentBytes) {
      const mb = Math.floor(route.maxAttachmentBytes / (1024 * 1024))
      return done(fail(`The attachment is bigger than ${route.provider} accepts (${mb} MB).`))
    }
    attachments.push({
      filename: m.attachment_name ?? 'attachment.pdf',
      contentType: 'application/pdf',
      content: bytes.toString('base64'),
      bytes: bytes.length,
    })
  }

  const message: OutgoingMessage = {
    id: m.id,
    to: m.recipient,
    toName: m.recipient_name ?? null,
    subject: m.subject,
    text: m.body,
    html: textToHtml(m.body),
    attachments,
    documentUrl: docUrl,
    linkUrl: m.link_url ?? null,
    imageUrl: m.image_url ?? null,
    // Same message to the same address: never sent twice by providers that check the key.
    idempotencyKey: `${m.id}:${m.recipient ?? channel}`,
    purpose: m.purpose ?? 'transactional',
  }

  let result: SendResult
  try {
    result = await route.send(message)
  } catch (e) {
    // Only a provider that refuses duplicates is safe to try again after an unknown outcome.
    result = fail(`Send failed: ${(e as Error).message}`, route.provider === 'resend')
  }
  return done(result)
}

/** Sends messages that are due, one at a time, and keeps going if one fails. */
export async function deliverDue(admin: AdminClient, config: DeliveryConfig, limit: number) {
  const due = await admin.rpc('due_messages', { p_limit: limit })
  if (due.error) throw new Error(`Could not list due messages: ${due.error.message}`)
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
