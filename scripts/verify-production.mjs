#!/usr/bin/env node
/**
 * A read-only check of the live Umbane CRM: the site and its security headers, the server functions
 * refusing anonymous calls, every database migration in place, and anonymous visitors seeing no
 * data. It only reads: it uses the public anon key (the one already in the app), sends no
 * credentials, and never calls anything that writes or records a request.
 *
 *   npm run verify:prod
 *   npm run verify:prod -- --url https://crm.umbane.co.za
 *
 * Settings come from the command line, then the environment (APP_URL, VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY), then .env.example. Exit code 1 if anything failed.
 */
import { readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs),
      [],
    ),
)
const example = (() => {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  } catch {
    return {}
  }
})()
const APP = (args.url ?? process.env.APP_URL ?? 'https://umbane2026.vercel.app').replace(/\/$/, '')
const SUPABASE = (
  args.supabase ??
  process.env.VITE_SUPABASE_URL ??
  example.VITE_SUPABASE_URL ??
  ''
).replace(/\/$/, '')
const ANON = args.key ?? process.env.VITE_SUPABASE_ANON_KEY ?? example.VITE_SUPABASE_ANON_KEY ?? ''

const results = []
const record = (group, name, status, detail = '') => results.push({ group, name, status, detail })
const pass = (g, n, d) => record(g, n, 'pass', d)
const fail = (g, n, d) => record(g, n, 'fail', d)
const warn = (g, n, d) => record(g, n, 'warn', d)

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }
    return { status: res.status, headers: res.headers, text, json }
  } catch (e) {
    return { status: 0, headers: new Headers(), text: '', json: null, error: e.message }
  }
}

// The site -------------------------------------------------------------------------------------------
async function site() {
  const g = 'Site'
  const home = await get(`${APP}/`)
  if (home.status !== 200 || !home.text.includes('id="root"')) {
    fail(g, 'The app loads', home.error ?? `status ${home.status}`)
    return null
  }
  pass(g, 'The app loads', APP)
  for (const path of ['/customers', '/settings/integrations', '/welcome']) {
    const r = await get(`${APP}${path}`)
    r.status === 200 && r.text.includes('id="root"')
      ? pass(g, `Deep link ${path} opens the app`)
      : fail(g, `Deep link ${path} opens the app`, `status ${r.status}`)
  }
  const h = home.headers
  const csp = h.get('content-security-policy') ?? ''
  csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'")
    ? pass(g, 'Content Security Policy')
    : fail(g, 'Content Security Policy', csp ? 'present but weaker than vercel.json' : 'missing')
  const expect = {
    'strict-transport-security': (v) => /max-age=\d{8,}/.test(v),
    'x-frame-options': (v) => v.toUpperCase() === 'DENY',
    'x-content-type-options': (v) => v === 'nosniff',
    'referrer-policy': (v) => v.length > 0,
    'permissions-policy': (v) => v.includes('camera=()'),
  }
  for (const [name, ok] of Object.entries(expect)) {
    const v = h.get(name) ?? ''
    ok(v) ? pass(g, `Header ${name}`) : fail(g, `Header ${name}`, v || 'missing')
  }
  const script = home.text.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1]
  if (!script) {
    warn(g, 'App code found', 'no /assets script in the page')
    return null
  }
  const js = await get(`${APP}${script}`)
  ;/immutable/.test(js.headers.get('cache-control') ?? '')
    ? pass(g, 'App files are cached for a year')
    : warn(
        g,
        'App files are cached for a year',
        js.headers.get('cache-control') ?? 'no cache header',
      )
  return js.text
}

