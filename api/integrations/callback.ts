import type { SupabaseClient } from '@supabase/supabase-js'
import { providerInfo } from '../../shared/integrations.js'
import { encryptionKey, sha256Hex } from '../_lib/integrations/crypto.js'
import { adapterFor, allowedCapabilities, redirectUri } from '../_lib/integrations/registry.js'
import { auditIntegration, saveSecrets, type IntegrationRow } from '../_lib/integrations/store.js'
import {
  adapterContext,
  adminClient,
  clientAddress,
  readEnv,
  RATE_LIMITS,
  withinRateLimit,
  type ServerEnv,
} from '../_lib/server.js'
import { randomUUID } from 'node:crypto'

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
}

interface StateRow {
  state_hash: string
  business_id: string
  provider: string
  created_by: string
  code_verifier: string
  expires_at: string
}

/** Back to Settings → Integrations, saying what happened. Never echoes provider text into the page. */
function back(appUrl: string | null, params: Record<string, string>) {
  const base = (appUrl ?? '').replace(/\/$/, '')
  return new Response(null, {
    status: 302,
    headers: {
      location: `${base}/settings/integrations?${new URLSearchParams(params)}`,
      'cache-control': 'no-store',
    },
  })
}

/**
 * GET /api/integrations/callback?code=…&state=…
 * Where Google, Microsoft, Meta and LinkedIn send the administrator back after they approve
 * Umbane. The state must match one this server handed out in the last ten minutes, to an
 * administrator who is still active; it can be used once. The connection is saved only after the
 * provider confirms the account and what was granted.
 */
export function createCallbackHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    const { env } = deps
    const key = encryptionKey(env.integrationsKey)
    if (!env.supabaseUrl || !env.serviceKey || !key || !env.appUrl) {
      return new Response('Integrations are not set up on the server.', { status: 503 })
    }
    const db = deps.admin()
    if (!(await withinRateLimit(db, 'oauth:' + clientAddress(request), RATE_LIMITS.integrations))) {
      return back(env.appUrl, { error: 'busy' })
    }
    const url = new URL(request.url)
    const state = url.searchParams.get('state') ?? ''
    if (!state || state.length > 200) return back(env.appUrl, { error: 'invalid' })

    // Single use: taken out before anything else happens.
    const taken = await db
      .from('integration_oauth_states')
      .delete()
      .eq('state_hash', sha256Hex(state))
      .select('*')
    const s = ((taken.data ?? []) as StateRow[])[0]
    if (taken.error || !s || new Date(s.expires_at).getTime() < Date.now()) {
      return back(env.appUrl, { error: 'expired' })
    }
    const info = providerInfo(s.provider)
    const adapter = adapterFor(s.provider)
    if (!info || !adapter?.oauth) return back(env.appUrl, { error: 'invalid' })
    if (url.searchParams.get('error'))
      return back(env.appUrl, { error: 'denied', provider: info.key })

    const person = await db
      .from('profiles')
      .select('id, business_id, role, is_active')
      .eq('id', s.created_by)
      .maybeSingle()
    const p = person.data as { business_id: string; role: string; is_active: boolean } | null
    if (!p || !p.is_active || p.role !== 'administrator' || p.business_id !== s.business_id) {
      return back(env.appUrl, { error: 'forbidden', provider: info.key })
    }

    const ctx = adapterContext(env)
    let grant
    try {
      grant = await adapter.oauth.exchange(
        {
          code: url.searchParams.get('code') ?? '',
          verifier: s.code_verifier,
          redirectUri: redirectUri(env.appUrl),
        },
        ctx,
      )
    } catch {
      return back(env.appUrl, { error: 'exchange', provider: info.key })
    }

    const existing = await db
      .from('integrations')
      .select('*')
      .eq('business_id', s.business_id)
      .eq('provider', info.key)
      .neq('status', 'disconnected')
      .limit(1)
    const before = ((existing.data ?? []) as IntegrationRow[])[0] ?? null
    const verified = await adapter.verify(
      grant.credentials,
      before?.settings ?? {},
      ctx,
      before?.id ?? '',
    )
    if (!verified.ok) {
      // Shown on the Integrations page; the provider's text is not put into the address.
      return back(env.appUrl, {
        error: 'verify',
        provider: info.key,
        reason: verified.error.slice(0, 200),
      })
    }

    const id = before?.id ?? randomUUID()
    const now = new Date().toISOString()
    if (!before) {
      const created = await db.from('integrations').insert({
        id,
        business_id: s.business_id,
        provider: info.key,
        status: 'error',
        last_error: 'Saving',
      })
      if (created.error) return back(env.appUrl, { error: 'save', provider: info.key })
    }
    try {
      await saveSecrets(
        db,
        { id, business_id: s.business_id },
        verified.account.credentials ?? grant.credentials,
        key,
      )
    } catch {
      return back(env.appUrl, { error: 'save', provider: info.key })
    }
    const defaults = await db
      .from('integrations')
      .select('id')
      .eq('business_id', s.business_id)
      .eq('channel', info.channel)
      .eq('is_default', true)
      .neq('id', id)
    await db
      .from('integrations')
      .update({
        status: 'connected',
        account_label: verified.account.accountLabel.slice(0, 200),
        account_id: verified.account.accountId.slice(0, 200),
        capabilities: allowedCapabilities(info, verified.account.capabilities),
        settings: { ...(before?.settings ?? {}), ...(verified.account.settings ?? {}) },
        is_default: before?.is_default || !(defaults.data ?? []).length,
        connected_by: s.created_by,
        connected_at: now,
        last_checked_at: now,
        last_error: null,
      })
      .eq('id', id)
    await auditIntegration(db, s.business_id, s.created_by, 'integration.connected', id, {
      provider: info.key,
      account: verified.account.accountLabel,
      scopes: grant.scopes,
    })
    return back(env.appUrl, { connected: info.key })
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createCallbackHandler({ env, admin: () => adminClient(env) })(request)
}
