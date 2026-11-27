import type { SupabaseClient } from '@supabase/supabase-js'
import { providerInfo } from '../../shared/integrations.js'
import { builtInOf, type DeliveryConfig } from '../_lib/deliver.js'
import { isRoute, routeFor } from '../_lib/integrations/sender.js'
import { textToHtml } from '../_lib/resend.js'
import {
  adminCaller,
  adminClient,
  deliveryConfig,
  json,
  RATE_LIMITS,
  readEnv,
  tooManyRequests,
  withinRateLimit,
  type ServerEnv,
} from '../_lib/server.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const ROLE_LABEL: Record<string, string> = {
  administrator: 'Administrator',
  manager: 'Manager',
  staff: 'Staff',
}

interface Deps {
  env: ServerEnv
  admin: () => SupabaseClient
  config: (env: ServerEnv, admin?: unknown) => DeliveryConfig
}

interface Invitation {
  id: string
  business_id: string
  email: string
  full_name: string
  role: string
  status: string
  expires_at: string
  send_count: number
  auth_user_id: string | null
  invited_by: string | null
}

type LinkResult =
  | { ok: true; link: string; userId: string | null }
  | { ok: false; status: number; error: string; message: string }

/**
 * A sign-in link from Supabase Auth for the invited address. Supabase stays the identity system:
 * it creates the account (or, for an account that exists but was never confirmed, a sign-in link)
 * and confirms the address when the link is used; the business's email account only delivers it.
 */
async function invitationLink(
  db: SupabaseClient,
  inv: Invitation,
  appUrl: string,
): Promise<LinkResult> {
  const redirectTo = `${appUrl.replace(/\/$/, '')}/welcome`
  const invite = await db.auth.admin.generateLink({
    type: 'invite',
    email: inv.email,
    options: { redirectTo, data: { full_name: inv.full_name } },
  })
  if (!invite.error && invite.data?.properties?.action_link) {
    return {
      ok: true,
      link: invite.data.properties.action_link,
      userId: invite.data.user?.id ?? null,
    }
  }
  // Already registered: a sign-in link instead. It confirms an address that never was.
  const magic = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: inv.email,
    options: { redirectTo },
  })
  if (magic.error || !magic.data?.properties?.action_link) {
    return {
      ok: false,
      status: 502,
      error: 'link_failed',
      message: 'Supabase could not make an invitation link. Try again in a minute.',
    }
  }
  const user = magic.data.user
  if (user?.email_confirmed_at) {
    // A confirmed account is added straight away by Add Employee; one that exists now belongs to
    // someone who signed up meanwhile, so the invitation cannot make them join.
    const profile = await db.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (profile.data) {
      return {
        ok: false,
        status: 409,
        error: 'already_member',
        message: 'This person already has a profile. They cannot be invited again.',
      }
    }
  }
  return { ok: true, link: magic.data.properties.action_link, userId: user?.id ?? null }
}

function invitationEmail(
  inv: Invitation,
  businessName: string,
  inviter: string | null,
  link: string,
  expires: Date,
) {
  const until = expires.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
  const intro = `Hello ${inv.full_name},\n\n${inviter ?? 'Your administrator'} has invited you to join ${businessName} on Umbane CRM as ${ROLE_LABEL[inv.role] ?? inv.role}.`
  const after = `The invitation is open until ${until}. The link itself works for a limited time; if it has stopped working, ask ${inviter ?? 'your administrator'} to send a new one.\n\nIf you were not expecting this, you can ignore this email.`
  return {
    subject: `You are invited to join ${businessName} on Umbane`,
    text: `${intro}\n\nAccept the invitation and set your password:\n${link}\n\n${after}`,
    // The history keeps the email without the link: anyone holding it could sign in as them.
    logged: `${intro}\n\nAccept the invitation and set your password: [invitation link]\n\n${after}`,
  }
}

/**
 * POST /api/team/invitations { action, invitationId }   administrators only
 *   send     sends the invitation through the business's email (Settings → Integrations), or the
 *            built-in sender; "resend" is the same, and opens it for another week
 *   link     a fresh invitation link to copy and share another way
 *   cancel   cancels it, and removes the unused sign-in account the link made
 */
