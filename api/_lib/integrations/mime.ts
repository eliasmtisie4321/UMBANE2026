import { randomBytes } from 'node:crypto'
import type { OutgoingAttachment } from './types.js'

/** A header value with only plain ASCII left as is; anything else is UTF-8 encoded (RFC 2047). */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

/** "Name <address>", with the name quoted or encoded; header injection is impossible. */
export function mailbox(address: string, name?: string | null): string {
  const addr = address.replace(/[\r\n<>]/g, '')
  if (!name) return addr
  const n = name.replace(/[\r\n"<>]/g, '').trim()
  if (!n) return addr
  return /^[\x20-\x7e]*$/.test(n) ? `"${n}" <${addr}>` : `${encodeHeader(n)} <${addr}>`
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd()

export interface MimeEmail {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  text: string
  html: string
  attachments: OutgoingAttachment[]
  messageId: string
}

/** A complete email (RFC 5322 with MIME), as Gmail's API takes it. */
export function buildMime(e: MimeEmail, boundarySeed = randomBytes(12).toString('hex')): string {
  const mixed = `mixed_${boundarySeed}`
  const alt = `alt_${boundarySeed}`
  const lines = [
    `From: ${e.from}`,
    `To: ${e.to}`,
    ...(e.replyTo ? [`Reply-To: ${e.replyTo}`] : []),
    `Subject: ${encodeHeader(e.subject)}`,
    `Message-ID: ${e.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(e.text, 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(e.html, 'utf8').toString('base64')),
    `--${alt}--`,
  ]
  for (const a of e.attachments) {
    const name = encodeHeader(a.filename.replace(/["\r\n]/g, ''))
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(a.content),
    )
  }
  lines.push(`--${mixed}--`, '')
  return lines.join('\r\n')
}
