import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as authService from '@/services/auth'
import type { AuthClient } from '@/services/auth'
import { getSupabase } from '@/services/supabase'
import type { Profile } from '@/types/auth'
import { toAppError } from '@/utils/result'
import { AuthContext, type AuthContextValue } from './AuthContext'

interface AuthProviderProps {
  children: ReactNode
  /** Injected in tests; defaults to the real Supabase client. */
  client?: AuthClient
}

interface ProfileResult {
  userId: string
  profile: Profile | null
}

/** Never throws: missing environment variables become a message the login screen can show. */
function resolveClient(injected?: AuthClient): {
  client: AuthClient | null
  configError: string | null
} {
  if (injected) return { client: injected, configError: null }
  try {
    return { client: getSupabase() as AuthClient, configError: null }
  } catch (e) {
    return { client: null, configError: toAppError(e).message }
  }
}

export function AuthProvider({ children, client: injected }: AuthProviderProps) {
  // Resolved once per mount; the client does not change while the app is running.
  const [{ client, configError }] = useState(() => resolveClient(injected))

  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  // True once the user has had a session, and set when *we* initiated the sign-out.
  const hadSession = useRef(false)
  const manualSignOut = useRef(false)

  useEffect(() => {
    if (!client) return
    let active = true
    void client.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) hadSession.current = true
      setSession(data.session)
      setSessionLoaded(true)
    })
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        if (hadSession.current && !manualSignOut.current) setSessionExpired(true)
        hadSession.current = false
        manualSignOut.current = false
        setProfileResult(null)
      } else if (next) {
        hadSession.current = true
      }
      setSession(next)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client])

  const userId = session?.user.id ?? null

  // Load the profile whenever the signed-in user changes. A missing or deactivated profile means no access.
  useEffect(() => {
    if (!client || !userId) return
    let active = true
    void authService.fetchProfile(userId, client).then((result) => {
      if (!active) return
      if (result.ok) {
        setProfileResult({ userId, profile: result.data })
        return
      }
      setProfileResult({ userId, profile: null })
      setAccessError(result.error.message)
      manualSignOut.current = true
      void authService.signOut(client)
    })
    return () => {
      active = false
    }
  }, [client, userId])

  const loaded = !client || sessionLoaded
  const profile = profileResult?.userId === userId ? profileResult.profile : null
  const loadingProfile = userId !== null && profileResult?.userId !== userId

  const status: AuthContextValue['status'] =
    !loaded || loadingProfile ? 'loading' : session && profile ? 'authenticated' : 'unauthenticated'

  const signIn = useCallback(
    (email: string, password: string) => {
      setSessionExpired(false)
      setAccessError(null)
      return authService.signIn(email, password, client ?? undefined)
    },
    [client],
  )

  const signOut = useCallback(async () => {
    manualSignOut.current = true
    await authService.signOut(client ?? undefined)
  }, [client])

  const requestPasswordReset = useCallback(
    (email: string) =>
      authService.requestPasswordReset(
        email,
        `${window.location.origin}/reset-password`,
        client ?? undefined,
      ),
    [client],
  )

  const updatePassword = useCallback(
    (password: string) => authService.updatePassword(password, client ?? undefined),
    [client],
  )

  const dismissNotices = useCallback(() => {
    setSessionExpired(false)
    setAccessError(null)
  }, [])

  const value: AuthContextValue = {
    status,
    session,
    profile,
    sessionExpired,
    accessError,
    configError,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    dismissNotices,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
