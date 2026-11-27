import { call, failure, form, str } from './http.js'
import { GRAPH } from './messaging.js'
import type { Adapter, AdapterContext, Credentials, OAuthGrant, SendResult } from './types.js'

// Facebook Pages and Instagram (one Meta login, a connection each) ------------------------------------
const FACEBOOK_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
const INSTAGRAM_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
]

function metaAuthorize(scopes: string[]) {
  return ({
    clientId,
    redirectUri,
    state,
  }: {
    clientId: string
    redirectUri: string
    state: string
  }) =>
    `https://www.facebook.com/v21.0/dialog/oauth?${form({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes.join(','),
    })}`
}

/** Code -> short-lived token -> long-lived (about 60 days) token, and what was actually granted. */
async function metaExchange(
  { code, redirectUri }: { code: string; redirectUri: string },
  ctx: AdapterContext,
): Promise<OAuthGrant> {
  const app = ctx.oauth.meta
  if (!app) throw new Error('Meta sign-in is not set up on the server.')
  const short = await call(
    ctx.fetch,
    `${GRAPH}/oauth/access_token?${form({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code })}`,
    {},
  )
  if (short.network || !short.res.ok || !str(short.body.access_token)) {
    throw new Error('Meta did not accept the sign-in. Try connecting again.')
  }
  const long = await call(
    ctx.fetch,
    `${GRAPH}/oauth/access_token?${form({
      grant_type: 'fb_exchange_token',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      fb_exchange_token: str(short.body.access_token),
    })}`,
    {},
  )
  const userToken =
    !long.network && long.res.ok && str(long.body.access_token)
      ? str(long.body.access_token)
      : str(short.body.access_token)
  const perms = await call(
    ctx.fetch,
    `${GRAPH}/me/permissions?${form({ access_token: userToken })}`,
    {},
  )
  const scopes =
    !perms.network && Array.isArray(perms.body.data)
      ? (perms.body.data as Record<string, unknown>[])
          .filter((p) => p.status === 'granted')
          .map((p) => str(p.permission))
      : []
  return { credentials: { userToken, scopes }, scopes }
}

interface Page {
  id: string
  name: string
  token: string
}

async function pagesFor(credentials: Credentials, ctx: AdapterContext): Promise<Page[] | string> {
  const r = await call(
    ctx.fetch,
    `${GRAPH}/me/accounts?${form({ fields: 'id,name,access_token,tasks', limit: '50', access_token: str(credentials.userToken) })}`,
    {},
  )
  if (r.network) return `Could not reach Facebook: ${r.error}`
  if (!r.res.ok) return 'Facebook did not confirm the account. Connect again.'
  const rows = Array.isArray(r.body.data) ? (r.body.data as Record<string, unknown>[]) : []
  return rows
    .filter((p) => !Array.isArray(p.tasks) || (p.tasks as string[]).includes('CREATE_CONTENT'))
    .map((p) => ({ id: str(p.id), name: str(p.name), token: str(p.access_token) }))
    .filter((p) => p.id && p.token)
}

const granted = (credentials: Credentials, needed: string) =>
  Array.isArray(credentials.scopes) && (credentials.scopes as string[]).includes(needed)

function metaFailure(
  provider: string,
  status: number,
  body: Record<string, unknown>,
): Extract<SendResult, { ok: false }> {
  const err = (body.error ?? {}) as Record<string, unknown>
  const code = typeof err.code === 'number' ? err.code : 0
  // 4, 17, 32, 613: Meta's rate limits. 9007: Instagram is still preparing the image.
  const busy = [4, 17, 32, 613, 9007].includes(code) || Number(err.error_subcode) === 2207027
  return failure(
    provider,
    {
      status: busy ? 429 : status,
      code: code ? String(code) : undefined,
      message: str(err.message) || 'refused',
    },
    false,
  )
}

