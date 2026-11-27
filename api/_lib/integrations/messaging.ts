import { createHmac, timingSafeEqual } from 'node:crypto'
import { call, failure, form, str } from './http.js'
import type { Adapter, FetchLike, OutgoingMessage, SendResult } from './types.js'
import type { Capability } from '../../../shared/integrations.js'

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// SMS through Twilio -------------------------------------------------------------------------------
const twilioAuth = (sid: string, token: string) =>
  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`

/** Where Twilio reports delivery for one connection. */
export const twilioCallbackUrl = (appUrl: string, integrationId: string) =>
  `${appUrl.replace(/\/$/, '')}/api/webhooks/messaging?provider=twilio&integration=${integrationId}`

/** The SMS text: the message, then the private document link if there is one. */
export const smsText = (m: OutgoingMessage) =>
  m.documentUrl ? `${m.text}\n\n${m.documentUrl}` : m.text

export const twilio: Adapter = {
  provider: 'twilio',
  // Twilio has no idempotency key for sending.
  idempotent: false,
  async verify(credentials, settings, ctx) {
    const sid = str(credentials.accountSid)
    const auth = { Authorization: twilioAuth(sid, str(credentials.authToken)) }
    const account = await call(
      ctx.fetch,
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      { headers: auth },
    )
    if (account.network) return { ok: false, error: `Could not reach Twilio: ${account.error}` }
    if (!account.res.ok)
      return {
        ok: false,
        error: `Twilio refused the Account SID or auth token (${account.res.status}).`,
      }
    if (str(account.body.status) !== 'active') {
      return {
        ok: false,
        error: `The Twilio account is ${str(account.body.status) || 'not active'}.`,
      }
    }
    const from = settings.from ?? ''
    const sender = from.startsWith('MG')
      ? await call(ctx.fetch, `https://messaging.twilio.com/v1/Services/${from}`, { headers: auth })
      : await call(
          ctx.fetch,
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?${form({ PhoneNumber: from })}`,
          { headers: auth },
        )
    if (sender.network) return { ok: false, error: `Could not reach Twilio: ${sender.error}` }
    const found = from.startsWith('MG')
      ? sender.res.ok
      : sender.res.ok &&
        Array.isArray(sender.body.incoming_phone_numbers) &&
        sender.body.incoming_phone_numbers.length > 0
    if (!found)
      return {
        ok: false,
        error: `${from} is not a number or Messaging Service in this Twilio account.`,
      }
    const capabilities: Capability[] = ['direct_message', 'document_links']
    // Delivery reports need Umbane's public address for Twilio to call.
    if (ctx.appUrl) capabilities.push('delivery_tracking')
    return { ok: true, account: { accountLabel: from, accountId: sid, capabilities } }
  },
  async send(m, credentials, connection, ctx) {
    const sid = str(credentials.accountSid)
    const from = connection.settings.from ?? ''
    const body: Record<string, string> = {
      To: m.to ?? '',
      Body: smsText(m),
      ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }),
      ...(ctx.appUrl ? { StatusCallback: twilioCallbackUrl(ctx.appUrl, connection.id) } : {}),
    }
    const r = await call(
      ctx.fetch,
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: twilioAuth(sid, str(credentials.authToken)),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form(body),
      },
    )
    if (r.network) return failure('Twilio', r, false)
    if (r.res.ok && str(r.body.sid)) {
      return {
        ok: true,
        id: `twilio:${str(r.body.sid)}`,
        sender: from,
        response: { status: str(r.body.status) },
      }
    }
    return failure(
      'Twilio',
      {
        status: r.res.status,
        code: r.body.code ? String(r.body.code) : undefined,
        message: str(r.body.message) || r.res.statusText,
      },
      false,
    )
  },
}

/**
 * Twilio signs each callback: HMAC-SHA1 of the full URL followed by every posted field (sorted by
 * name, name then value), keyed with the auth token, in X-Twilio-Signature.
 */
export function twilioSignatureOk(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | null,
): boolean {
  if (!signature || !authToken) return false
  const data =
    url +
    [...params.keys()]
      .sort()
      .map((k) => k + (params.get(k) ?? ''))
      .join('')
  return safeEqual(createHmac('sha1', authToken).update(data, 'utf8').digest('base64'), signature)
}

// WhatsApp Business (Meta Cloud API) --------------------------------------------------------------
export const GRAPH = 'https://graph.facebook.com/v21.0'

/** Messages that need the customer to have written in the last 24 hours. */
const WINDOW_CLOSED = new Set([131047, 131051])
const RATE_LIMITED = new Set([130429, 131048, 131056, 80007, 4, 17, 32, 613])

function whatsappFailure(
  status: number,
  body: Record<string, unknown>,
): Extract<SendResult, { ok: false }> {
  const err = (body.error ?? {}) as Record<string, unknown>
  const code = typeof err.code === 'number' ? err.code : 0
  const details = str((err.error_data as Record<string, unknown> | undefined)?.details)
  if (WINDOW_CLOSED.has(code)) {
    return {
      ok: false,
      retryable: false,
      error:
        'WhatsApp only allows free text within 24 hours of the customer’s last message. Set an approved template under Settings → Integrations → WhatsApp, or wait for them to write.',
      response: { status, code },
    }
  }
  return failure(
    'WhatsApp',
    {
      status: RATE_LIMITED.has(code) ? 429 : status,
      code: code ? String(code) : undefined,
      message: details || str(err.message) || 'refused',
    },
    false,
  )
}

async function uploadMedia(
  m: OutgoingMessage,
  phoneNumberId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<string | Extract<SendResult, { ok: false }>> {
  const file = m.attachments[0]
  const data = new FormData()
  data.append('messaging_product', 'whatsapp')
  data.append('type', file.contentType)
  data.append(
    'file',
    new Blob([Buffer.from(file.content, 'base64')], { type: file.contentType }),
    file.filename,
  )
  const r = await call(fetchImpl, `${GRAPH}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  })
  // Nothing has reached the customer yet, so an upload failure is always safe to retry.
  if (r.network)
    return {
      ok: false,
      retryable: true,
      error: `WhatsApp: the document could not be uploaded (${r.error}).`,
    }
  if (r.res.ok && str(r.body.id)) return str(r.body.id)
  const f = whatsappFailure(r.res.status, r.body)
  return { ...f, retryable: f.retryable || r.res.status >= 500 }
}

