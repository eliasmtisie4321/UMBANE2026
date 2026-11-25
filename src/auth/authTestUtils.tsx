import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { ok } from '@/utils/result'
import type { Profile, UserRole } from '@/types/auth'
import { AuthContext, type AuthContextValue } from './AuthContext'

export const profileFor = (role: UserRole, overrides: Partial<Profile> = {}): Profile => ({
  id: 'u1',
  business_id: 'b1',
  role,
  full_name: 'Test User',
  email: 'test@umbane.test',
  is_active: true,
  ...overrides,
})

/** A complete AuthContext value with sensible defaults; override only what a test cares about. */
export const makeAuth = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
  status: 'unauthenticated',
  session: null,
  profile: null,
  sessionExpired: false,
  accessError: null,
  configError: null,
  signIn: vi.fn().mockResolvedValue(ok(undefined)),
  signOut: vi.fn().mockResolvedValue(undefined),
  requestPasswordReset: vi.fn().mockResolvedValue(ok(undefined)),
  updatePassword: vi.fn().mockResolvedValue(ok(undefined)),
  dismissNotices: vi.fn(),
  ...overrides,
})

export const signedInAs = (role: UserRole) =>
  makeAuth({ status: 'authenticated', profile: profileFor(role) })

export function renderAt(ui: ReactElement, auth: AuthContextValue, route = '/') {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  )
}
