import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readPublicEnv } from './env'

let client: SupabaseClient | null = null

/** Lazily creates the browser Supabase client; throws a clear error if env is not configured. */
export function getSupabase(): SupabaseClient {
  if (client) return client
  const env = readPublicEnv(import.meta.env)
  if (!env.ok) throw new Error(env.error.message)
  client = createClient(env.data.supabaseUrl, env.data.supabaseAnonKey)
  return client
}
