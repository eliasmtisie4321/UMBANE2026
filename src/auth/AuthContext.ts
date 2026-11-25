import type { Session } from '@supabase/supabase-js'
import { createContext } from 'react'
import type { Result } from '@/types/api'
import type { Profile } from '@/types/auth'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  profile: Profile | null
  /** True when a signed-in session ended without the user signing out (expiry or revocation). */
  sessionExpired: boolean
  /** Why a signed-in user was turned away (no profile, deactivated), shown on the login screen. */
  accessError: string | null
  /** Set when Supabase environment variables are missing. */
  configError: string | null
  signIn: (email: string, password: string) => Promise<Result<void>>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<Result<void>>
  updatePassword: (password: string) => Promise<Result<void>>
  dismissNotices: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
