import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PROVIDERS,
  fieldProblem,
  providerInfo,
  type ProviderInfo,
} from '../../shared/integrations.js'
import {
  encryptionKey,
  pkcePair,
  randomToken,
  sha256Hex,
  webhookVerifyToken,
} from '../_lib/integrations/crypto.js'
import { twilioCallbackUrl } from '../_lib/integrations/messaging.js'
import {
  adapterFor,
  allowedCapabilities,
  oauthReady,
  redirectUri,
} from '../_lib/integrations/registry.js'
import {
  auditIntegration,
  freshCredentials,
  loadIntegration,
  loadSecrets,
  saveSecrets,
  toConnection,
  type Db,
  type IntegrationRow,
} from '../_lib/integrations/store.js'
import type { Credentials, VerifiedAccount } from '../_lib/integrations/types.js'
import {
  adapterContext,
  adminClient,
  json,
  RATE_LIMITS,
  readEnv,
  staffCaller,
  tooManyRequests,
  withinRateLimit,
  type ServerEnv,
} from '../_lib/server.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const OAUTH_STATE_MINUTES = 10

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
}

/** What the app shows for a connection. Credentials never leave the server. */
function present(row: IntegrationRow, env: ServerEnv, isAdmin: boolean) {
  const key = encryptionKey(env.integrationsKey)
  const app = env.appUrl?.replace(/\/$/, '') ?? null
  let webhook: Record<string, string> | null = null
  if (isAdmin && app && row.status !== 'disconnected') {
    if (row.provider === 'resend')
      webhook = { url: `${app}/api/webhooks/resend?integration=${row.id}` }
    if (row.provider === 'twilio') webhook = { url: twilioCallbackUrl(app, row.id) }
    if (row.provider === 'whatsapp' && key) {
      webhook = {
        url: `${app}/api/webhooks/messaging?provider=whatsapp&integration=${row.id}`,
        verifyToken: webhookVerifyToken(row.id, key),
      }
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    status: row.status,
    accountLabel: row.account_label,
    capabilities: row.capabilities,
    settings: row.settings,
    isDefault: row.is_default,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    webhook,
  }
}

/** Saves a verified connection: a new row, or the business's existing one for the provider. */
async function saveConnection(
  db: Db,
  key: Buffer,
  caller: { id: string; businessId: string },
  info: ProviderInfo,
  account: VerifiedAccount,
  credentials: Credentials,
  settings: Record<string, string>,
  existing: IntegrationRow | null,
): Promise<IntegrationRow> {
  const id = existing?.id ?? randomUUID()
  const fields = {
    status: 'connected',
    account_label: account.accountLabel.slice(0, 200),
    account_id: account.accountId.slice(0, 200),
    capabilities: allowedCapabilities(info, account.capabilities),
    settings: { ...settings, ...(account.settings ?? {}) },
    connected_by: caller.id,
    connected_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    last_error: null,
  }
  // The credentials are written first, so a connection is never "connected" without them.
  if (!existing) {
    const created = await db
      .from('integrations')
      .insert({
        id,
        business_id: caller.businessId,
        provider: info.key,
        ...fields,
        status: 'error',
        last_error: 'Saving',
      })
      .select('*')
      .single()
    if (created.error) throw new Error(created.error.message)
  }
  await saveSecrets(
    db,
    { id, business_id: caller.businessId },
    account.credentials ?? credentials,
    key,
  )
  // The first live connection on a channel becomes its default.
  const others = await db
    .from('integrations')
    .select('id')
    .eq('business_id', caller.businessId)
    .eq('channel', info.channel)
    .eq('is_default', true)
    .neq('id', id)
  const isDefault = existing?.is_default || !(others.data ?? []).length
  const saved = await db
    .from('integrations')
    .update({ ...fields, is_default: isDefault })
    .eq('id', id)
    .select('*')
    .single()
  if (saved.error) throw new Error(saved.error.message)
  return saved.data as IntegrationRow
}

async function liveFor(
  db: Db,
  businessId: string,
  provider: string,
): Promise<IntegrationRow | null> {
  const { data } = await db
    .from('integrations')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .neq('status', 'disconnected')
    .limit(1)
  return Array.isArray(data) && data.length ? (data[0] as IntegrationRow) : null
}

function problems(fieldsSpec: ProviderInfo['fields'], values: Record<string, string>) {
  const found: Record<string, string> = {}
  for (const f of fieldsSpec ?? []) {
    const p = fieldProblem(f, values[f.name])
    if (p) found[f.name] = p
  }
  return found
}

const clean = (values: unknown, spec: ProviderInfo['fields']) => {
  const v = (values ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const f of spec ?? []) {
    const s = typeof v[f.name] === 'string' ? (v[f.name] as string).trim() : ''
    if (s) out[f.name] = s
  }
  return out
}

/**
 * GET  /api/integrations            what is connected (any staff member; credentials never included)
 * POST /api/integrations { action }  administrators only:
 *   connect      { provider, fields, settings }  API-key providers; verified with the provider first
 *   oauth_start  { provider }                    returns the provider's sign-in address
 *   test         { id, sendTest? }               checks it again (and sends a test email to the caller)
 *   set_default  { id }                          the one used for its channel
 *   settings     { id, settings }                sender name, template, page, ...; re-verified
 *   disconnect   { id }                          deletes the credentials, revokes where possible
 */
export function createIntegrationsHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (!deps.env.supabaseUrl || !deps.env.serviceKey) return json({ error: 'not_configured' }, 503)
    const db = deps.admin()
    const caller = await staffCaller(db, request)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    if (!(await withinRateLimit(db, 'integrations:' + caller.id, RATE_LIMITS.integrations)))
      return tooManyRequests()
    const isAdmin = caller.role === 'administrator'
    const key = encryptionKey(deps.env.integrationsKey)

    if (request.method === 'GET') {
      const { data, error } = await db
        .from('integrations')
        .select('*')
        .eq('business_id', caller.businessId)
        .neq('status', 'disconnected')
        .order('created_at', { ascending: true })
      if (error) return json({ error: 'not_available' }, 500)
      return json({
        providers: PROVIDERS.map((p) => ({
          key: p.key,
          ready:
            p.connect === 'unavailable'
              ? false
              : Boolean(key) &&
                (p.connect === 'api_key' ||
                  (oauthReady(p.key, deps.env.oauth) && Boolean(deps.env.appUrl))),
          missing: [
            ...(p.connect !== 'unavailable' && !key ? ['INTEGRATIONS_KEY'] : []),
            ...(p.connect === 'oauth' && !oauthReady(p.key, deps.env.oauth)
              ? (p.serverEnv ?? [])
              : []),
            ...(p.connect === 'oauth' && !deps.env.appUrl ? ['APP_URL'] : []),
          ],
        })),
        connections: ((data ?? []) as IntegrationRow[]).map((r) => present(r, deps.env, isAdmin)),
        builtInEmail: {
          ready: Boolean(deps.env.resendKey && deps.env.emailFrom),
          from: deps.env.emailFrom,
        },
        redirectUri: deps.env.appUrl ? redirectUri(deps.env.appUrl) : null,
      })
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!isAdmin) return json({ error: 'forbidden' }, 403)
    if (!key) return json({ error: 'not_configured', missing: ['INTEGRATIONS_KEY'] }, 503)

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    const action = String(body.action ?? '')
    const ctx = adapterContext(deps.env)

    if (action === 'connect' || action === 'oauth_start') {
      const info = providerInfo(String(body.provider ?? ''))
      const adapter = info ? adapterFor(info.key) : null
      if (!info || !adapter) return json({ error: 'unknown_provider' }, 400)

      if (action === 'oauth_start') {
        if (info.connect !== 'oauth' || !adapter.oauth) return json({ error: 'not_oauth' }, 400)
        const app = deps.env.oauth[adapter.oauth.app]
        if (!app || !deps.env.appUrl) {
          return json(
            {
              error: 'not_configured',
              missing: [
                ...(app ? [] : (info.serverEnv ?? [])),
                ...(deps.env.appUrl ? [] : ['APP_URL']),
              ],
            },
            503,
          )
        }
        const state = randomToken()
        const { verifier, challenge } = pkcePair()
        // Old, unused sign-ins are cleared as new ones start.
        await db
          .from('integration_oauth_states')
          .delete()
          .lt('expires_at', new Date().toISOString())
        const saved = await db.from('integration_oauth_states').insert({
          state_hash: sha256Hex(state),
          business_id: caller.businessId,
          provider: info.key,
          created_by: caller.id,
          code_verifier: verifier,
          expires_at: new Date(Date.now() + OAUTH_STATE_MINUTES * 60_000).toISOString(),
        })
        if (saved.error) return json({ error: 'not_available' }, 500)
        const url = adapter.oauth.authorizeUrl({
          clientId: app.clientId,
          redirectUri: redirectUri(deps.env.appUrl),
          state,
          challenge,
        })
        return json({ url })
      }

      if (info.connect !== 'api_key') return json({ error: 'use_oauth' }, 400)
      const fields = clean(body.fields, info.fields)
      const settings = clean(body.settings, info.settings)
      const found = { ...problems(info.fields, fields), ...problems(info.settings, settings) }
      if (Object.keys(found).length) return json({ error: 'invalid', fields: found }, 422)
      const existing = await liveFor(db, caller.businessId, info.key)
      const verified = await adapter.verify(fields, settings, ctx, existing?.id ?? '')
      if (!verified.ok) return json({ error: 'verification_failed', message: verified.error }, 422)
      const row = await saveConnection(
        db,
        key,
        caller,
        info,
        verified.account,
        fields,
        settings,
        existing,
      )
      await auditIntegration(db, caller.businessId, caller.id, 'integration.connected', row.id, {
        provider: info.key,
        account: row.account_label,
        capabilities: row.capabilities,
      })
      return json({ connection: present(row, deps.env, true) })
    }

    const id = String(body.id ?? '')
    if (!UUID.test(id)) return json({ error: 'bad_request' }, 400)
    const row = await loadIntegration(db, id)
    if (!row || row.business_id !== caller.businessId || row.status === 'disconnected') {
      return json({ error: 'not_found' }, 404)
    }
    const info = providerInfo(row.provider)
    const adapter = adapterFor(row.provider)
    if (!info || !adapter) return json({ error: 'unknown_provider' }, 400)

    if (action === 'set_default') {
      if (row.status !== 'connected') return json({ error: 'not_connected' }, 409)
      await db
        .from('integrations')
        .update({ is_default: false })
        .eq('business_id', row.business_id)
        .eq('channel', row.channel)
        .neq('id', id)
      const saved = await db
        .from('integrations')
        .update({ is_default: true })
        .eq('id', id)
        .select('*')
        .single()
      if (saved.error) return json({ error: 'not_available' }, 500)
      return json({ connection: present(saved.data as IntegrationRow, deps.env, true) })
    }

    if (action === 'disconnect') {
      try {
        const credentials = await loadSecrets(db, row, key)
        await adapter.revoke?.(credentials, ctx)
      } catch {
        // Nothing to revoke, or the provider is unreachable: the credentials are deleted anyway.
      }
      await db.from('integration_secrets').delete().eq('integration_id', id)
      await db
        .from('integrations')
        .update({ status: 'disconnected', is_default: false, capabilities: [], last_error: null })
        .eq('id', id)
      await auditIntegration(db, caller.businessId, caller.id, 'integration.disconnected', id, {
        provider: row.provider,
        account: row.account_label,
      })
      return json({ disconnected: true })
    }

    if (action === 'test' || action === 'settings') {
      let settings = row.settings ?? {}
      if (action === 'settings') {
        const given = clean(body.settings, info.settings)
        const found = problems(info.settings, given)
        if (Object.keys(found).length) return json({ error: 'invalid', fields: found }, 422)
        // Lists learned from the provider (pages, accounts) are kept; the person's choices replace theirs.
        settings = { ...settings, ...given }
        for (const f of info.settings ?? []) if (!given[f.name]) delete settings[f.name]
        for (const choice of ['pageId', 'igUserId']) {
          const v = (body.settings as Record<string, unknown> | undefined)?.[choice]
          if (typeof v === 'string' && /^[0-9]{1,30}$/.test(v)) settings[choice] = v
        }
      }
      let credentials: Credentials
      try {
        credentials = await loadSecrets(db, row, key)
      } catch (e) {
        return json({ error: 'verification_failed', message: (e as Error).message }, 422)
      }
      const fresh = await freshCredentials(db, adapter, row, credentials, key, ctx)
      if (!fresh)
        return json(
          { error: 'verification_failed', message: 'The sign-in has expired. Connect it again.' },
          422,
        )
      const verified = await adapter.verify(fresh, settings, ctx, row.id)
      const now = new Date().toISOString()
      if (!verified.ok) {
        if (action === 'test') {
          await db
            .from('integrations')
            .update({
              status: 'error',
              is_default: false,
              last_error: verified.error.slice(0, 500),
              last_checked_at: now,
            })
            .eq('id', id)
        }
        return json({ error: 'verification_failed', message: verified.error }, 422)
      }
      if (verified.account.credentials)
        await saveSecrets(db, row, verified.account.credentials, key)
      const saved = await db
        .from('integrations')
        .update({
          status: 'connected',
          account_label: verified.account.accountLabel.slice(0, 200),
          account_id: verified.account.accountId.slice(0, 200),
          capabilities: allowedCapabilities(info, verified.account.capabilities),
          settings: { ...settings, ...(verified.account.settings ?? {}) },
          last_checked_at: now,
          last_error: null,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (saved.error) return json({ error: 'not_available' }, 500)
      const updated = saved.data as IntegrationRow
      let testEmail: Record<string, unknown> | null = null
      if (action === 'test' && body.sendTest === true && row.channel === 'email') {
        const me = await db
          .from('profiles')
          .select('email, full_name')
          .eq('id', caller.id)
          .maybeSingle()
        const to = (me.data as { email?: string } | null)?.email
        if (to) {
          const r = await adapter.send(
            {
              id: randomUUID(),
              to,
              toName: (me.data as { full_name?: string } | null)?.full_name ?? null,
              subject: 'Umbane test email',
              text: `This is a test from Umbane, sent through ${info.label} (${updated.account_label}). If you can read it, email is working.`,
              html: `<p>This is a test from Umbane, sent through ${info.label}. If you can read it, email is working.</p>`,
              attachments: [],
              documentUrl: null,
              linkUrl: null,
              imageUrl: null,
              idempotencyKey: `test:${id}:${Date.now()}`,
              purpose: 'transactional',
            },
            verified.account.credentials ?? fresh,
            toConnection(updated),
            ctx,
          )
          testEmail = r.ok ? { sent: true, to } : { sent: false, error: r.error }
        }
      }
      return json({ connection: present(updated, deps.env, true), testEmail })
    }

    return json({ error: 'bad_request' }, 400)
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createIntegrationsHandler({ env, admin: () => adminClient(env) })(request)
}

export function POST(request: Request) {
  const env = readEnv()
  return createIntegrationsHandler({ env, admin: () => adminClient(env) })(request)
}
