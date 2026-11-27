import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'
import { preloadScreens } from '@/utils/lazyScreen'

// Vitest globals are off, so RTL's automatic cleanup is not registered.
afterEach(cleanup)

// The app loads each screen on first use (src/App.tsx). Files that render the whole app fetch them
// all first, so a test does not wait while a screen is compiled. Files that never import App have
// nothing registered and skip this.
beforeAll(() => preloadScreens(), 300_000)

// Screens load data asynchronously and the full suite runs many jsdom workers at once, so the
// default 1s wait for "findBy" and "waitFor" is too tight on slower machines.
configure({ asyncUtilTimeout: 5000 })

// Tests must never reach a real Supabase project, even when a developer has a local .env.
// With these blank, getSupabase() throws and services return errors instead of making requests.
vi.stubEnv('VITE_SUPABASE_URL', '')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