export const facebook: Adapter = {
  provider: 'facebook',
  idempotent: false,
  oauth: { app: 'meta', authorizeUrl: metaAuthorize(FACEBOOK_SCOPES), exchange: metaExchange },
  async verify(credentials, settings, ctx) {
    if (!granted(credentials, 'pages_manage_posts')) {
      return {
        ok: false,
        error: 'Permission to post to your Page (pages_manage_posts) was not granted.',
      }
    }
    const pages = await pagesFor(credentials, ctx)
    if (typeof pages === 'string') return { ok: false, error: pages }
    if (!pages.length)
      return { ok: false, error: 'There is no Facebook Page you can post to on this account.' }
    const page = pages.find((p) => p.id === settings.pageId) ?? pages[0]
    return {
      ok: true,
      account: {
        accountLabel: page.name,
        accountId: page.id,
        capabilities: ['publish_social'],
        settings: {
          pageId: page.id,
          pageOptions: JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name }))),
        },
        credentials: { ...credentials, pageId: page.id, pageToken: page.token },
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    const pageId = str(credentials.pageId) || connection.accountId || ''
    const token = str(credentials.pageToken)
    const withImage = Boolean(m.imageUrl)
    const body: Record<string, string> = withImage
      ? {
          url: m.imageUrl ?? '',
          caption: m.linkUrl ? `${m.text}\n\n${m.linkUrl}` : m.text,
          access_token: token,
        }
      : { message: m.text, ...(m.linkUrl ? { link: m.linkUrl } : {}), access_token: token }
    const r = await call(ctx.fetch, `${GRAPH}/${pageId}/${withImage ? 'photos' : 'feed'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(body),
    })
    if (r.network) return failure('Facebook', r, false)
    const postId = str(r.body.post_id) || str(r.body.id)
    if (r.res.ok && postId) {
      return {
        ok: true,
        id: `facebook:${postId}`,
        externalUrl: `https://www.facebook.com/${postId}`,
        sender: connection.accountLabel,
      }
    }
    return metaFailure('Facebook', r.res.status, r.body)
  },
}

export const instagram: Adapter = {
  provider: 'instagram',
  idempotent: false,
  oauth: { app: 'meta', authorizeUrl: metaAuthorize(INSTAGRAM_SCOPES), exchange: metaExchange },
  async verify(credentials, settings, ctx) {
    if (!granted(credentials, 'instagram_content_publish')) {
      return {
        ok: false,
        error: 'Permission to publish to Instagram (instagram_content_publish) was not granted.',
      }
    }
    const pages = await pagesFor(credentials, ctx)
    if (typeof pages === 'string') return { ok: false, error: pages }
    const accounts: { id: string; username: string; pageToken: string }[] = []
    for (const p of pages) {
      const r = await call(
        ctx.fetch,
        `${GRAPH}/${p.id}?${form({ fields: 'instagram_business_account{id,username}', access_token: p.token })}`,
        {},
      )
      const ig =
        !r.network && r.res.ok
          ? (r.body.instagram_business_account as Record<string, unknown> | undefined)
          : undefined
      if (ig && str(ig.id))
        accounts.push({ id: str(ig.id), username: str(ig.username), pageToken: p.token })
    }
    if (!accounts.length) {
      return {
        ok: false,
        error: 'No Instagram professional account is linked to a Facebook Page on this login.',
      }
    }
    const chosen = accounts.find((a) => a.id === settings.igUserId) ?? accounts[0]
    return {
      ok: true,
      account: {
        accountLabel: chosen.username ? `@${chosen.username}` : chosen.id,
        accountId: chosen.id,
        capabilities: ['publish_social'],
        settings: {
          igUserId: chosen.id,
          accountOptions: JSON.stringify(
            accounts.map((a) => ({ id: a.id, name: `@${a.username}` })),
          ),
        },
        credentials: { ...credentials, igUserId: chosen.id, pageToken: chosen.pageToken },
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    if (!m.imageUrl) return { ok: false, retryable: false, error: 'Instagram posts need an image.' }
    const ig = str(credentials.igUserId) || connection.accountId || ''
    const token = str(credentials.pageToken)
    const caption = m.linkUrl ? `${m.text}\n\n${m.linkUrl}` : m.text
    const created = await call(ctx.fetch, `${GRAPH}/${ig}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ image_url: m.imageUrl, caption, access_token: token }),
    })
    // Nothing is public until the second step, so a failure here is safe to retry.
    if (created.network)
      return {
        ok: false,
        retryable: true,
        error: `Instagram: could not prepare the post (${created.error}).`,
      }
    if (!created.res.ok || !str(created.body.id))
      return metaFailure('Instagram', created.res.status, created.body)
    const published = await call(ctx.fetch, `${GRAPH}/${ig}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ creation_id: str(created.body.id), access_token: token }),
    })
    if (published.network) return failure('Instagram', published, false)
    if (!published.res.ok || !str(published.body.id))
      return metaFailure('Instagram', published.res.status, published.body)
    const mediaId = str(published.body.id)
    const link = await call(
      ctx.fetch,
      `${GRAPH}/${mediaId}?${form({ fields: 'permalink', access_token: token })}`,
      {},
    )
    const permalink =
      !link.network && /^https:\/\//.test(str(link.body.permalink))
        ? str(link.body.permalink)
        : null
    return {
      ok: true,
      id: `instagram:${mediaId}`,
      externalUrl: permalink,
      sender: connection.accountLabel,
    }
  },
}