export function createInvitationsHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    const { env } = deps
    if (!env.supabaseUrl || !env.serviceKey) return json({ error: 'not_configured' }, 503)
    const db = deps.admin()
    const caller = await adminCaller(db, request)
    if (!caller) return json({ error: 'forbidden' }, 403)
    if (!(await withinRateLimit(db, 'invitations:' + caller.id, RATE_LIMITS.invitations)))
      return tooManyRequests()

    let body: { action?: unknown; invitationId?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    const action = String(body.action ?? '')
    const id = String(body.invitationId ?? '')
    if (!UUID.test(id) || !['send', 'resend', 'link', 'cancel'].includes(action))
      return json({ error: 'bad_request' }, 400)

    const found = await db.from('staff_invitations').select('*').eq('id', id).maybeSingle()
    const inv = found.data as Invitation | null
    if (found.error || !inv || inv.business_id !== caller.businessId)
      return json({ error: 'not_found' }, 404)
    if (inv.status !== 'pending' && !(inv.status === 'expired' && action !== 'cancel')) {
      return json({ error: 'closed', status: inv.status }, 409)
    }

    if (action === 'cancel') {
      await db
        .from('staff_invitations')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'pending')
      if (inv.auth_user_id) {
        // Only an account nobody has used: never confirmed and without a profile.
        const user = await db.auth.admin.getUserById(inv.auth_user_id)
        const profile = await db
          .from('profiles')
          .select('id')
          .eq('id', inv.auth_user_id)
          .maybeSingle()
        if (user.data?.user && !user.data.user.email_confirmed_at && !profile.data) {
          await db.auth.admin.deleteUser(inv.auth_user_id)
        }
      }
      return json({ state: 'cancelled' })
    }

    if (!env.appUrl) return json({ error: 'not_configured', missing: ['APP_URL'] }, 503)
    const link = await invitationLink(db, inv, env.appUrl)
    if (!link.ok) return json({ error: link.error, message: link.message }, link.status)
    const expires = new Date(Date.now() + WEEK_MS)
    const opened = {
      auth_user_id: link.userId ?? inv.auth_user_id,
      // Sending (or copying) again gives the person another week.
      expires_at: expires.toISOString(),
      ...(inv.status === 'expired' ? { status: 'pending' } : {}),
    }
    if (inv.status === 'expired') {
      // Someone else may have invited the same address since it expired.
      const other = await db
        .from('staff_invitations')
        .select('id')
        .eq('email', inv.email)
        .eq('status', 'pending')
        .neq('id', id)
        .limit(1)
      if ((other.data ?? []).length) return json({ error: 'closed', status: 'expired' }, 409)
    }

    if (action === 'link') {
      await db.from('staff_invitations').update(opened).eq('id', id)
      await db.from('audit_logs').insert({
        business_id: inv.business_id,
        actor_id: caller.id,
        action: 'invitation.link_copied',
        table_name: 'staff_invitations',
        record_id: id,
        details: { email: inv.email },
      })
      return json({ link: link.link, expiresAt: opened.expires_at })
    }

    const [biz, inviter] = await Promise.all([
      db.from('businesses').select('name').eq('id', inv.business_id).maybeSingle(),
      db.from('profiles').select('full_name').eq('id', caller.id).maybeSingle(),
    ])
    const businessName = (biz.data as { name?: string } | null)?.name ?? 'your team'
    const inviterName = (inviter.data as { full_name?: string } | null)?.full_name ?? null
    const email = invitationEmail(inv, businessName, inviterName, link.link, expires)
    const config = deps.config(env, db)
    const route = await routeFor(
      config.integrations ?? null,
      builtInOf(config),
      inv.business_id,
      'email',
      null,
    )
    const attempt = (inv.send_count ?? 0) + 1

    if (!isRoute(route)) {
      await db
        .from('staff_invitations')
        .update({ ...opened, delivery_status: 'failed', last_error: route.error.slice(0, 500) })
        .eq('id', id)
      return json({ state: 'failed', error: route.error, canCopyLink: true }, 200)
    }

    await db
      .from('staff_invitations')
      .update({ ...opened, delivery_status: 'sending' })
      .eq('id', id)
    let result
    try {
      result = await route.send({
        id,
        to: inv.email,
        toName: inv.full_name,
        subject: email.subject,
        text: email.text,
        html: textToHtml(email.text),
        attachments: [],
        documentUrl: null,
        linkUrl: null,
        imageUrl: null,
        idempotencyKey: `invitation:${id}:${attempt}`,
        purpose: 'transactional',
      })
    } catch (e) {
      result = {
        ok: false as const,
        retryable: false,
        error: `Send failed: ${(e as Error).message}`,
      }
    }
    const via = `${providerInfo(route.provider)?.label ?? route.provider}${route.sender ? ` (${route.sender})` : ''}`
    const now = new Date().toISOString()
    await db
      .from('staff_invitations')
      .update(
        result.ok
          ? {
              delivery_status: 'sent',
              sent_at: now,
              send_count: attempt,
              last_error: null,
              sent_via: via.slice(0, 200),
            }
          : {
              delivery_status: 'failed',
              send_count: attempt,
              last_error: result.error.slice(0, 500),
              sent_via: via.slice(0, 200),
            },
      )
      .eq('id', id)
    // In the communication history like every other message (without the link).
    await db.from('communication_logs').insert({
      business_id: inv.business_id,
      channel: 'email',
      direction: 'outbound',
      message_type: 'email',
      purpose: 'transactional',
      subject: email.subject,
      body: email.logged,
      status: result.ok ? 'sent' : 'failed',
      recipient: inv.email,
      recipient_name: inv.full_name,
      invitation_id: id,
      integration_id: route.integrationId,
      provider: route.provider,
      sender: route.sender,
      provider_message_id: result.ok ? result.id : null,
      error: result.ok ? null : result.error.slice(0, 500),
      created_by: caller.id,
      sent_at: result.ok ? now : null,
      last_event_at: now,
      attempts: 1,
    })
    return json(
      result.ok
        ? { state: 'sent', via }
        : { state: 'failed', error: result.error, canCopyLink: true },
    )
  }
}

export function POST(request: Request) {
  const env = readEnv()
  return createInvitationsHandler({ env, admin: () => adminClient(env), config: deliveryConfig })(
    request,
  )
}
