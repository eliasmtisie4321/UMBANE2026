import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Vitest globals are off, so RTL's automatic cleanup is not registered.
afterEach(cleanup)

// Tests must never reach a real Supabase project, even when a developer has a local .env.
// With these blank, getSupabase() throws and services return errors instead of making requests.
vi.stubEnv('VITE_SUPABASE_URL', '')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
