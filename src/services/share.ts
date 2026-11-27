import type { Channel } from '@shared/integrations'
import { getSupabase } from './supabase'
import { guarded, mapReadError, mapWriteError, resolveClient, type DbClient } from './db'
import { getEmailSetup, type ServerApi } from './messages'
import type { AppError } from '@/types/api'
import type {
  DeliveryState,
  IntegrationConnection,
  Reachability,
  Recipient,
} from '@/types/integrations'
import { err, ok } from '@/utils/result'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** A South African mobile number in international form, as the database reads it (e164_phone). */
export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/[^0-9+]/g, '')
  if (/^\+[1-9][0-9]{7,14}$/.test(d)) return d
  if (/^0[0-9]{9}$/.test(d)) return `+27${d.slice(1)}`
  if (/^27[0-9]{9}$/.test(d)) return `+${d}`
  return null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * What a recipient has on file and what stops each channel, so the Share dialog can say so before
 * sending. The database checks the same rules again when the message is queued.
 */
export function reachabilityOf(
  r: { email: string | null; phone: string | null },
  flags: {
    emailOptOut?: boolean
    suppressed?: boolean
    smsOptOut?: boolean
    whatsappOptIn?: boolean
    marketingConsent?: boolean
    isCustomer?: boolean
  } = {},
): Reachability {
  const email = r.email && EMAIL.test(r.email) ? r.email.toLowerCase() : null
  const phone = e164(r.phone)
  const blocked: Reachability['blocked'] = {}
  if (!email) blocked.email = 'No email address on file'
  else if (flags.suppressed) blocked.email = 'Email to this address bounced'
  else if (flags.emailOptOut) blocked.email = 'Asked not to receive email'
  if (!phone) {
    blocked.sms = 'No mobile number on file'
    blocked.whatsapp = 'No mobile number on file'
  } else {
    if (flags.smsOptOut) blocked.sms = 'Asked not to receive SMS'
    if (flags.isCustomer && !flags.whatsappOptIn) blocked.whatsapp = 'Has not agreed to WhatsApp'
  }
  return { email, phone, blocked, marketingConsent: Boolean(flags.marketingConsent) }
}

export const getReachability = (recipient: Recipient, client?: DbClient) =>
  guarded<Reachability>('Recipient', client, async (c) => {
    if (recipient.kind === 'address') {
      const v = recipient.value.trim()
      return ok(
        reachabilityOf({ email: EMAIL.test(v) ? v : null, phone: EMAIL.test(v) ? null : v }),
      )
    }
    const table =
      recipient.kind === 'customer' ? 'customers' : recipient.kind === 'lead' ? 'leads' : 'profiles'
    const cols =
      recipient.kind === 'customer'
        ? 'email, phone, email_opt_out, email_suppressed_at, marketing_consent, sms_opt_out, whatsapp_opt_in'
        : 'email, phone'
    const { data, error } = await c.from(table).select(cols).eq('id', recipient.id).maybeSingle()
    if (error) return err(mapReadError(error, 'Recipient'))
    const r = (data ?? {}) as Row
    return ok(
      reachabilityOf(
        { email: str(r.email), phone: str(r.phone) },
        recipient.kind === 'customer'
          ? {
              isCustomer: true,
              emailOptOut: Boolean(r.email_opt_out),
              suppressed: Boolean(r.email_suppressed_at),
              smsOptOut: Boolean(r.sms_opt_out),
              whatsappOptIn: Boolean(r.whatsapp_opt_in),
              marketingConsent: Boolean(r.marketing_consent),
            }
          : {},
      ),
    )
  })

export interface TeamRecipient {
  id: string
  name: string
  email: string | null
  phone: string | null
}

/** Active team members, for sharing reports and documents inside the business. */
export const listTeamRecipients = (client?: DbClient) =>
  guarded<TeamRecipient[]>('Team', client, async (c) => {
    const { data, error } = await c
      .from('profiles')
      .select('id, full_name, email, phone')
      .eq('is_active', true)
      .neq('role', 'client')
      .order('full_name')
    if (error) return err(mapReadError(error, 'Team'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        name: str(r.full_name) ?? str(r.email) ?? 'Team member',
        email: str(r.email),
        phone: str(r.phone),
      })),
    )
  })

export interface QueueInput {
  channel: Channel
  integrationId: string | null
  recipient: Recipient | null
  subject: string | null
  body: string
  purpose: 'transactional' | 'marketing'
  templateKey?: string | null
  invoiceId?: string | null
  ticketId?: string | null
  orderId?: string | null
  reportKey?: string | null
  attachment?: { path: string; name: string } | null
  linkUrl?: string | null
  imageUrl?: string | null
  shareId: string
  /** The same key twice queues the message once (double clicks, retries). */
  idempotencyKey: string
}

