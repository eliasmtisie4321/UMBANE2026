/** Sending through Resend (https://resend.com/docs/api-reference/emails/send-email). */

export interface OutgoingEmail {
  from: string
  to: string
  replyTo?: string
  subject: string
  text: string
  html: string
  attachments?: { filename: string; content: string }[]
  /** Resend keeps this for 24 hours: the same key never sends twice. */
  idempotencyKey: string
  tags?: { name: string; value: string }[]
}

export type SendResult = { ok: true; id: string } | { ok: false; retryable: boolean; error: string }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * Temporary problems (network, rate limits, provider outages) are retryable; anything else the
 * provider refuses (bad address, unverified domain, bad key) is not, and waits for a person.
 */
export async function sendViaResend(
  email: OutgoingEmail,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  let res: Response
  try {
    res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.attachments?.length ? { attachments: email.attachments } : {}),
        ...(email.tags?.length ? { tags: email.tags } : {}),
      }),
    })
  } catch (e) {
    return {
      ok: false,
      retryable: true,
      error: `Network error: ${(e as Error).message}`.slice(0, 300),
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // A body that is not JSON is described by its status below.
  }
  if (res.ok && typeof body.id === 'string') return { ok: true, id: body.id }

  const name = typeof body.name === 'string' ? body.name : ''
  const message = typeof body.message === 'string' ? body.message : res.statusText
  const retryable =
    res.status === 429 ||
    res.status >= 500 ||
    (res.status === 409 && name === 'concurrent_idempotent_requests') ||
    (res.ok && typeof body.id !== 'string')
  return {
    ok: false,
    retryable,
    error: `Resend ${res.status}${name ? ` ${name}` : ''}: ${message}`.slice(0, 300),
  }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Plain text as simple, safe HTML: escaped, paragraphs kept, nothing from the text is markup. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b1b1f">${paragraphs}</body></html>`
}
