import type { Result } from '@/types/api'
import type { ListQuery, Page } from '@/types/customers'
import type {
  Channel,
  ContactInput,
  CustomerPreferences,
  Direction,
  EmailInput,
  EmailSetup,
  Message,
  MessageEvent,
  MessageListItem,
  MessageStatus,
  MessageSummary,
  MessageTemplate,
  Purpose,
  TemplateInput,
} from '@/types/messages'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { safeFileName } from '@/utils/files'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'
import { getSupabase } from './supabase'
import type { StorageApi } from './storageFiles'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

const fromListRow = (r: Row): MessageListItem => ({
  id: String(r.id),
  channel: String(r.channel) as Channel,
  direction: String(r.direction) as Direction,
  status: (str(r.status) ?? 'logged') as MessageStatus,
  purpose: (str(r.purpose) ?? 'transactional') as Purpose,
  subject: str(r.subject),
  recipient: str(r.recipient),
  customerId: str(r.customer_id),
  customerName: str(r.customer_name),
  invoiceId: str(r.invoice_id),
  invoiceNumber: str(r.invoice_number),
  ticketId: str(r.ticket_id),
  ticketReference: str(r.ticket_reference),
  createdByName: str(r.created_by_name),
  createdAt: String(r.created_at),
  sentAt: str(r.sent_at),
  deliveredAt: str(r.delivered_at),
  attempts: num(r.attempts),
  nextAttemptAt: str(r.next_attempt_at),
  willRetry: Boolean(r.will_retry),
  error: str(r.error),
  messageType: str(r.message_type) ?? undefined,
  provider: str(r.provider),
  sender: str(r.sender),
  recipientName: str(r.recipient_name),
  leadId: str(r.lead_id),
  leadName: str(r.lead_name),
  externalUrl: str(r.external_url),
})

export interface MessageFilters {
  /** "attention" = failed, bounced or marked as spam. */
  status: MessageStatus | 'attention' | ''
  channel: Channel | ''
  customerId?: string
}

export type MessageSort = 'created_at'

export const listMessages = (
  query: ListQuery<MessageSort>,
  filters: MessageFilters,
  client?: DbClient,
) =>
  guarded<Page<MessageListItem>>('Messages', client, async (c) => {
    let q = c.from('message_list').select('*', { count: 'exact' })
    if (filters.status === 'attention') q = q.in('status', ['failed', 'bounced', 'complained'])
    else if (filters.status) q = q.eq('status', filters.status)
    if (filters.channel) q = q.eq('channel', filters.channel)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    const or = orIlike(['subject', 'recipient', 'customer_name'], query.search)
    if (or) q = q.or(or)
    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order('created_at', { ascending: query.ascending })
      .order('id')
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Messages'))
    return ok({ total: count ?? 0, rows: ((data ?? []) as Row[]).map(fromListRow) })
  })

export const getMessage = (id: string, client?: DbClient) =>
  guarded<Message>('Message', client, async (c) => {
    const { data, error } = await c.from('message_list').select('*').eq('id', id).maybeSingle()
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Message'))
    if (error || !data)
      return err({ code: 'not_found', message: 'This message could not be found.' })
    const r = data as Row
    return ok({
      ...fromListRow(r),
      body: str(r.body),
      templateKey: str(r.template_key),
      attachmentName: str(r.attachment_name),
      lastEventAt: str(r.last_event_at),
    })
  })

export const listMessageEvents = (id: string, client?: DbClient) =>
  guarded<MessageEvent[]>('Delivery history', client, async (c) => {
    const { data, error } = await c
      .from('message_events')
      .select('id, event, detail, occurred_at')
      .eq('message_id', id)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) return err(mapReadError(error, 'Delivery history'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        event: String(r.event),
        detail: (r.detail ?? null) as Record<string, unknown> | null,
        occurredAt: String(r.occurred_at),
      })),
    )
  })

export const getMessageSummary = (client?: DbClient) =>
  guarded<MessageSummary>('Message totals', client, async (c) => {
    const { data, error } = await c.from('message_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Message totals'))
    const r = (data ?? {}) as Row
    return ok({
      sentThisMonth: num(r.sent_this_month),
      deliveredThisMonth: num(r.delivered_this_month),
      bouncedThisMonth: num(r.bounced_this_month),
      waiting: num(r.waiting),
      failed: num(r.failed),
    })
  })

