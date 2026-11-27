import { getSupabase } from './supabase'
import type { ServerApi } from './messages'
import type { IntegrationConnection, IntegrationsOverview } from '@/types/integrations'
import type { Result } from '@/types/api'
import { err, ok } from '@/utils/result'

/**
 * Settings → Integrations. Everything goes through the server (/api/integrations): it verifies a
 * provider before calling it connected, and keeps the credentials encrypted where the app cannot
 * read them.
 */
const defaultServer = (): ServerApi => ({
  token: async () => (await getSupabase().auth.getSession()).data.session?.access_token ?? null,
  fetch: (url, init) => fetch(url, init),
})

const NOT_REACHABLE = 'The server could not be reached. Please try again.'

/** The server's answer for a refused change, in words for people. */
function reason(status: number, body: Record<string, unknown>): string {
  if (typeof body.message === 'string' && body.message) return body.message
  if (status === 403) return 'Only administrators can change integrations.'
  if (status === 429) return 'Too many changes at once. Wait a minute and try again.'
  if (body.error === 'not_configured') {
    const missing = Array.isArray(body.missing) ? body.missing.join(', ') : ''
    return `The server is not set up for this yet${missing ? ` (missing: ${missing})` : ''}.`
  }
  if (body.error === 'invalid') return 'Some details are not valid.'
  return NOT_REACHABLE
}

async function call<T>(
  method: 'GET' | 'POST',
  body: Record<string, unknown> | null,
  server: ServerApi,
): Promise<Result<T> & { fields?: Record<string, string> }> {
  try {
    const token = await server.token()
    if (!token) return err({ code: 'unauthenticated', message: 'Please sign in again.' })
    const res = await server.fetch('/api/integrations', {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      return err({ code: 'unknown', message: NOT_REACHABLE })
    }
    const data = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      const r = err({
        code: res.status === 422 ? 'validation' : 'unknown',
        message: reason(res.status, data),
      })
      return Object.assign(r, data.fields ? { fields: data.fields as Record<string, string> } : {})
    }
    return ok(data as T)
  } catch {
    return err({ code: 'network', message: NOT_REACHABLE })
  }
}

/** What is connected. A partial answer is filled in, so the page never breaks on it. */
export async function getIntegrations(
  server: ServerApi = defaultServer(),
): Promise<Result<IntegrationsOverview>> {
  const r = await call<Partial<IntegrationsOverview>>('GET', null, server)
  if (!r.ok) return r
  return ok({
    providers: Array.isArray(r.data.providers) ? r.data.providers : [],
    connections: Array.isArray(r.data.connections) ? r.data.connections : [],
    builtInEmail: r.data.builtInEmail ?? { ready: false, from: null },
    redirectUri: r.data.redirectUri ?? null,
  })
}

export const connectWithKeys = (
  provider: string,
  fields: Record<string, string>,
  settings: Record<string, string>,
  server: ServerApi = defaultServer(),
) =>
  call<{ connection: IntegrationConnection }>(
    'POST',
    { action: 'connect', provider, fields, settings },
    server,
  )

/** Where to send the administrator to sign in with the provider. */
export const startOAuth = (provider: string, server: ServerApi = defaultServer()) =>
  call<{ url: string }>('POST', { action: 'oauth_start', provider }, server)

export const testIntegration = (
  id: string,
  sendTest: boolean,
  server: ServerApi = defaultServer(),
) =>
  call<{
    connection: IntegrationConnection
    testEmail: { sent: boolean; to?: string; error?: string } | null
  }>('POST', { action: 'test', id, sendTest }, server)

export const updateIntegrationSettings = (
  id: string,
  settings: Record<string, string>,
  server: ServerApi = defaultServer(),
) =>
  call<{ connection: IntegrationConnection }>('POST', { action: 'settings', id, settings }, server)

export const setDefaultIntegration = (id: string, server: ServerApi = defaultServer()) =>
  call<{ connection: IntegrationConnection }>('POST', { action: 'set_default', id }, server)

export const disconnectIntegration = (id: string, server: ServerApi = defaultServer()) =>
  call<{ disconnected: boolean }>('POST', { action: 'disconnect', id }, server)

/** What the sign-in callback put in the address, in words. */
export function callbackNotice(params: URLSearchParams, label: (key: string) => string) {
  const provider = params.get('provider') ?? params.get('connected') ?? ''
  const name = provider ? label(provider) : 'The provider'
  if (params.get('connected')) return { tone: 'success' as const, text: `${name} is connected.` }
  const error = params.get('error')
  if (!error) return null
  const text: Record<string, string> = {
    denied: `${name} was not connected: permission was not given.`,
    expired: 'That sign-in took too long or was already used. Please connect again.',
    forbidden: 'Only an active administrator can connect integrations.',
    exchange: `${name} did not accept the sign-in. Please connect again.`,
    verify: `${name} was not connected: ${params.get('reason') ?? 'it could not be verified.'}`,
    save: `${name} could not be saved. Please try again.`,
    busy: 'Too many attempts. Wait a minute and try again.',
    invalid: 'That sign-in link was not valid.',
  }
  return { tone: 'error' as const, text: text[error] ?? 'Something went wrong. Please try again.' }
}