export const whatsapp: Adapter = {
  provider: 'whatsapp',
  idempotent: false,
  async verify(credentials, _settings, ctx) {
    const id = str(credentials.phoneNumberId)
    const r = await call(
      ctx.fetch,
      `${GRAPH}/${id}?${form({ fields: 'display_phone_number,verified_name' })}`,
      {
        headers: { Authorization: `Bearer ${str(credentials.accessToken)}` },
      },
    )
    if (r.network) return { ok: false, error: `Could not reach WhatsApp: ${r.error}` }
    if (!r.res.ok) {
      const err = (r.body.error ?? {}) as Record<string, unknown>
      return {
        ok: false,
        error: `Meta refused the phone number ID or token: ${str(err.message) || r.res.status}.`,
      }
    }
    const capabilities: Capability[] = ['direct_message', 'attachments']
    // Reports and replies arrive by webhook, which needs the app secret to be checked.
    if (credentials.appSecret && ctx.appUrl)
      capabilities.push('delivery_tracking', 'receive_messages')
    const name = str(r.body.verified_name)
    const number = str(r.body.display_phone_number)
    return {
      ok: true,
      account: {
        accountLabel: [name, number && `(${number})`].filter(Boolean).join(' ') || id,
        accountId: id,
        capabilities,
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    const id = str(credentials.phoneNumberId)
    const token = str(credentials.accessToken)
    const to = (m.to ?? '').replace(/^\+/, '')
    const template = connection.settings.templateName
    const documentHeader = connection.settings.templateHeader === 'document'
    if (template && m.attachments.length && !documentHeader) {
      return {
        ok: false,
        retryable: false,
        error:
          'The WhatsApp template has no document header, so it cannot carry the file. Choose a template with a document header, or send without the attachment.',
      }
    }
    let mediaId: string | null = null
    if (m.attachments.length) {
      const uploaded = await uploadMedia(m, id, token, ctx.fetch)
      if (typeof uploaded !== 'string') return uploaded
      mediaId = uploaded
    }
    const filename = m.attachments[0]?.filename
    let payload: Record<string, unknown>
    if (template) {
      payload = {
        type: 'template',
        template: {
          name: template,
          language: { code: connection.settings.templateLanguage || 'en' },
          components: [
            ...(mediaId
              ? [
                  {
                    type: 'header',
                    parameters: [{ type: 'document', document: { id: mediaId, filename } }],
                  },
                ]
              : []),
            {
              type: 'body',
              parameters: [
                { type: 'text', text: m.toName || 'there' },
                { type: 'text', text: m.text.slice(0, 1000) },
              ],
            },
          ],
        },
      }
    } else if (mediaId) {
      payload = {
        type: 'document',
        document: { id: mediaId, filename, caption: m.text.slice(0, 1024) },
      }
    } else {
      payload = { type: 'text', text: { body: m.text, preview_url: true } }
    }
    const r = await call(ctx.fetch, `${GRAPH}/${id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...payload,
      }),
    })
    if (r.network) return failure('WhatsApp', r, false)
    const sent = Array.isArray(r.body.messages)
      ? (r.body.messages[0] as Record<string, unknown>)
      : null
    if (r.res.ok && sent && str(sent.id)) {
      return {
        ok: true,
        id: `whatsapp:${str(sent.id)}`,
        sender: connection.accountLabel,
        response: { type: str(payload.type) },
      }
    }
    return whatsappFailure(r.res.status, r.body)
  },
}

/** Meta signs each webhook with the app secret: X-Hub-Signature-256: sha256=<hex HMAC of the body>. */
export function metaSignatureOk(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
  return safeEqual(expected, header)
}
