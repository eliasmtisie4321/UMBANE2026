import {
  CAPABILITIES,
  providerInfo,
  type Capability,
  type ProviderInfo,
  type ProviderKey,
} from '../../../shared/integrations.js'
import { googleCalendar } from './calendar.js'
import { google, microsoft, resend } from './email.js'
import { twilio, whatsapp } from './messaging.js'
import { facebook, instagram, linkedin } from './social.js'
import type { Adapter, OAuthApps } from './types.js'

/** The adapter behind each provider in shared/integrations.ts. TikTok has none (unavailable). */
export const ADAPTERS: Partial<Record<ProviderKey, Adapter>> = {
  resend,
  google,
  microsoft,
  twilio,
  whatsapp,
  facebook,
  instagram,
  linkedin,
  google_calendar: googleCalendar,
}

export function adapterFor(provider: string): Adapter | null {
  const info = providerInfo(provider)
  if (!info || info.connect === 'unavailable') return null
  return ADAPTERS[info.key] ?? null
}

/** Whether the server has the app id and secret an OAuth provider needs. */
export function oauthReady(provider: string, apps: OAuthApps): boolean {
  const flow = adapterFor(provider)?.oauth
  return Boolean(flow && apps[flow.app])
}

/** Where providers send people back after signing in. Register exactly this with each provider. */
export const redirectUri = (appUrl: string) =>
  `${appUrl.replace(/\/$/, '')}/api/integrations/callback`

/** Only what the provider confirmed, and never more than the provider can do. */
export const allowedCapabilities = (info: ProviderInfo, confirmed: Capability[]) =>
  CAPABILITIES.filter((c) => confirmed.includes(c) && info.capabilities.includes(c))