// LinkedIn (posts on the profile of the person who connected) ----------------------------------------
const LINKEDIN_SCOPES = 'openid profile w_member_social'

export const linkedin: Adapter = {
  provider: 'linkedin',
  idempotent: false,
  oauth: {
    app: 'linkedin',
    authorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.linkedin.com/oauth/v2/authorization?${form({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        scope: LINKEDIN_SCOPES,
      })}`,
    async exchange({ code, redirectUri }, ctx) {
      const app = ctx.oauth.linkedin
      if (!app) throw new Error('LinkedIn sign-in is not set up on the server.')
      const r = await call(ctx.fetch, 'https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        }),
      })
      if (r.network || !r.res.ok || !str(r.body.access_token)) {
        throw new Error('LinkedIn did not accept the sign-in. Try connecting again.')
      }
      const scopes = str(r.body.scope)
        .split(/[\s,]+/)
        .filter(Boolean)
      const seconds = typeof r.body.expires_in === 'number' ? r.body.expires_in : 0
      return {
        credentials: {
          accessToken: str(r.body.access_token),
          // LinkedIn tokens last about 60 days and cannot be renewed: then it asks to connect again.
          expiresAt: seconds ? ctx.now() + seconds * 1000 : undefined,
          scopes,
        },
        scopes,
      }
    },
  },
  async revoke(credentials, ctx) {
    const app = ctx.oauth.linkedin
    if (!app || !str(credentials.accessToken)) return
    await call(ctx.fetch, 'https://www.linkedin.com/oauth/v2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        token: str(credentials.accessToken),
      }),
    })
  },
  async verify(credentials, _settings, ctx) {
    if (!granted(credentials, 'w_member_social')) {
      return {
        ok: false,
        error: 'Permission to post on LinkedIn (w_member_social) was not granted.',
      }
    }
    const r = await call(ctx.fetch, 'https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${str(credentials.accessToken)}` },
    })
    if (r.network) return { ok: false, error: `Could not reach LinkedIn: ${r.error}` }
    if (!r.res.ok || !str(r.body.sub))
      return { ok: false, error: 'LinkedIn did not confirm the account. Connect again.' }
    return {
      ok: true,
      account: {
        accountLabel: str(r.body.name) || 'LinkedIn member',
        accountId: str(r.body.sub),
        capabilities: ['publish_social'],
      },
    }
  },
  async send(m, credentials, connection, ctx) {
    const author = `urn:li:person:${connection.accountId ?? ''}`
    const share: Record<string, unknown> = {
      shareCommentary: { text: m.text },
      shareMediaCategory: m.linkUrl ? 'ARTICLE' : 'NONE',
      ...(m.linkUrl ? { media: [{ status: 'READY', originalUrl: m.linkUrl }] } : {}),
    }
    const r = await call(ctx.fetch, 'https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${str(credentials.accessToken)}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': share },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
    if (r.network) return failure('LinkedIn', r, false)
    const urn = r.res.headers.get('x-restli-id') ?? str(r.body.id)
    if (r.res.ok && urn) {
      return {
        ok: true,
        id: `linkedin:${urn}`,
        externalUrl: `https://www.linkedin.com/feed/update/${urn}`,
        sender: connection.accountLabel,
      }
    }
    return failure(
      'LinkedIn',
      {
        status: r.res.status,
        code: str(r.body.serviceErrorCode) || undefined,
        message: str(r.body.message) || r.res.statusText,
      },
      false,
    )
  },
}
