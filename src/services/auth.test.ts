import { describe, expect, it, vi } from 'vitest'
import {
  fetchProfile,
  requestPasswordReset,
  signIn,
  signOut,
  updatePassword,
  type AuthClient,
} from './auth'

const clientWith = (auth: Record<string, unknown>, from?: unknown) =>
  ({ auth, from }) as unknown as AuthClient

const profileRow = {
  id: 'u1',
  business_id: 'b1',
  role: 'staff',
  full_name: 'Sam',
  email: 's@x.co',
  is_active: true,
}

const profilesQuery = (result: { data: unknown; error: unknown }) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }),
})

describe('signIn', () => {
  it('succeeds and trims the email', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null })
    const r = await signIn(' a@b.co ', 'pw', clientWith({ signInWithPassword }))
    expect(r.ok).toBe(true)
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
  })

  it('maps invalid credentials to a safe message without leaking provider text', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
    })
    const r = await signIn('a@b.co', 'bad', clientWith({ signInWithPassword }))
    expect(r).toEqual({
      ok: false,
      error: { code: 'unauthenticated', message: 'Incorrect email or password.' },
    })
  })

  it('maps rate limiting', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: { message: 'x', status: 429 } })
    const r = await signIn('a@b.co', 'pw', clientWith({ signInWithPassword }))
    expect(!r.ok && r.error.message).toMatch(/too many attempts/i)
  })

  it('maps network failures', async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValue({ error: { message: 'Failed to fetch', name: 'AuthRetryableFetchError' } })
    const r = await signIn('a@b.co', 'pw', clientWith({ signInWithPassword }))
    expect(!r.ok && r.error.code).toBe('network')
  })

  it('returns an error instead of throwing when the client cannot be created', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    try {
      const r = await signIn('a@b.co', 'pw', undefined)
      expect(!r.ok && r.error.message).toMatch(/Missing VITE_SUPABASE_URL/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('signOut', () => {
  it('calls the client', async () => {
    const out = vi.fn().mockResolvedValue({ error: null })
    expect((await signOut(clientWith({ signOut: out }))).ok).toBe(true)
    expect(out).toHaveBeenCalled()
  })
})

describe('requestPasswordReset', () => {
  it('passes the redirect URL', async () => {
    const reset = vi.fn().mockResolvedValue({ error: null })
    const r = await requestPasswordReset(
      'a@b.co',
      'https://app/reset-password',
      clientWith({ resetPasswordForEmail: reset }),
    )
    expect(r.ok).toBe(true)
    expect(reset).toHaveBeenCalledWith('a@b.co', { redirectTo: 'https://app/reset-password' })
  })
})

describe('updatePassword', () => {
  it('succeeds', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    expect((await updatePassword('Abcdefg1!', clientWith({ updateUser }))).ok).toBe(true)
    expect(updateUser).toHaveBeenCalledWith({ password: 'Abcdefg1!' })
  })

  it('explains a reused password', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: 'x', code: 'same_password' } })
    const r = await updatePassword('Abcdefg1!', clientWith({ updateUser }))
    expect(!r.ok && r.error.message).toMatch(/different from your current/i)
  })
})

describe('fetchProfile', () => {
  it('returns the profile', async () => {
    const from = () => profilesQuery({ data: profileRow, error: null })
    const r = await fetchProfile('u1', clientWith({}, from))
    expect(r).toEqual({ ok: true, data: profileRow })
  })

  it('treats a missing profile as forbidden', async () => {
    const from = () => profilesQuery({ data: null, error: null })
    const r = await fetchProfile('u1', clientWith({}, from))
    expect(!r.ok && r.error.code).toBe('forbidden')
  })

  it('treats a deactivated profile as forbidden', async () => {
    const from = () => profilesQuery({ data: { ...profileRow, is_active: false }, error: null })
    const r = await fetchProfile('u1', clientWith({}, from))
    expect(!r.ok && r.error.message).toMatch(/deactivated/i)
  })

  it('reports query failures', async () => {
    const from = () => profilesQuery({ data: null, error: { message: 'boom' } })
    const r = await fetchProfile('u1', clientWith({}, from))
    expect(r.ok).toBe(false)
  })
})
