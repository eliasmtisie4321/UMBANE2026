import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * Provider credentials (API keys, OAuth tokens) are encrypted with AES-256-GCM before they reach
 * the database, with a key that only exists in the server's environment (INTEGRATIONS_KEY). The
 * integration's id is bound in as associated data, so one connection's secrets cannot be copied onto
 * another. Nothing here ever runs in the browser.
 */

const VERSION = 'v1'

/** INTEGRATIONS_KEY: 32 random bytes as base64 (openssl rand -base64 32), or 64 hex characters. */
export function encryptionKey(value: string | null): Buffer | null {
  if (!value) return null
  const v = value.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex')
  try {
    const b = Buffer.from(v, 'base64')
    return b.length === 32 ? b : null
  } catch {
    return null
  }
}

export function encryptSecrets(
  data: Record<string, unknown>,
  key: Buffer,
  integrationId: string,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(integrationId))
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

/** Throws if the text was changed, belongs to another integration or used another key. */
export function decryptSecrets(
  text: string,
  key: Buffer,
  integrationId: string,
): Record<string, unknown> {
  const [version, payload] = text.split('.', 2)
  if (version !== VERSION || !payload) throw new Error('Unknown secret format')
  const raw = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(integrationId))
  decipher.setAuthTag(raw.subarray(12, 28))
  const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
    'utf8',
  )
  return JSON.parse(plain) as Record<string, unknown>
}

/** Random text safe in a URL. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex')

/** PKCE (RFC 7636): the verifier stays on the server; the provider only sees its hash. */
export function pkcePair() {
  const verifier = randomToken(48)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * The token Meta asks for when a WhatsApp webhook is set up. Derived from the integration id with
 * the server's key, so nothing extra is stored and nobody can guess another business's token.
 */
export const webhookVerifyToken = (integrationId: string, key: Buffer) =>
  createHmac('sha256', key).update(`whatsapp-webhook:${integrationId}`).digest('hex').slice(0, 40)
