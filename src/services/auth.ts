import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppError, Result } from '@/types/api'
import type { Profile } from '@/types/auth'
import { err, ok, toAppError } from '@/utils/result'
import { getSupabase } from './supabase'

export type AuthClient = Pick<SupabaseClient, 'auth' | 'from'>

interface ProviderError {
  message?: string
  code?: string
  status?: number
  name?: string
}

const resolve = (client?: AuthClient): AuthClient => client ?? getSupabase()

/** Translate provider errors into safe, user-facing messages. Raw provider text is never shown. */
function mapAuthError(e: ProviderError, fallback: string): AppError {
  const message = e.message ?? ''
  if (e.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return { code: 'unauthenticated', message: 'Incorrect email or password.' }
  }
  if (e.code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return {
      code: 'unauthenticated',
      message: 'Please confirm your email address before signing in.',
    }
  }
  if (e.status === 429 || /rate.?limit/i.test(e.code ?? '')) {
    return { code: 'unknown', message: 'Too many attempts. Please wait a moment and try again.' }
  }
  if (e.name === 'AuthRetryableFetchError' || /failed to fetch|network/i.test(message)) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  if (e.code === 'same_password') {
    return { code: 'validation', message: 'Choose a password different from your current one.' }
  }
  if (e.code === 'weak_password') {
    return { code: 'validation', message: 'That password is too weak. Choose a stronger one.' }
  }
  return { code: 'unknown', message: fallback }
}

async function run(
  fn: (client: AuthClient) => PromiseLike<{ error: ProviderError | null }>,
  client: AuthClient | undefined,
  fallback: string,
): Promise<Result<void>> {
  try {
    const { error } = await fn(resolve(client))
    return error ? err(mapAuthError(error, fallback)) : ok(undefined)
  } catch (e) {
    return err(toAppError(e))
  }
}

export const signIn = (email: string, password: string, client?: AuthClient) =>
  run(
    (c) => c.auth.signInWithPassword({ email: email.trim(), password }),
    client,
    'Sign in failed. Please try again.',
  )

export const signOut = (client?: AuthClient) =>
  run((c) => c.auth.signOut(), client, 'Sign out failed. Please try again.')

export const requestPasswordReset = (email: string, redirectTo: string, client?: AuthClient) =>
  run(
    (c) => c.auth.resetPasswordForEmail(email.trim(), { redirectTo }),
    client,
    'Could not send the reset link. Please try again.',
  )

export const updatePassword = (password: string, client?: AuthClient) =>
  run(
    (c) => c.auth.updateUser({ password }),
    client,
    'Could not update your password. Please try again.',
  )

/** Loads the signed-in user's profile. A missing or deactivated profile means no access. */
export async function fetchProfile(userId: string, client?: AuthClient): Promise<Result<Profile>> {
  try {
    const { data, error } = await resolve(client)
      .from('profiles')
      .select('id, business_id, role, full_name, email, is_active')
      .eq('id', userId)
      .maybeSingle()
    if (error)
      return err({ code: 'unknown', message: 'Could not load your profile. Please try again.' })
    if (!data) {
      return err({
        code: 'forbidden',
        message: 'Your account has not been set up yet. Contact an administrator.',
      })
    }
    const profile = data as Profile
    if (!profile.is_active) {
      return err({
        code: 'forbidden',
        message: 'Your account has been deactivated. Contact an administrator.',
      })
    }
    return ok(profile)
  } catch (e) {
    return err(toAppError(e))
  }
}

/**
 * Changes the signed-in person's password. The current password is checked first (by signing in
 * with it again), so someone at an unattended screen cannot change it.
 */
export async function changePassword(
  email: string,
  current: string,
  next: string,
  client?: AuthClient,
): Promise<Result<void>> {
  const check = await signIn(email, current, client)
  if (!check.ok) {
    return check.error.code === 'unauthenticated'
      ? err({
          code: 'validation',
          field: 'current',
          message: 'Your current password is not right.',
        })
      : check
  }
  return updatePassword(next, client)
}

/** Signs the person out on every other browser and device; this one stays signed in. */
export const signOutOtherSessions = (client?: AuthClient) =>
  run(
    (c) => c.auth.signOut({ scope: 'others' }),
    client,
    'Could not sign out your other devices. Please try again.',
  )