/** Queues one message to one destination. The database checks consent, links and permissions. */
export const queueMessage = (input: QueueInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'message',
    client,
    async (c) => {
      const r = input.recipient
      const { data, error } = await c.rpc('queue_message', {
        p_channel: input.channel,
        p_integration_id: input.integrationId,
        p_customer_id: r?.kind === 'customer' ? r.id : null,
        p_lead_id: r?.kind === 'lead' ? r.id : null,
        p_profile_id: r?.kind === 'member' ? r.id : null,
        p_address: r?.kind === 'address' ? r.value.trim() : null,
        p_subject: input.subject,
        p_body: input.body,
        p_purpose: input.purpose,
        p_template_key: input.templateKey ?? null,
        p_invoice_id: input.invoiceId ?? null,
        p_ticket_id: input.ticketId ?? null,
        p_order_id: input.orderId ?? null,
        p_report_key: input.reportKey ?? null,
        p_attachment_path: input.attachment?.path ?? null,
        p_attachment_name: input.attachment?.name ?? null,
        p_link_url: input.linkUrl ?? null,
        p_image_url: input.imageUrl ?? null,
        p_share_id: input.shareId,
        p_idempotency_key: input.idempotencyKey,
      })
      if (error) return err(mapWriteError(error, 'message'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

const defaultServer = (): ServerApi => ({
  token: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init),
})

/**
 * Asks the server to send queued messages now (one Share to several platforms goes in one call).
 * Whatever happens, they are safe in the queue; the states come from the history afterwards.
 */
export async function sendMessages(
  ids: string[],
  server: ServerApi = defaultServer(),
): Promise<'sent' | 'queued'> {
  if (!ids.length) return 'sent'
  try {
    const token = await server.token()
    if (!token) return 'queued'
    const res = await server.fetch('/api/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIds: ids }),
    })
    return res.ok ? 'sent' : 'queued'
  } catch {
    return 'queued'
  }
}

/** Where each message stands now, from the history. */
export const getMessageStates = (ids: string[], client?: DbClient) =>
  guarded<
    Record<string, { state: DeliveryState; error: string | null; externalUrl: string | null }>
  >('messages', client, async (c) => {
    if (!ids.length) return ok({})
    const { data, error } = await resolveClient(c)
      .from('communication_logs')
      .select('id, status, error, external_url')
      .in('id', ids)
    if (error) return err(mapReadError(error, 'messages'))
    const out: Record<
      string,
      { state: DeliveryState; error: string | null; externalUrl: string | null }
    > = {}
    for (const r of (data ?? []) as Row[]) {
      const s = String(r.status)
      out[String(r.id)] = {
        state: (['bounced', 'complained'].includes(s)
          ? 'failed'
          : s === 'delayed'
            ? 'sent'
            : s) as DeliveryState,
        error: str(r.error),
        externalUrl: str(r.external_url),
      }
    }
    return ok(out)
  })

/** A new id for one Share action; every message it makes carries it. */
export const newShareId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12)

/**
 * Where the team can share right now: the business's connections (row security lets every staff
 * member read them; credentials are never in this table) and whether the server's built-in email
 * sender is set up.
 */
export async function listDestinations(
  client?: DbClient,
  emailSetup: () => Promise<{ ok: boolean; data?: { email: boolean } }> = async () =>
    getEmailSetup(),
): Promise<
  | { ok: true; data: { connections: IntegrationConnection[]; builtInEmail: boolean } }
  | { ok: false; error: AppError }
> {
  const rows = await guarded<Row[]>('Integrations', client, async (c) => {
    const { data, error } = await c
      .from('integrations')
      .select(
        'id, provider, channel, status, account_label, capabilities, settings, is_default, connected_at, last_checked_at, last_error',
      )
      .neq('status', 'disconnected')
      .order('is_default', { ascending: false })
    if (error) return err(mapReadError(error, 'Integrations'))
    return ok((data ?? []) as Row[])
  })
  if (!rows.ok) return rows
  const setup = await emailSetup()
  return ok({
    connections: rows.data.map((r) => ({
      id: String(r.id),
      provider: r.provider as never,
      channel: r.channel as never,
      status: r.status as never,
      accountLabel: str(r.account_label),
      capabilities: (Array.isArray(r.capabilities) ? r.capabilities : []) as never,
      settings: (r.settings ?? {}) as Record<string, string>,
      isDefault: Boolean(r.is_default),
      connectedAt: str(r.connected_at),
      lastCheckedAt: str(r.last_checked_at),
      lastError: str(r.last_error),
      webhook: null,
    })),
    builtInEmail: Boolean(setup.ok && setup.data?.email),
  })
}
