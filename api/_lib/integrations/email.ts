import { sendViaResend } from '../resend.js'
import { call, failure, form, str } from './http.js'
import { buildMime, mailbox } from './mime.js'
import type { Adapter, AdapterContext, Credentials, OAuthGrant } from './types.js'
import type { Capability } from '../../../shared/integrations.js'

/** A token is renewed a minute before it runs out. */
export const isExpired = (credentials: Credentials, now: number) =>
  typeof credentials.expiresAt === 'number' && credentials.expiresAt - 60_000 <= now

const expiresAt = (seconds: unknown, now: number) =>
  typeof seconds === 'number' && seconds > 0 ? now + seconds * 1000 : undefined

const scopesOf = (value: unknown) =>
  typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : []

// Resend -------------------------------------------------------------------------------------------
export const resend: Adapter = {
  provider: 'resend',
  // Resend refuses a repeated Idempotency-Key for 24 hours.
  idempotent: true,
  async verify(credentials, settings, ctx) {
    const apiKey = str(credentials.apiKey)
    const from = (settings.fromAddress ?? '').toLowerCase()
    const r = await call(ctx.fetch, 'https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (r.network) return { ok: false, error: `Could not reach Resend: ${r.error}` }
    const name = str(r.body.name)
    const capabilities: Capability[] = ['send_email', 'attachments']
    if (credentials.webhookSecret) capabilities.push('delivery_tracking')
    // A sending-only key cannot list domains; Resend saying so proves the key is real. The domain
    // is then confirmed by the first email (use Test).
    if (r.res.status === 401 && name === 'restricted_api_key') {
      return { ok: true, account: { accountLabel: from, accountId: from, capabilities } }
    }
    if (!r.res.ok) {
      return {
        ok: false,
        error: `Resend refused the API key (${r.res.status}${name ? ` ${name}` : ''}).`,
      }
    }
    const domains = Array.isArray(r.body.data) ? (r.body.data as Record<string, unknown>[]) : []
    const domain = from.split('@')[1] ?? ''
    const match = domains.find((d) => str(d.name).toLowerCase() === domain)
    if (!match)
      return { ok: false, error: `${domain || 'That domain'} is not in this Resend account.` }
    if (str(match.status) !== 'verified') {
      return {
        ok: false,
        error: `${domain} is not verified in Resend yet (status: ${str(match.status) || 'unknown'}).`,
      }
    }
    return { ok: true, account: { accountLabel: from, accountId: from, capabilities } }
  },
  async send(m, credentials, connection, ctx) {
    const from = mailbox(connection.settings.fromAddress ?? '', connection.settings.fromName)
    const r = await sendViaResend(
      {
        from,
        to: m.to ?? '',
        replyTo: connection.settings.replyTo || undefined,
        subject: m.subject ?? '',
        text: m.text,
        html: m.html,
        attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content })),
        idempotencyKey: m.idempotencyKey,
        tags: [{ name: 'message_id', value: m.id }],
      },
      str(credentials.apiKey),
      ctx.fetch,
    )
    return r.ok ? { ok: true, id: r.id, sender: connection.settings.fromAddress ?? null } : r
  },
}

// Gmail / Google Workspace -------------------------------------------------------------------------
const GOOGLE_SEND = 'https://www.googleapis.com/auth/gmail.send'

async function googleToken(
  body: Record<string, string>,
  ctx: AdapterContext,
): Promise<Record<string, unknown> | null> {
  const r = await call(ctx.fetch, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body),
  })
  if (r.network || !r.res.ok || !str(r.body.access_token)) return null
  return r.body
}

