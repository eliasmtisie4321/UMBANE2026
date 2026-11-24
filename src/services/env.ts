import type { Result } from '@/types/api'
import { err, ok } from '@/utils/result'

export interface PublicEnv {
  supabaseUrl: string
  supabaseAnonKey: string
}

/** Reads only public, browser-safe config. Never read service-role keys here. */
export function readPublicEnv(env: Record<string, string | undefined>): Result<PublicEnv> {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim()
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !supabaseAnonKey) {
    return err({
      code: 'validation',
      message: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. See docs/ENVIRONMENT.md.',
    })
  }
  if (!/^https?:\/\//.test(supabaseUrl)) {
    return err({ code: 'validation', message: 'VITE_SUPABASE_URL must start with http(s)://' })
  }
  return ok({ supabaseUrl, supabaseAnonKey })
}