// Sending -------------------------------------------------------------------------------------------
/** How the browser reaches the server functions; tests pass a fake. */
export interface ServerApi {
  token: () => Promise<string | null>
  fetch: (url: string, init: RequestInit) => Promise<Response>
}

const defaultServer = (): ServerApi => ({
  token: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init),
})

export type SendOutcome =
  | { state: 'sent' }
  | { state: 'queued'; reason: 'not_configured' | 'unavailable' }
  | { state: 'failed'; error: string | null; willRetry: boolean }

/** Asks the server to send a queued email now. The email is safe in the queue whatever happens. */
export async function sendNow(
  messageId: string,
  server: ServerApi = defaultServer(),
): Promise<SendOutcome> {
  try {
    const token = await server.token()
    if (!token) return { state: 'queued', reason: 'unavailable' }
    const res = await server.fetch('/api/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    })
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('application/json')) return { state: 'queued', reason: 'unavailable' }
    const body = (await res.json()) as {
      status?: string
      error?: string | null
      configured?: boolean
    }
    if (res.status === 503 || body.configured === false)
      return { state: 'queued', reason: 'not_configured' }
    if (!res.ok) return { state: 'queued', reason: 'unavailable' }
    if (body.status === 'failed')
      return { state: 'failed', error: body.error ?? null, willRetry: true }
    if (body.status === 'queued' || body.status === 'sending')
      return { state: 'queued', reason: 'unavailable' }
    return { state: 'sent' }
  } catch {
    return { state: 'queued', reason: 'unavailable' }
  }
}

export async function getEmailSetup(
  server: ServerApi = defaultServer(),
): Promise<Result<EmailSetup>> {
  try {
    const token = await server.token()
    const res = await server.fetch('/api/messages/status', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!(res.headers.get('content-type') ?? '').includes('application/json') || !res.ok) {
      return err({ code: 'unknown', message: 'The email server could not be reached.' })
    }
    const b = (await res.json()) as Partial<EmailSetup>
    return ok({
      email: Boolean(b.email),
      missing: Array.isArray(b.missing) ? b.missing.map(String) : [],
      deliveryReports: Boolean(b.deliveryReports),
      retries: Boolean(b.retries),
      from: b.from ?? null,
    })
  } catch {
    return err({ code: 'network', message: 'The email server could not be reached.' })
  }
}

