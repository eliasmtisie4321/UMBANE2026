import type { SupabaseClient } from '@supabase/supabase-js'
import {
  adminClient,
  clientAddress,
  RATE_LIMITS,
  readEnv,
  withinRateLimit,
  type ServerEnv,
} from './_lib/server.js'

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
}

const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1b1b1f"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p></body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    },
  )

/**
 * GET /api/documents?t=<token>
 * A private document link sent by SMS. The link works for 30 days unless the message was
 * cancelled; each visit gets a download that lasts five minutes. Nothing about the document or the
 * customer is shown to someone with a wrong or expired link.
 */
export function createDocumentsHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET')
      return page(405, 'Not available', 'This address only opens documents.')
    if (!deps.env.supabaseUrl || !deps.env.serviceKey)
      return page(503, 'Not available', 'Please try again later.')
    const db = deps.admin()
    if (
      !(await withinRateLimit(db, 'documents:' + clientAddress(request), RATE_LIMITS.documents))
    ) {
      return page(429, 'Too many requests', 'Please wait a minute and try again.')
    }
    const token = new URL(request.url).searchParams.get('t') ?? ''
    const gone = page(
      410,
      'This link no longer works',
      'It may have expired. Ask the sender for a new one.',
    )
    if (!/^[0-9a-f]{48}$/.test(token)) return gone
    const found = await db.from('document_links').select('*').eq('token', token).maybeSingle()
    const link = found.data as {
      id: string
      bucket: string
      path: string
      file_name: string
      expires_at: string
      revoked_at: string | null
      opened_count: number
    } | null
    if (found.error || !link || link.revoked_at || new Date(link.expires_at).getTime() < Date.now())
      return gone
    const signed = await db.storage
      .from(link.bucket)
      .createSignedUrl(link.path, 300, { download: link.file_name })
    if (signed.error || !signed.data?.signedUrl) return gone
    await db
      .from('document_links')
      .update({
        opened_count: (link.opened_count ?? 0) + 1,
        last_opened_at: new Date().toISOString(),
      })
      .eq('id', link.id)
    return new Response(null, {
      status: 302,
      headers: {
        location: signed.data.signedUrl,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    })
  }
}

export function GET(request: Request) {
  const env = readEnv()
  return createDocumentsHandler({ env, admin: () => adminClient(env) })(request)
}
