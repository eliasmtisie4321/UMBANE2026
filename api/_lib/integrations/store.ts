import type { SupabaseClient } from '@supabase/supabase-js'
import type { Capability, ProviderKey } from '../../../shared/integrations.js'
import { isExpired } from './email.js'
import { decryptSecrets, encryptSecrets } from './crypto.js'
import type { Adapter, AdapterContext, Connection, Credentials } from './types.js'

/** The service-role client, as the integration code uses it. Tests pass an in-memory stand-in. */
export type Db = Pick<SupabaseClient, 'from' | 'rpc' | 'storage' | 'auth'>

export interface IntegrationRow {
  id: string
  business_id: string
  provider: ProviderKey
  channel: string
  status: 'connected' | 'error' | 'disconnected'
  account_label: string | null
  account_id: string | null
  capabilities: Capability[]
  settings: Record<string, string>
  is_default: boolean
  connected_by: string | null
  connected_at: string | null
  last_checked_at: string | null
  last_error: string | null
  /** Set for a personal connection (a person's own calendar). */
  profile_id?: string | null
}

export const toConnection = (row: IntegrationRow): Connection => ({
  id: row.id,
  businessId: row.business_id,
  provider: row.provider,
  accountLabel: row.account_label,
  accountId: row.account_id,
  capabilities: row.capabilities ?? [],
  settings: row.settings ?? {},
})

export async function loadIntegration(db: Db, id: string): Promise<IntegrationRow | null> {
  const { data, error } = await db.from('integrations').select('*').eq('id', id).maybeSingle()
  return error ? null : ((data as IntegrationRow | null) ?? null)
}

/** The business's live connection for a channel: the default first, then the oldest. */
export async function defaultIntegration(
  db: Db,
  businessId: string,
  channel: string,
): Promise<IntegrationRow | null> {
  const { data, error } = await db
    .from('integrations')
    .select('*')
    .eq('business_id', businessId)
    .eq('channel', channel)
    .eq('status', 'connected')
    .order('is_default', { ascending: false })
    .order('connected_at', { ascending: true })
    .limit(1)
  if (error || !Array.isArray(data) || !data.length) return null
  return data[0] as IntegrationRow
}

export async function loadSecrets(
  db: Db,
  row: Pick<IntegrationRow, 'id'>,
  key: Buffer,
): Promise<Credentials> {
  const { data, error } = await db
    .from('integration_secrets')
    .select('ciphertext')
    .eq('integration_id', row.id)
    .maybeSingle()
  const text = (data as { ciphertext?: string } | null)?.ciphertext
  if (error || !text) throw new Error('The connection’s credentials are missing. Connect it again.')
  return decryptSecrets(text, key, row.id)
}

export async function saveSecrets(
  db: Db,
  row: Pick<IntegrationRow, 'id' | 'business_id'>,
  credentials: Credentials,
  key: Buffer,
) {
  const { error } = await db.from('integration_secrets').upsert(
    {
      integration_id: row.id,
      business_id: row.business_id,
      ciphertext: encryptSecrets(credentials, key, row.id),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'integration_id' },
  )
  if (error) throw new Error(`Could not save the credentials: ${error.message}`)
}

/** Marks a connection as needing attention, with the reason people will see. */
export async function markError(db: Db, id: string, message: string) {
  await db
    .from('integrations')
    .update({
      status: 'error',
      is_default: false,
      last_error: message.slice(0, 500),
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/**
 * Credentials ready to use: an expired OAuth token is renewed (and saved) first. Returns null when
 * the provider will not renew it; the connection is then marked as needing to be connected again.
 */
export async function freshCredentials(
  db: Db,
  adapter: Adapter,
  row: IntegrationRow,
  credentials: Credentials,
  key: Buffer,
  ctx: AdapterContext,
): Promise<Credentials | null> {
  if (!isExpired(credentials, ctx.now())) return credentials
  const renewed = adapter.refresh ? await adapter.refresh(credentials, ctx) : null
  if (!renewed) {
    await markError(db, row.id, 'The sign-in has expired or was revoked. Connect it again.')
    return null
  }
  await saveSecrets(db, row, renewed, key)
  return renewed
}

/** A line in the audit log for a change only the server makes. Never includes credentials. */
export async function auditIntegration(
  db: Db,
  businessId: string,
  actorId: string | null,
  action: string,
  integrationId: string | null,
  details: Record<string, unknown>,
) {
  await db.from('audit_logs').insert({
    business_id: businessId,
    actor_id: actorId,
    action,
    table_name: 'integrations',
    record_id: integrationId,
    details,
  })
}
