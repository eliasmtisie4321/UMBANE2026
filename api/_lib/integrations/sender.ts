import {
  CHANNEL_LABEL,
  providerInfo,
  type Capability,
  type Channel,
} from '../../../shared/integrations.js'
import { adapterFor } from './registry.js'
import {
  defaultIntegration,
  freshCredentials,
  loadIntegration,
  loadSecrets,
  markError,
  toConnection,
  type Db,
  type IntegrationRow,
} from './store.js'
import type { AdapterContext, OutgoingMessage, SendResult } from './types.js'

/** The built-in email sender: Resend with the keys in Vercel (RESEND_API_KEY, EMAIL_FROM). */
export interface BuiltInEmail {
  from: string
  replyTo?: string
  send: (email: {
    from: string
    to: string
    replyTo?: string
    subject: string
    text: string
    html: string
    attachments?: { filename: string; content: string }[]
    idempotencyKey: string
    tags?: { name: string; value: string }[]
  }) => Promise<{ ok: true; id: string } | { ok: false; retryable: boolean; error: string }>
}

export interface IntegrationDeps {
  db: Db
  /** INTEGRATIONS_KEY; without it no connection's credentials can be read. */
  key: Buffer | null
  ctx: AdapterContext
}

/** How one message goes out: through a connection, or the built-in email sender. */
export interface Route {
  provider: string
  integrationId: string | null
  sender: string | null
  capabilities: readonly Capability[]
  maxAttachmentBytes: number | null
  send: (m: OutgoingMessage) => Promise<SendResult>
}

/** Why there is no route. not_configured: nothing to send with yet, so the message keeps waiting. */
export type NoRoute = { reason: 'not_configured' | 'unavailable'; error: string }

const isRoute = (r: Route | NoRoute): r is Route => 'send' in r

export { isRoute }

/** Turns a connection into a route, renewing its sign-in if needed. */
async function connectionRoute(
  deps: IntegrationDeps,
  row: IntegrationRow,
): Promise<Route | NoRoute> {
  const info = providerInfo(row.provider)
  const label = info?.label ?? row.provider
  if (row.status !== 'connected') {
    return {
      reason: 'unavailable',
      error: `${label} is not connected${row.last_error ? `: ${row.last_error}` : '.'} An administrator can reconnect it in Settings → Integrations.`,
    }
  }
  const adapter = adapterFor(row.provider)
  if (!adapter) return { reason: 'unavailable', error: `${label} cannot send from Umbane.` }
  if (!deps.key)
    return { reason: 'not_configured', error: 'INTEGRATIONS_KEY is not set on the server.' }
  let credentials
  try {
    credentials = await loadSecrets(deps.db, row, deps.key)
  } catch (e) {
    await markError(deps.db, row.id, (e as Error).message)
    return { reason: 'unavailable', error: (e as Error).message }
  }
  const fresh = await freshCredentials(deps.db, adapter, row, credentials, deps.key, deps.ctx)
  if (!fresh)
    return {
      reason: 'unavailable',
      error: `${label}: the sign-in has expired. An administrator can connect it again.`,
    }
  const connection = toConnection(row)
  return {
    provider: row.provider,
    integrationId: row.id,
    sender: row.account_label,
    capabilities: row.capabilities,
    maxAttachmentBytes: info?.maxAttachmentBytes ?? null,
    async send(m) {
      const result = await adapter.send(m, fresh, connection, deps.ctx)
      // The provider no longer accepts these credentials: say so on the connection, once.
      const status = !result.ok ? Number(result.response?.status) : 0
      if (status === 401) {
        await markError(
          deps.db,
          row.id,
          `${label} refused the credentials (401). Connect it again.`,
        )
      }
      return result
    },
  }
}

/**
 * The route for a message: the connection it names; otherwise the business's default for the
 * channel; otherwise, for email only, the built-in sender.
 */
export async function routeFor(
  deps: IntegrationDeps | null,
  builtIn: BuiltInEmail | null,
  businessId: string,
  channel: string,
  integrationId: string | null,
): Promise<Route | NoRoute> {
  if (integrationId) {
    if (!deps)
      return { reason: 'not_configured', error: 'Integrations are not set up on the server.' }
    const row = await loadIntegration(deps.db, integrationId)
    if (!row || row.business_id !== businessId)
      return { reason: 'unavailable', error: 'That connection no longer exists.' }
    return connectionRoute(deps, row)
  }
  if (deps) {
    const row = await defaultIntegration(deps.db, businessId, channel)
    if (row) return connectionRoute(deps, row)
  }
  if (channel === 'email' && builtIn && builtIn.from) {
    return {
      provider: 'resend',
      integrationId: null,
      sender: builtIn.from,
      capabilities: ['send_email', 'attachments', 'delivery_tracking'],
      maxAttachmentBytes: 40 * 1024 * 1024,
      async send(m) {
        const r = await builtIn.send({
          from: builtIn.from,
          to: m.to ?? '',
          replyTo: builtIn.replyTo,
          subject: m.subject ?? '',
          text: m.text,
          html: m.html,
          attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content })),
          idempotencyKey: m.idempotencyKey,
          tags: [{ name: 'message_id', value: m.id }],
        })
        return r.ok ? { ok: true, id: r.id, sender: builtIn.from } : r
      },
    }
  }
  const name = CHANNEL_LABEL[channel as Channel] ?? channel
  return {
    reason: 'not_configured',
    error: `No ${name} account is connected. An administrator can connect one in Settings → Integrations.`,
  }
}

/** What a channel's message needs from its connection. */
export function capabilityFor(channel: string): Capability {
  if (channel === 'email') return 'send_email'
  if (channel === 'sms' || channel === 'whatsapp') return 'direct_message'
  return 'publish_social'
}