/** The browser code must only ever hold the public key. */
async function bundle(entry) {
  const g = 'Secrets'
  if (!entry) return
  const chunks = [entry]
  for (const m of entry.matchAll(/["'(](\/?assets\/[A-Za-z0-9_.-]+\.js)["')]/g)) {
    const r = await get(`${APP}/${m[1].replace(/^\//, '')}`)
    if (r.status === 200) chunks.push(r.text)
  }
  const all = chunks.join('\n')
  const leaks = [
    [/sb_secret_[A-Za-z0-9_-]{10,}/, 'a Supabase secret key'],
    [/"role"\s*:\s*"service_role"/, 'a service-role key'],
    [/re_[A-Za-z0-9]{20,}/, 'a Resend API key'],
    [/whsec_[A-Za-z0-9+/=]{20,}/, 'a webhook secret'],
  ]
  // Service-role keys are JWTs: decode any JWT in the code and look at its role.
  for (const t of all.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ??
    []) {
    try {
      if (
        JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role === 'service_role'
      ) {
        fail(g, 'No server keys in the browser code', 'a service-role JWT is in the app code')
        return
      }
    } catch {
      // not a JWT
    }
  }
  const found = leaks.find(([re]) => re.test(all))
  found
    ? fail(g, 'No server keys in the browser code', `found ${found[1]}`)
    : pass(g, 'No server keys in the browser code', `${chunks.length} files checked`)
}

// Server functions: anonymous calls are refused before anything happens ---------------------------------
async function functions() {
  const g = 'Server functions'
  const refused = (r) => [401, 403].includes(r.status)
  const checks = [
    ['Daily job needs the cron secret', `${APP}/api/cron/daily`, {}],
    [
      'Sending needs a signed-in team member',
      `${APP}/api/messages/send`,
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
    ],
    ['Email status needs a signed-in team member', `${APP}/api/messages/status`, {}],
    ['Integrations need a signed-in team member', `${APP}/api/integrations`, {}],
    [
      'Invitations need an administrator',
      `${APP}/api/team/invitations`,
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
    ],
    [
      'Notification email needs a signed-in person',
      `${APP}/api/notifications/flush`,
      { method: 'POST' },
    ],
  ]
  for (const [name, url, init] of checks) {
    const r = await get(url, init)
    const unconfigured =
      r.json?.status === 'not_configured' ||
      r.json?.error === 'not_configured' ||
      (r.status === 200 && r.json && 'missing' in r.json)
    if (refused(r)) pass(g, name, String(r.status))
    else if (r.status === 503 || unconfigured)
      warn(
        g,
        name,
        `not configured on the server (503)${r.json?.missing ? `: ${r.json.missing.join(', ')}` : ''}`,
      )
    else fail(g, name, r.error ?? `answered ${r.status}`)
  }
  // Not probed: the webhooks, document links and sign-in return address count every request
  // (rate limits), which would write to the database.
}

// The database ----------------------------------------------------------------------------------------
const MIGRATIONS = [
  ['20261125000001 core schema', 'customers?select=id&limit=0'],
  ['20261125000003 dashboard views', 'invoice_summary?select=*&limit=0'],
  ['20261125000004 customer and property fields', 'customers?select=customer_type&limit=0'],
  ['20261125000005 access requests', 'access_requests?select=id&limit=0'],
  ['20261125000006 meters', 'meter_maintenance?select=id&limit=0'],
  ['20261125000007 sales', 'sales_events?select=id&limit=0'],
  ['20261126000008 invoices', 'invoice_items?select=id&limit=0'],
  ['20261126000009 inventory', 'products?select=stock_on_hand&limit=0'],
  ['20261126000010 support tickets', 'ticket_events?select=id&limit=0'],
  ['20261126000011 team and tasks', 'task_events?select=id&limit=0'],
  ['20261127000012 communications', 'message_events?select=id&limit=0'],
  ['20261128000013 reports', 'rpc/report_overview?p_from=2026-01-01&p_to=2026-01-31'],
  ['20261129000014 notifications and automations', 'automations?select=key&limit=0'],
  ['20261129000015 settings and audit', 'ticket_categories?select=key&limit=0'],
  ['20261130000016 rate limits', 'api_rate_limits?select=key&limit=0'],
  ['20261201000017 integrations', 'integrations?select=id&limit=0'],
]

const rest = (path) =>
  get(`${SUPABASE}/rest/v1/${path}`, {
    // The publishable (anon) key goes in apikey only; Supabase then treats the request as anonymous.
    headers: ANON.startsWith('eyJ')
      ? { apikey: ANON, Authorization: `Bearer ${ANON}` }
      : { apikey: ANON },
  })

/** The object exists if it answers, or refuses the anonymous visitor; it is missing if PostgREST cannot find it. */
const missing = (r) =>
  r.status === 404 || ['PGRST202', 'PGRST205', '42P01', '42703', '42883'].includes(r.json?.code)
const exists = (r) =>
  r.status === 200 ||
  r.status === 206 ||
  ['42501', 'PGRST301'].includes(r.json?.code) ||
  r.status === 401 ||
  r.status === 403

async function database() {
  if (!SUPABASE || !ANON) {
    fail(
      'Database',
      'Supabase address and anon key',
      'missing (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)',
    )
    return
  }
  const g = 'Migrations'
  let firstMissing = null
  for (const [name, path] of MIGRATIONS) {
    const r = await rest(path)
    if (missing(r)) {
      fail(g, name, `not applied (${r.json?.code ?? r.status})`)
      firstMissing ??= name
    } else if (exists(r)) pass(g, name)
    else fail(g, name, r.error ?? `unexpected ${r.status} ${r.json?.code ?? ''}`)
  }

  const a = 'Anonymous access'
  for (const table of [
    'customers',
    'invoices',
    'profiles',
    'support_tickets',
    'communication_logs',
    'audit_logs',
  ]) {
    const r = await rest(`${table}?select=id&limit=1`)
    if (missing(r)) continue
    if (r.status === 200 && Array.isArray(r.json) && r.json.length === 0)
      pass(a, `${table}: no rows for visitors`)
    else if (exists(r) && r.status !== 200) pass(a, `${table}: refused`)
    else
      fail(
        a,
        `${table}: visible to visitors`,
        `${Array.isArray(r.json) ? r.json.length : '?'} rows`,
      )
  }
  for (const table of ['integration_secrets', 'integration_oauth_states', 'document_links']) {
    const r = await rest(`${table}?select=*&limit=1`)
    if (missing(r)) continue
    r.status === 200 && Array.isArray(r.json) && r.json.length > 0
      ? fail(a, `${table}: visible to visitors`)
      : pass(a, `${table}: closed`)
  }

  const s = 'Sign-in settings'
  const auth = await get(`${SUPABASE}/auth/v1/settings`, { headers: { apikey: ANON } })
  if (auth.status !== 200 || !auth.json) {
    warn(s, 'Auth settings readable', `status ${auth.status}`)
    return
  }
  auth.json.disable_signup
    ? pass(s, 'Open sign-up is off (people join by invitation or account request)')
    : warn(
        s,
        'Open sign-up is on',
        'anyone can create a login (they get no access without a profile); turn off "Allow new users to sign up" in Supabase → Authentication → Sign In / Providers',
      )
  auth.json.mailer_autoconfirm
    ? warn(s, 'Email confirmation', 'addresses are not confirmed; turn on "Confirm email"')
    : pass(s, 'Email addresses must be confirmed')
}

const started = Date.now()
const entry = await site()
await bundle(entry)
await functions()
await database()

const icon = { pass: 'ok  ', warn: 'warn', fail: 'FAIL' }
let group = ''
for (const r of results) {
  if (r.group !== group) {
    group = r.group
    console.log(`\n${group}`)
  }
  console.log(`  ${icon[r.status]}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
}
const count = (s) => results.filter((r) => r.status === s).length
console.log(
  `\n${count('pass')} passed, ${count('warn')} warnings, ${count('fail')} failed in ${((Date.now() - started) / 1000).toFixed(1)} s  ·  ${APP}  ·  ${SUPABASE}`,
)
process.exit(count('fail') > 0 ? 1 : 0)
