import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AdminClient, DeliveryConfig } from './deliver.js'
import { encryptionKey } from './integrations/crypto.js'
import type { Db } from './integrations/store.js'
import type { AdapterContext, OAuthApp, OAuthApps } from './integrations/types.js'
import { sendViaResend } from './resend.js'

/**
 * Server settings, read from Vercel's environment variables. None of these reach the browser:
 * only names starting with VITE_ are built into the app.
 */
export interface ServerEnv {
  supabaseUrl: string | null
  serviceKey: string | null
  resendKey: string | null
  emailFrom: string | null
  replyTo: string | null
  webhookSecret: string | null
  cronSecret: string | null
  /** The app's address, for links in emails (APP_URL, or the Vercel production domain). */
  appUrl: string | null
  /** Encrypts provider credentials (Settings → Integrations): 32 random bytes, base64. */
  integrationsKey: string | null
  /** Umbane's own app id and secret with each OAuth provider. */
  oauth: OAuthApps
}

const value = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

const app = (id: string | undefined, secret: string | undefined): OAuthApp | undefined => {
  const clientId = value(id)
  const clientSecret = value(secret)
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

export const readEnv = (env: Record<string, string | undefined> = process.env): ServerEnv => ({
  supabaseUrl: value(env.SUPABASE_URL) ?? value(env.VITE_SUPABASE_URL),
  serviceKey: value(env.SUPABASE_SERVICE_ROLE_KEY),
  resendKey: value(env.RESEND_API_KEY),
  emailFrom: value(env.EMAIL_FROM),
  replyTo: value(env.EMAIL_REPLY_TO),
  webhookSecret: value(env.RESEND_WEBHOOK_SECRET),
  cronSecret: value(env.CRON_SECRET),
  appUrl:
    value(env.APP_URL) ??
    (value(env.VERCEL_PROJECT_PRODUCTION_URL)
      ? `https://${value(env.VERCEL_PROJECT_PRODUCTION_URL)}`
      : null),
  integrationsKey: value(env.INTEGRATIONS_KEY),
  oauth: {
    google: app(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    microsoft: app(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET),
    meta: app(env.META_APP_ID, env.META_APP_SECRET),
    linkedin: app(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET),
  },
})

/** What is missing before email can be sent, by setting name. Empty when ready. */
export const missingForEmail = (e: ServerEnv) =>
  (
    [
      ['SUPABASE_SERVICE_ROLE_KEY', e.serviceKey],
      ['SUPABASE_URL', e.supabaseUrl],
      ['RESEND_API_KEY', e.resendKey],
      ['EMAIL_FROM', e.emailFrom],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k)

export function adminClient(e: ServerEnv): SupabaseClient {
  if (!e.supabaseUrl || !e.serviceKey) throw new Error('Supabase server settings are missing.')
  return createClient(e.supabaseUrl, e.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Whether anything can be sent: the database settings, and the built-in email or connections. */
export const canSend = (e: ServerEnv) =>
  Boolean(
    e.supabaseUrl &&
    e.serviceKey &&
    ((e.resendKey && e.emailFrom) || encryptionKey(e.integrationsKey)),
  )

export const adapterContext = (e: ServerEnv): AdapterContext => ({
  fetch: (input, init) => fetch(input, init),
  appUrl: e.appUrl,
  oauth: e.oauth,
  now: () => Date.now(),
})

/**
 * How messages go out: the built-in email sender (when its settings are there) and, given the
 * service-role client, each business's connections from Settings → Integrations.
 */
export const deliveryConfig = (e: ServerEnv, admin?: unknown): DeliveryConfig => ({
  from: e.resendKey && e.emailFrom ? e.emailFrom : '',
  replyTo: e.replyTo ?? undefined,
  send: (email) => sendViaResend(email, e.resendKey ?? ''),
  integrations: admin
    ? { db: admin as Db, key: encryptionKey(e.integrationsKey), ctx: adapterContext(e) }
    : null,
})

/** A constant-time check of "Authorization: Bearer <CRON_SECRET>". No secret set: always false. */
export function isCronRequest(request: Request, secret: string | null): boolean {
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** The signed-in person behind a request, if they are active staff, with their business. */
export interface StaffCaller {
  id: string
  businessId: string
  role?: string
}

/** How often each endpoint may be called, per key, per minute. */
export const RATE_LIMITS = {
  send: 20,
  flush: 10,
  status: 30,
  webhook: 600,
  integrations: 30,
  invitations: 20,
  documents: 60,
  calendar: 60,
} as const

/**
 * Counts one call against `key` in the database (rate_limit_hit) and says whether it is allowed.
 * If the check itself cannot run (for example the migration is missing) the call is allowed: a
 * broken limiter must not stop email from being sent.
 */
export async function withinRateLimit(
  admin: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>
  },
  key: string,
  perMinute: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: perMinute,
      p_window_seconds: 60,
    })
    return error ? true : data !== false
  } catch {
    return true
  }
}

export const tooManyRequests = () =>
  new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': '60',
    },
  })

/** The caller's address as Vercel reports it, for limiting unauthenticated endpoints. */
export const clientAddress = (request: Request) =>
  (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

/** The signed-in person behind a request, if active (any role, clients included). */
export async function signedInCaller(
  admin: Pick<SupabaseClient, 'auth' | 'from'>,
  request: Request,
): Promise<StaffCaller | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  const profile = await admin
    .from('profiles')
    .select('id, business_id, is_active')
    .eq('id', data.user.id)
    .maybeSingle()
  const p = profile.data as { id: string; business_id: string; is_active: boolean } | null
  if (profile.error || !p || !p.is_active) return null
  return { id: p.id, businessId: p.business_id }
}

export async function staffCaller(
  admin: Pick<SupabaseClient, 'auth' | 'from'>,
  request: Request,
): Promise<StaffCaller | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  const profile = await admin
    .from('profiles')
    .select('id, business_id, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle()
  const p = profile.data as {
    id: string
    business_id: string
    role: string
    is_active: boolean
  } | null
  if (profile.error || !p || !p.is_active || p.role === 'client') return null
  return { id: p.id, businessId: p.business_id, role: p.role }
}

/** The signed-in person behind a request, if they are an active administrator. */
export async function adminCaller(
  admin: Pick<SupabaseClient, 'auth' | 'from'>,
  request: Request,
): Promise<StaffCaller | null> {
  const caller = await staffCaller(admin, request)
  return caller && caller.role === 'administrator' ? caller : null
}

export type { AdminClient }
