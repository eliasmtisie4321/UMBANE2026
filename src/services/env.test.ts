import { describe, expect, it } from 'vitest'
import { readPublicEnv } from './env'

describe('readPublicEnv', () => {
  it('returns url and anon key when both are set', () => {
    const r = readPublicEnv({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
    })
    expect(r).toEqual({
      ok: true,
      data: { supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'anon' },
    })
  })

  it('fails with a validation error when a value is missing', () => {
    const r = readPublicEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('validation')
  })

  it('rejects a URL that is not http(s)', () => {
    const r = readPublicEnv({ VITE_SUPABASE_URL: 'nope', VITE_SUPABASE_ANON_KEY: 'k' })
    expect(r.ok).toBe(false)
  })
})