export const google: Adapter = {
  provider: 'google',
  // Gmail has no idempotency key: an uncertain send waits for a person.
  idempotent: false,
  oauth: {
    app: 'google',
    authorizeUrl: ({ clientId, redirectUri, state, challenge }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${form({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: `openid email ${GOOGLE_SEND}`,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    async exchange({ code, verifier, redirectUri }, ctx): Promise<OAuthGrant> {
      const app = ctx.oauth.google
      const t = app
        ? await googleToken(
            {
              code,
              client_id: app.clientId,
              client_secret: app.clientSecret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
              code_verifier: verifier,
            },
            ctx,
          )
        : null
      if (!t) throw new Error('Google did not accept the sign-in. Try connecting again.')
      return {
        credentials: {
          accessToken: str(t.access_token),
          refreshToken: str(t.refresh_token),
          expiresAt: expiresAt(t.expires_in, ctx.now()),
          scopes: scopesOf(t.scope),
        },
        scopes: scopesOf(t.scope),
      }
    },
  },
  async refresh(credentials, ctx) {
    const app = ctx.oauth.google
    if (!app || !str(credentials.refreshToken)) return null
    const t = await googleToken(
      {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: str(credentials.refreshToken),
        grant_type: 'refresh_token',
      },
      ctx,
    )
    if (!t) return null
    return {
      ...credentials,
      accessToken: str(t.access_token),
      expiresAt: expiresAt(t.expires_in, ctx.now()),
      scopes: t.scope ? scopesOf(t.scope) : credentials.scopes,
    }
  },
  async revoke(credentials, ctx) {
    const token = str(credentials.refreshToken) || str(credentials.accessToken)
    if (token)
      await call(ctx.fetch, `https://oauth2.googleapis.com/revoke?${form({ token })}`, {
        method: 'POST',
      })
  },
  async verify(credentials, _settings, ctx) {
    const auth = { Authorization: `Bearer ${str(credentials.accessToken)}` }
    const who = await call(ctx.fetch, 'https://openidconnect.googleapis.com/v1/userinfo', {
      headers: auth,
    })
    if (who.network) return { ok: false, error: `Could not reach Google: ${who.error}` }
    if (!who.res.ok || !str(who.body.email))
      return { ok: false, error: 'Google did not confirm the account. Connect again.' }
    const info = await call(
      ctx.fetch,
      `https://oauth2.googleapis.com/tokeninfo?${form({ access_token: str(credentials.accessToken) })}`,
      {},
    )
    const granted = info.network
      ? scopesOf((credentials.scopes as string[] | undefined)?.join(' '))
      : scopesOf(info.body.scope)
    if (!granted.includes(GOOGLE_SEND)) {
      return {
        ok: false,
        error: 'Permission to send email from Gmail was not granted. Connect again and allow it.',
      }
    }
    const address = str(who.body.email).toLowerCase()
    return {
      ok: true,
      account: {
        accountLabel: address,
        accountId: str(who.body.sub) || address,
        capabilities: ['send_email', 'attachments'],
        settings: { address },
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    const address = connection.settings.address ?? connection.accountLabel ?? ''
    const raw = buildMime({
      from: mailbox(address, connection.settings.fromName),
      to: mailbox(m.to ?? '', m.toName),
      replyTo: connection.settings.replyTo || null,
      subject: m.subject ?? '',
      text: m.text,
      html: m.html,
      attachments: m.attachments,
      messageId: `<${m.id}@umbane.crm>`,
    })
    const r = await call(
      ctx.fetch,
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${str(credentials.accessToken)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
      },
    )
    if (r.network) return failure('Gmail', r, false)
    if (r.res.ok && str(r.body.id))
      return { ok: true, id: `gmail:${str(r.body.id)}`, sender: address }
    const err = (r.body.error ?? {}) as Record<string, unknown>
    return failure(
      'Gmail',
      {
        status: r.res.status,
        code: str(err.status),
        message: str(err.message) || r.res.statusText,
      },
      false,
    )
  },
}

// Outlook / Microsoft 365 --------------------------------------------------------------------------
const MS_SCOPES = 'offline_access openid email User.Read Mail.Send'
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

async function msToken(body: Record<string, string>, ctx: AdapterContext) {
  const r = await call(ctx.fetch, MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body),
  })
  if (r.network || !r.res.ok || !str(r.body.access_token)) return null
  return r.body
}

const hasMailSend = (scopes: string[]) => scopes.some((s) => /(^|\/)mail\.send$/i.test(s))

export const microsoft: Adapter = {
  provider: 'microsoft',
  idempotent: false,
  oauth: {
    app: 'microsoft',
    authorizeUrl: ({ clientId, redirectUri, state, challenge }) =>
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${form({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: MS_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })}`,
    async exchange({ code, verifier, redirectUri }, ctx) {
      const app = ctx.oauth.microsoft
      const t = app
        ? await msToken(
            {
              client_id: app.clientId,
              client_secret: app.clientSecret,
              code,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
              code_verifier: verifier,
              scope: MS_SCOPES,
            },
            ctx,
          )
        : null
      if (!t) throw new Error('Microsoft did not accept the sign-in. Try connecting again.')
      return {
        credentials: {
          accessToken: str(t.access_token),
          refreshToken: str(t.refresh_token),
          expiresAt: expiresAt(t.expires_in, ctx.now()),
          scopes: scopesOf(t.scope),
        },
        scopes: scopesOf(t.scope),
      }
    },
  },
  async refresh(credentials, ctx) {
    const app = ctx.oauth.microsoft
    if (!app || !str(credentials.refreshToken)) return null
    const t = await msToken(
      {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: str(credentials.refreshToken),
        grant_type: 'refresh_token',
        scope: MS_SCOPES,
      },
      ctx,
    )
    if (!t) return null
    return {
      ...credentials,
      accessToken: str(t.access_token),
      // Microsoft hands out a new refresh token each time.
      refreshToken: str(t.refresh_token) || str(credentials.refreshToken),
      expiresAt: expiresAt(t.expires_in, ctx.now()),
      scopes: t.scope ? scopesOf(t.scope) : credentials.scopes,
    }
  },
  async verify(credentials, _settings, ctx) {
    const r = await call(
      ctx.fetch,
      'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName',
      { headers: { Authorization: `Bearer ${str(credentials.accessToken)}` } },
    )
    if (r.network) return { ok: false, error: `Could not reach Microsoft: ${r.error}` }
    if (!r.res.ok)
      return { ok: false, error: 'Microsoft did not confirm the mailbox. Connect again.' }
    const scopes = Array.isArray(credentials.scopes) ? (credentials.scopes as string[]) : []
    if (!hasMailSend(scopes)) {
      return {
        ok: false,
        error:
          'Permission to send mail (Mail.Send) was not granted. Your Microsoft 365 administrator may need to approve it.',
      }
    }
    const address = (str(r.body.mail) || str(r.body.userPrincipalName)).toLowerCase()
    return {
      ok: true,
      account: {
        accountLabel: address,
        accountId: str(r.body.id) || address,
        capabilities: ['send_email', 'attachments'],
        settings: { address },
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    const message: Record<string, unknown> = {
      subject: m.subject ?? '',
      body: { contentType: 'HTML', content: m.html },
      toRecipients: [{ emailAddress: { address: m.to, ...(m.toName ? { name: m.toName } : {}) } }],
      ...(connection.settings.replyTo
        ? { replyTo: [{ emailAddress: { address: connection.settings.replyTo } }] }
        : {}),
      ...(m.attachments.length
        ? {
            attachments: m.attachments.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.filename,
              contentType: a.contentType,
              contentBytes: a.content,
            })),
          }
        : {}),
    }
    const r = await call(ctx.fetch, 'https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${str(credentials.accessToken)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    })
    if (r.network) return failure('Outlook', r, false)
    // Accepted (202): Microsoft does not give the message an id here.
    if (r.res.status === 202 || r.res.ok) {
      return { ok: true, id: null, sender: connection.settings.address ?? connection.accountLabel }
    }
    const err = (r.body.error ?? {}) as Record<string, unknown>
    return failure(
      'Outlook',
      { status: r.res.status, code: str(err.code), message: str(err.message) || r.res.statusText },
      false,
    )
  },
}
