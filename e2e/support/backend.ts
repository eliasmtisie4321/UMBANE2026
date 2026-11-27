import type { Page, Route } from '@playwright/test'

/**
 * A stand-in for Supabase and the api/ functions, so end-to-end tests run the real built app with
 * known data and no network. The app is built with VITE_SUPABASE_URL=https://e2e.supabase.test
 * (playwright.config.ts), so every request to that host lands here.
 */
export const SUPABASE = 'https://e2e.supabase.test'
/** supabase-js keeps the session under sb-<first part of the host>-auth-token. */
const SESSION_KEY = 'sb-e2e-auth-token'

export type Role = 'administrator' | 'manager' | 'staff' | 'client'

export interface Written {
  method: string
  table: string
  body: unknown
  query: string
}

export interface BackendOptions {
  /** Signed in as this role; omit for a visitor. */
  role?: Role
  /** Rows per table (GET), or a function of the query string. */
  tables?: Record<string, unknown[] | ((query: string) => unknown[])>
  /** Results per database function (POST /rest/v1/rpc/<name>). */
  rpc?: Record<string, unknown>
  /** What a password sign-in answers. */
  login?: 'ok' | 'wrong-password'
  /** A session that has run out and cannot be refreshed. */
  expiredSession?: boolean
}

const USER_ID = '00000000-0000-4000-8000-000000000001'

export function profileFor(role: Role) {
  return {
    id: USER_ID,
    business_id: '00000000-0000-4000-8000-0000000000b1',
    role,
    full_name: role === 'client' ? 'Naledi Dlamini' : 'Mia Manager',
    email: `${role}@umbane.test`,
    is_active: true,
  }
}

function session(role: Role, expired = false) {
  const expiresAt = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600)
  return {
    access_token: 'e2e.header.payload',
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${role}@umbane.test`,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}

export async function mockBackend(page: Page, options: BackendOptions = {}) {
  const written: Written[] = []
  const role = options.role
  let signedInAs: Role | undefined = role

  if (role) {
    const value = JSON.stringify(session(role, options.expiredSession))
    await page.addInitScript(
      ([key, v]) => {
        if (!sessionStorage.getItem('e2e-seeded')) {
          localStorage.setItem(key, v)
          sessionStorage.setItem('e2e-seeded', '1')
        }
      },
      [SESSION_KEY, value],
    )
  }

  const reply = (
    route: Route,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    route.fulfill({
      status,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
        'access-control-expose-headers': 'content-range',
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? '' : JSON.stringify(body),
    })

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    if (method === 'OPTIONS') return reply(route, 204, undefined)

    // Auth -------------------------------------------------------------------------------------------
    if (path.startsWith('/auth/v1/token')) {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'refresh_token') {
        return options.expiredSession
          ? reply(route, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' })
          : reply(route, 200, session(signedInAs ?? 'manager'))
      }
      if (options.login === 'wrong-password') {
        return reply(route, 400, {
          code: 'invalid_credentials',
          message: 'Invalid login credentials',
        })
      }
      signedInAs = 'manager'
      return reply(route, 200, session('manager'))
    }
    if (path.startsWith('/auth/v1/user'))
      return reply(route, 200, session(signedInAs ?? 'manager').user)
    if (path.startsWith('/auth/v1/logout')) return reply(route, 204, undefined)
    if (path.startsWith('/auth/v1/')) return reply(route, 200, {})

    // Database functions -----------------------------------------------------------------------------
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length)
      written.push({ method, table: `rpc:${name}`, body: req.postDataJSON(), query: url.search })
      return reply(route, 200, options.rpc?.[name] ?? null)
    }

    // Tables and views -------------------------------------------------------------------------------
    const table = path.replace('/rest/v1/', '')
    if (method !== 'GET' && method !== 'HEAD') {
      const body = req.postDataJSON()
      written.push({ method, table, body, query: url.search })
      const row = Array.isArray(body) ? body[0] : body
      return reply(route, method === 'POST' ? 201 : 200, [{ id: 'new-1', ...(row as object) }])
    }
    if (table === 'profiles' && signedInAs) return reply(route, 200, profileFor(signedInAs))
    const source = options.tables?.[table]
    const rows = typeof source === 'function' ? source(url.search) : (source ?? [])
    const range = { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
    if (method === 'HEAD') return reply(route, 200, undefined, range)
    const one = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    if (one) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      const found = id ? rows.find((r) => (r as { id?: string }).id === id) : rows[0]
      return reply(route, 200, found ?? null)
    }
    return reply(route, 200, rows, range)
  })

  // The api/ functions are not part of these tests.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
  // Web fonts are not needed to test behaviour.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())

  return { written }
}

/** Fails the test if the page scrolls sideways (something wider than the screen). */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}
