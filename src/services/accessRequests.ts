import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result } from '@/types/api'
import { err, ok } from '@/utils/result'
import { getSupabase } from './supabase'

export type RpcClient = Pick<SupabaseClient, 'rpc'>

export interface AccessRequestInput {
  fullName: string
  email: string
  /** Already normalised to +27... or empty. */
  phone: string
  message: string
}

/**
 * Asks an administrator for an account. Calls the database function `request_access`, the only
 * thing an anonymous visitor may do. It answers the same whether or not the email is already
 * known, so this cannot be used to discover who has an account.
 */
export async function requestAccess(
  input: AccessRequestInput,
  client?: RpcClient,
): Promise<Result<void>> {
  try {
    const { error } = await (client ?? getSupabase()).rpc('request_access', {
      p_full_name: input.fullName.trim(),
      p_email: input.email.trim(),
      p_phone: input.phone.trim() || null,
      p_message: input.message.trim() || null,
    })
    if (!error) return ok(undefined)
    if (/rate_limited/.test(error.message ?? '')) {
      return err({
        code: 'unknown',
        message: 'We are receiving a lot of requests right now. Please try again in an hour.',
      })
    }
    if (error.code === '23514' || error.code === '22P02') {
      return err({
        code: 'validation',
        message: 'Some of the details are not valid. Check the form and try again.',
      })
    }
    if (
      error.code === 'PGRST202' ||
      error.code === '42883' ||
      /not configured/i.test(error.message ?? '')
    ) {
      return err({
        code: 'unknown',
        message: 'Account requests are not available yet. Please contact an administrator.',
      })
    }
    if (/failed to fetch|network/i.test(error.message ?? '')) {
      return err({
        code: 'network',
        message: 'Cannot reach the server. Check your connection and try again.',
      })
    }
    return err({ code: 'unknown', message: 'Could not send your request. Please try again.' })
  } catch {
    return err({
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    })
  }
}
