import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import verifyScript from '../scripts/verify-production.mjs?raw'
import vercelJson from '../vercel.json?raw'

/**
 * Guards the security settings in vercel.json and index.html (docs/QA.md, "Security review"), so
 * a later change cannot quietly drop a header or add an inline script the policy would block; and
 * the live check (npm run verify:prod), so a new migration cannot be left out of it.
 */
const vercel = JSON.parse(vercelJson) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
}

const everyPage = vercel.headers.find((h) => h.source === '/(.*)')!.headers
const header = (key: string) => everyPage.find((h) => h.key === key)?.value ?? ''
const csp = Object.fromEntries(
  header('Content-Security-Policy')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .map(([name, ...values]) => [name, values]),
) as Record<string, string[]>

describe('security headers', () => {
  it('sends the standard protections on every page', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{8,}/)
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/)
  })

  it('only runs scripts from the app itself', () => {
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(header('Content-Security-Policy')).not.toMatch(/unsafe-eval/)
  })

  it('lets the app reach Supabase and nothing else', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'])
  })

  it('has no inline scripts in the page the policy would block', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc=/)
      expect(body.trim()).toBe('')
    }
  })
})

describe('the live check', () => {
  it('looks for every migration in the live database', () => {
    const migrations = Object.keys(import.meta.glob('../supabase/migrations/*.sql')).map((path) =>
      path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('/') + 15),
    )
    expect(migrations).toContain('20261125000001')
    // 20261125000002 only adds row security to the tables of 0001, so there is nothing new to look
    // for; the anonymous-access checks cover it.
    const unlisted = migrations.filter(
      (stamp) => stamp !== '20261125000002' && !verifyScript.includes(`['${stamp} `),
    )
    expect(unlisted).toEqual([])
  })
})
