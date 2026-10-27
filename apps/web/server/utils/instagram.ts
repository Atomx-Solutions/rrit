import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { connectedMeta, decryptMetaToken, graphRequest, MetaFailure, metaFailureCategory, type GraphHost } from './meta'

// Instagram Login (Instagram API with Instagram Login). The account is a
// professional Instagram account authorized on instagram.com, with no
// Facebook page in between.
const authorizeUrl = 'https://www.instagram.com/oauth/authorize'
const shortTokenUrl = 'https://api.instagram.com/oauth/access_token'
const longTokenUrl = 'https://graph.instagram.com/access_token'
const refreshTokenUrl = 'https://graph.instagram.com/refresh_access_token'
export const instagramScopes = ['instagram_business_basic', 'instagram_business_content_publish']
export const instagramPublishScope = 'instagram_business_content_publish'
// Long-lived tokens last 60 days and can be refreshed once they are a day old.
const refreshWithinMs = 10 * 24 * 60 * 60 * 1000
const refreshAfterMs = 24 * 60 * 60 * 1000

export const hashInstagramState = (value: string) => createHash('sha256').update(value).digest('hex')

export function instagramConfiguration() {
  const appId = process.env.INSTAGRAM_APP_ID
  const appSecret = process.env.INSTAGRAM_APP_SECRET
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI
  const version = process.env.META_GRAPH_VERSION
  const key = process.env.META_TOKEN_KEY
  if (!appId || !appSecret || !redirectUri || !version || !key)
    throw createError({ statusCode: 503, message: 'server.INSTAGRAM_NOT_CONFIGURED' })
  const redirect = new URL(redirectUri)
  if (
    redirect.protocol !== 'https:' ||
    redirect.origin !== new URL(process.env.APP_URL!).origin ||
    !/^v\d+\.0$/.test(version) ||
    Buffer.from(key, 'base64').length !== 32
  )
    throw createError({ statusCode: 503, message: 'server.INSTAGRAM_CONFIG_INVALID' })
  return { appId, appSecret, redirectUri, version, key: Buffer.from(key, 'base64') }
}

export function instagramConfigured() {
  try {
    instagramConfiguration()
    return true
  } catch {
    return false
  }
}

// The additional data binds a ciphertext to its business and to this provider,
// so a Meta page token envelope can never be decrypted as an Instagram token.
const additionalData = (businessId: string) => Buffer.from(`instagram:${businessId}`)

export function encryptInstagramToken(token: string, businessId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', instagramConfiguration().key, iv)
  cipher.setAAD(additionalData(businessId))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptInstagramToken(envelope: string, businessId: string) {
  const [iv, tag, ciphertext] = envelope.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new MetaFailure(190, false)
  const decipher = createDecipheriv('aes-256-gcm', instagramConfiguration().key, iv)
  decipher.setAAD(additionalData(businessId))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function instagramAuthorizeUrl(state: string) {
  const config = instagramConfiguration()
  const url = new URL(authorizeUrl)
  url.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: instagramScopes.join(','),
    state,
  }).toString()
  return url.toString()
}

type TokenResponse = {
  access_token?: string
  user_id?: string | number
  expires_in?: number
  permissions?: string | string[]
  data?: { access_token?: string; user_id?: string | number; permissions?: string | string[] }[]
  error?: { code?: number; error_subcode?: number; message?: string } | string
  error_type?: string
  code?: number
}

async function tokenRequest(url: URL, init?: RequestInit) {
  let response: Response
  let result: TokenResponse
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' })
    result = (await response.json()) as TokenResponse
  } catch {
    throw new MetaFailure(190, false, 'Autorizimi nuk u përfundua. Nise lidhjen edhe një herë.')
  }
  // The short-lived exchange may wrap its result in a data array.
  const payload = result.data?.[0] || result
  if (!response.ok || !payload.access_token) {
    const error = typeof result.error === 'object' ? result.error : undefined
    const code = error?.code || result.code || response.status
    throw new MetaFailure(code, false, undefined, {
      category: metaFailureCategory(response.status, code, error?.error_subcode),
      httpStatus: response.status,
    })
  }
  return { ...payload, expires_in: result.expires_in }
}

const scopeList = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : (value || '').split(',')).map((scope) => scope.trim()).filter(Boolean)

