import type { Capability, Channel, ProviderKey } from '@shared/integrations'

export type ConnectionStatus = 'connected' | 'error' | 'disconnected'

/** A connection as the server shows it. Credentials never reach the browser. */
export interface IntegrationConnection {
  id: string
  provider: ProviderKey
  channel: Channel
  status: ConnectionStatus
  accountLabel: string | null
  capabilities: Capability[]
  settings: Record<string, string>
  isDefault: boolean
  connectedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
  /** Where the provider reports back (administrators only). */
  webhook: { url: string; verifyToken?: string } | null
}

export interface ProviderReadiness {
  key: ProviderKey
  /** The server has what this provider needs to be connected. */
  ready: boolean
  /** Server settings (Vercel) still missing, by name. */
  missing: string[]
}

export interface IntegrationsOverview {
  providers: ProviderReadiness[]
  connections: IntegrationConnection[]
  /** Email through Resend with the keys set in Vercel, used when no email account is connected. */
  builtInEmail: { ready: boolean; from: string | null }
  /** What to register as the redirect address with OAuth providers. */
  redirectUri: string | null
}

/** One place a share can go: a channel, through a connection (or the built-in email). */
export interface Destination {
  channel: Channel
  connection: IntegrationConnection | null
  /** Shown to people: "Gmail (accounts@…)", "SMS (+27…)". */
  label: string
}

/** Who a direct message goes to. Always someone on file, or a typed address (managers). */
export type Recipient =
  | { kind: 'customer'; id: string; name: string }
  | { kind: 'lead'; id: string; name: string }
  | { kind: 'member'; id: string; name: string }
  | { kind: 'address'; value: string }

/** What a recipient has on file, and what stops each channel. */
export interface Reachability {
  email: string | null
  phone: string | null
  /** Why each direct channel cannot be used for them, if it cannot. */
  blocked: Partial<Record<'email' | 'sms' | 'whatsapp', string>>
  marketingConsent: boolean
}

export type DeliveryState =
  'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled' | 'refused'

/** One destination's result after Share: which platform, to whom, and what happened. */
export interface ShareResult {
  key: string
  channel: Channel
  recipientLabel: string
  messageId: string | null
  state: DeliveryState
  error: string | null
}
