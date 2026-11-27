import type { Capability, ProviderKey } from '../../../shared/integrations.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Decrypted credentials for one connection (API keys, OAuth tokens). Server memory only. */
export type Credentials = Record<string, unknown>

/** A connection as the adapters see it. */
export interface Connection {
  id: string
  businessId: string
  provider: ProviderKey
  accountLabel: string | null
  accountId: string | null
  capabilities: Capability[]
  settings: Record<string, string>
}

/** What a provider confirmed when it was connected or tested. */
export interface VerifiedAccount {
  accountLabel: string
  accountId: string
  /** Only what the provider actually confirmed (granted scopes, configured webhooks). */
  capabilities: Capability[]
  /** Non-secret details learned while verifying (a page list, the mailbox address). */
  settings?: Record<string, string>
  /** Credentials changed while verifying (a long-lived token swapped in). */
  credentials?: Credentials
}

export type VerifyResult = { ok: true; account: VerifiedAccount } | { ok: false; error: string }

export interface OutgoingAttachment {
  filename: string
  contentType: string
  /** Base64. */
  content: string
  bytes: number
}

/** One message to one destination, ready for the provider. */
export interface OutgoingMessage {
  id: string
  /** Address or E.164 number; null for public posts. */
  to: string | null
  toName: string | null
  subject: string | null
  text: string
  html: string
  attachments: OutgoingAttachment[]
  /** A private link to the document, for channels that cannot carry it (SMS). */
  documentUrl: string | null
  linkUrl: string | null
  imageUrl: string | null
  /** The same key is never sent twice by providers that support it. */
  idempotencyKey: string
  purpose: 'transactional' | 'marketing'
}

export type SendResult =
  | {
      ok: true
      /** The provider's id for it, prefixed with the provider (Resend ids stay bare). */
      id: string | null
      externalUrl?: string | null
      /** The account it went from, as the provider reported it. */
      sender?: string | null
      response?: Record<string, unknown>
    }
  | { ok: false; retryable: boolean; error: string; response?: Record<string, unknown> }

export interface AdapterContext {
  fetch: FetchLike
  /** Where the provider can report back to Umbane (webhooks, status callbacks), if known. */
  appUrl: string | null
  /** The app ids and secrets for OAuth providers, from the server's environment. */
  oauth: OAuthApps
  now: () => number
}

export interface OAuthApp {
  clientId: string
  clientSecret: string
}
export type OAuthApps = Partial<Record<'google' | 'microsoft' | 'meta' | 'linkedin', OAuthApp>>

export interface OAuthGrant {
  credentials: Credentials
  /** Scopes the person actually granted, which may be fewer than asked for. */
  scopes: string[]
}

export interface OAuthFlow {
  /** Which app settings this provider uses. */
  app: keyof OAuthApps
  /** The provider's sign-in page for this business. */
  authorizeUrl(p: {
    clientId: string
    redirectUri: string
    state: string
    challenge: string
  }): string
  exchange(
    p: { code: string; verifier: string; redirectUri: string },
    ctx: AdapterContext,
  ): Promise<OAuthGrant>
}

export interface Adapter {
  provider: ProviderKey
  /**
   * True when the provider itself refuses a repeated request (an idempotency key), so a send that
   * may or may not have gone through can safely be tried again. Otherwise such a send waits for a
   * person, rather than risk sending it twice.
   */
  idempotent: boolean
  /** Checks the credentials with the provider and says what this connection can do. */
  verify(
    credentials: Credentials,
    settings: Record<string, string>,
    ctx: AdapterContext,
    connectionId: string,
  ): Promise<VerifyResult>
  send(
    message: OutgoingMessage,
    credentials: Credentials,
    connection: Connection,
    ctx: AdapterContext,
  ): Promise<SendResult>
  /**
   * Swaps an expired access token for a new one. Returns the new credentials, or null when the
   * person has to connect again (the grant was revoked or has run out).
   */
  refresh?(credentials: Credentials, ctx: AdapterContext): Promise<Credentials | null>
  /** Tells the provider to forget the grant, where it offers that. Best effort. */
  revoke?(credentials: Credentials, ctx: AdapterContext): Promise<void>
  oauth?: OAuthFlow
}

export class ProviderError extends Error {}