export async function exchangeInstagramCode(code: string) {
  const config = instagramConfiguration()
  const short = await tokenRequest(new URL(shortTokenUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code,
    }),
  })
  const longUrl = new URL(longTokenUrl)
  longUrl.search = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: config.appSecret,
    access_token: short.access_token!,
  }).toString()
  const long = await tokenRequest(longUrl)
  if (!long.expires_in) throw new MetaFailure(190, false)
  // user_id is the professional account id the publishing and media endpoints take.
  // id is app-scoped and identifies the person in deauthorization requests.
  const profile = await graphRequest<{ id?: string; user_id?: string | number; username?: string }>(
    'me',
    long.access_token!,
    { fields: 'id,user_id,username' },
    'GET',
    'instagram',
  )
  if (!profile.user_id) throw new MetaFailure(190, false)
  return {
    token: long.access_token!,
    userId: String(profile.user_id),
    scopedId: profile.id || null,
    username: profile.username || null,
    expiresAt: new Date(Date.now() + long.expires_in * 1000),
    scopes: scopeList(short.permissions),
  }
}

export async function refreshInstagramToken(token: string) {
  const url = new URL(refreshTokenUrl)
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }).toString()
  const refreshed = await tokenRequest(url)
  if (!refreshed.expires_in) throw new MetaFailure(190, false)
  return { token: refreshed.access_token!, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000) }
}

export function instagramTokenNeedsRefresh(expiresAt: Date, updatedAt: Date, now = Date.now()) {
  return expiresAt.getTime() - now < refreshWithinMs && now - updatedAt.getTime() > refreshAfterMs
}

type InstagramConnectionRow = {
  id: string
  instagram_user_id: string
  username: string | null
  token_ciphertext: string
  expires_at: Date
  updated_at: Date
  scopes: string[]
}

export async function connectedInstagram(businessId: string, db: Pool | PoolClient = database()) {
  const result = await db.query<InstagramConnectionRow>(
    "SELECT id,instagram_user_id,username,token_ciphertext,expires_at,updated_at,scopes FROM instagram_connections WHERE business_id=$1 AND status='connected' AND expires_at>now()",
    [businessId],
  )
  const row = result.rows[0]
  if (!row) return null
  let token = decryptInstagramToken(row.token_ciphertext, businessId)
  if (instagramTokenNeedsRefresh(row.expires_at, row.updated_at)) {
    try {
      const refreshed = await refreshInstagramToken(token)
      await db.query(
        'UPDATE instagram_connections SET token_ciphertext=$1,expires_at=$2,updated_at=now() WHERE id=$3',
        [encryptInstagramToken(refreshed.token, businessId), refreshed.expiresAt, row.id],
      )
      token = refreshed.token
    } catch {
      /* The current token stays valid until it expires; the next use retries the refresh. */
    }
  }
  return { ...row, token }
}

// The Instagram account a post is published to and read from: the account
// connected directly through Instagram Login, otherwise the one linked to the
// connected Facebook page.
export type InstagramTarget = {
  source: 'instagram' | 'page'
  id: string
  username: string | null
  token: string
  host: GraphHost
  canPublish: boolean
  connectionId: string
  pageId: string | null
  brandId: string | null
}

export async function instagramTarget(
  businessId: string,
  db: Pool | PoolClient = database(),
): Promise<InstagramTarget | null> {
  const direct = await connectedInstagram(businessId, db)
  if (direct)
    return {
      source: 'instagram',
      id: direct.instagram_user_id,
      username: direct.username,
      token: direct.token,
      host: 'instagram',
      canPublish: direct.scopes.includes(instagramPublishScope),
      connectionId: direct.id,
      pageId: null,
      brandId: await businessBrand(businessId, db),
    }
  let page: Awaited<ReturnType<typeof connectedMeta>>
  try {
    page = await connectedMeta(businessId, db)
  } catch {
    return null
  }
  if (!page.instagram_id) return null
  return {
    source: 'page',
    id: page.instagram_id,
    username: page.instagram_username,
    token: decryptMetaToken(page.page_token_ciphertext, businessId),
    host: 'facebook',
    canPublish: page.scopes.includes('instagram_content_publish'),
    connectionId: page.id,
    pageId: page.page_id,
    brandId: page.brand_id,
  }
}

// Social posts are attributed to the organization's first brand, as a page
// connection is when it is created.
async function businessBrand(businessId: string, db: Pool | PoolClient) {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM brands WHERE organization_id=$1 ORDER BY created_at,id LIMIT 1',
    [businessId],
  )
  return result.rows[0]?.id || null
}

export async function markInstagramTargetExpired(target: InstagramTarget, db: Pool | PoolClient) {
  await db.query(
    target.source === 'instagram'
      ? "UPDATE instagram_connections SET status='expired',updated_at=now() WHERE id=$1"
      : "UPDATE meta_connections SET status='expired',updated_at=now() WHERE id=$1",
    [target.connectionId],
  )
}

export async function markInstagramTargetSynced(target: InstagramTarget, db: Pool | PoolClient) {
  await db.query(
    target.source === 'instagram'
      ? 'UPDATE instagram_connections SET last_sync_at=now() WHERE id=$1'
      : 'UPDATE meta_connections SET last_sync_at=now(),updated_at=now() WHERE id=$1',
    [target.connectionId],
  )
}