/** Records the email (the database checks consent and links), then asks the server to send it. */
export const queueEmail = (input: EmailInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'email',
    client,
    async (c) => {
      const { data, error } = await c.rpc('queue_email', {
        p_customer_id: input.customerId,
        p_subject: input.subject,
        p_body: input.body,
        p_template_key: input.templateKey,
        p_purpose: input.purpose,
        p_invoice_id: input.invoiceId ?? null,
        p_ticket_id: input.ticketId ?? null,
        p_attachment_path: input.attachment?.path ?? null,
        p_attachment_name: input.attachment?.name ?? null,
      })
      if (error) return err(mapWriteError(error, 'email'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

const rpcVoid = (fn: string, id: string, what: string, client?: DbClient) =>
  guarded<null>(
    what,
    client,
    async (c) => {
      const { error } = await c.rpc(fn, { p_id: id })
      if (error) return err(mapWriteError(error, what))
      return ok(null)
    },
    mapWriteError,
  )

export const retryMessage = (id: string, client?: DbClient) =>
  rpcVoid('retry_message', id, 'email', client)
export const cancelMessage = (id: string, client?: DbClient) =>
  rpcVoid('cancel_message', id, 'email', client)

/** Uploads a generated PDF so the server can attach it. */
export async function uploadEmailAttachment(
  businessId: string,
  bytes: Uint8Array,
  name: string,
  storage?: StorageApi,
): Promise<Result<{ path: string; name: string }>> {
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now())
  const path = `${businessId}/${key}/${safeFileName(name)}`
  try {
    const { error } = await (storage ?? getSupabase().storage)
      .from('message-attachments')
      .upload(path, new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (error)
      return err({ code: 'unknown', message: 'The PDF could not be attached. Please try again.' })
    return ok({ path, name })
  } catch {
    return err({ code: 'network', message: 'The PDF could not be attached. Please try again.' })
  }
}

/** The business name, for {{business_name}}. */
export const getBusinessName = (client?: DbClient) =>
  guarded<string>('Business', client, async (c) => {
    const { data, error } = await c.from('businesses').select('name').maybeSingle()
    if (error) return err(mapReadError(error, 'Business'))
    return ok(str((data as Row | null)?.name) ?? '')
  })

// Logged contacts, preferences and history ------------------------------------------------------------
export const logContact = (input: ContactInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'contact',
    client,
    async (c) => {
      const { data, error } = await c
        .from('communication_logs')
        .insert({
          customer_id: input.customerId,
          channel: input.channel,
          direction: input.direction,
          subject: input.subject,
          body: input.body.trim(),
        })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'contact'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const getCustomerPreferences = (customerId: string, client?: DbClient) =>
  guarded<CustomerPreferences>('Communication preferences', client, async (c) => {
    const { data, error } = await c
      .from('customers')
      .select(
        'email, email_opt_out, marketing_consent, consent_updated_at, email_suppressed_at, email_suppressed_reason, sms_opt_out, whatsapp_opt_in',
      )
      .eq('id', customerId)
      .maybeSingle()
    if (error) return err(mapReadError(error, 'Communication preferences'))
    const r = (data ?? {}) as Row
    return ok({
      email: str(r.email),
      emailOptOut: Boolean(r.email_opt_out),
      marketingConsent: Boolean(r.marketing_consent),
      consentUpdatedAt: str(r.consent_updated_at),
      suppressedAt: str(r.email_suppressed_at),
      suppressedReason: str(r.email_suppressed_reason) as CustomerPreferences['suppressedReason'],
      smsOptOut: Boolean(r.sms_opt_out),
      whatsappOptIn: Boolean(r.whatsapp_opt_in),
    })
  })

export const setCustomerPreferences = (
  customerId: string,
  prefs: {
    emailOptOut: boolean
    marketingConsent: boolean
    smsOptOut?: boolean
    whatsappOptIn?: boolean
  },
  client?: DbClient,
) =>
  guarded<null>(
    'preferences',
    client,
    async (c) => {
      const { data, error } = await c
        .from('customers')
        .update({
          email_opt_out: prefs.emailOptOut,
          marketing_consent: prefs.marketingConsent,
          ...(prefs.smsOptOut === undefined ? {} : { sms_opt_out: prefs.smsOptOut }),
          ...(prefs.whatsappOptIn === undefined ? {} : { whatsapp_opt_in: prefs.whatsappOptIn }),
        })
        .eq('id', customerId)
        .select('id')
      if (error) return err(mapWriteError(error, 'preferences'))
      if (!data || data.length === 0)
        return err({ code: 'forbidden', message: 'You do not have permission to change this.' })
      return ok(null)
    },
    mapWriteError,
  )

// Templates -------------------------------------------------------------------------------------------
const fromTemplate = (r: Row): MessageTemplate => ({
  id: String(r.id),
  key: String(r.key),
  name: String(r.name),
  purpose: String(r.purpose) as Purpose,
  subject: String(r.subject),
  body: String(r.body),
  isActive: Boolean(r.is_active),
  updatedAt: String(r.updated_at),
})

export const listTemplates = (client?: DbClient) =>
  guarded<MessageTemplate[]>('Templates', client, async (c) => {
    const { data, error } = await c
      .from('message_templates')
      .select('id, key, name, purpose, subject, body, is_active, updated_at')
      .order('name')
    if (error) return err(mapReadError(error, 'Templates'))
    return ok(((data ?? []) as Row[]).map(fromTemplate))
  })

/** Managers only; the key of an existing template never changes. */
export const saveTemplate = (id: string | null, input: TemplateInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'template',
    client,
    async (c) => {
      const row = {
        name: input.name.trim(),
        purpose: input.purpose,
        subject: input.subject.trim(),
        body: input.body.trim(),
        is_active: input.isActive,
      }
      const q = id
        ? c.from('message_templates').update(row).eq('id', id).select('id')
        : c
            .from('message_templates')
            .insert({ ...row, key: input.key })
            .select('id')
      const { data, error } = await q
      if (error) return err(mapWriteError(error, 'template'))
      const rows = (data ?? []) as Row[]
      if (rows.length === 0)
        return err({ code: 'forbidden', message: 'Only a manager can change templates.' })
      return ok({ id: String(rows[0].id) })
    },
    mapWriteError,
  )
