import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AdminClient, DeliveryConfig } from './deliver.js'
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
}

const value = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

export const readEnv = (env: Record<string, string | undefined> = process.env): ServerEnv => ({
  supabaseUrl: value(env.SUPABASE_URL) ?? value(env.VITE_SUPABASE_URL),
  serviceKey: value(env.SUPABASE_SERVICE_ROLE_KEY),
  resendKey: value(env.RESEND_API_KEY),
  emailFrom: value(env.EMAIL_FROM),
  replyTo: value(env.EMAIL_REPLY_TO),
  webhookSecret: value(env.RESEND_WEBHOOK_SECRET),
  cronSecret: value(env.CRON_SECRET),
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

export const deliveryConfig = (e: ServerEnv): DeliveryConfig => ({
  from: e.emailFrom ?? '',
  replyTo: e.replyTo ?? undefined,
  send: (email) => sendViaResend(email, e.resendKey ?? ''),
})

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** The signed-in person behind a request, if they are active staff, with their business. */
export interface StaffCaller {
  id: string
  businessId: string
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
  return { id: p.id, businessId: p.business_id }
}

export type { AdminClient }
