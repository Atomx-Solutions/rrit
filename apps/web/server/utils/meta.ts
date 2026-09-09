import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { setTenantContext, withUserTransaction } from './database'

export interface MetaPage {
  id: string
  name: string
  access_token: string
  tasks?: string[]
  instagram_business_account?: { id: string; username?: string }
}
export interface MetaList<T> {
  data: T[]
  paging?: { cursors?: { after?: string }; next?: string }
}
export type MetaFailureCategory =
  | 'authentication'
  | 'media'
  | 'network'
  | 'permission'
  | 'rate_limit'
  | 'server'
  | 'rejection'

export class MetaFailure extends Error {
  constructor(
    public code: number,
    public retryable: boolean,
    message = 'Meta nuk e përfundoi kërkesën. Provo sërish ose rilidh llogarinë.',
    public details: {
      category?: MetaFailureCategory
      httpStatus?: number
      retryAfterSeconds?: number
      safeToRetry?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'MetaFailure'
  }

  get category(): MetaFailureCategory {
    return this.details.category ?? 'rejection'
  }

  get retryAfterSeconds() {
    return this.details.retryAfterSeconds
  }

  get safeToRetry() {
    return this.retryable && this.details.safeToRetry === true
  }
}

export function metaFailureCategory(
  httpStatus: number,
  code: number,
  subcode = 0,
): MetaFailureCategory {
  if (httpStatus === 429 || [4, 17, 32, 613].includes(code)) return 'rate_limit'
  if ([102, 190].includes(code)) return 'authentication'
  if ([10, 200, 299].includes(code)) return 'permission'
  if (
    (code >= 36000 && code <= 36999) ||
    (subcode >= 2207000 && subcode <= 2207999)
  )
    return 'media'
  if (httpStatus >= 500) return 'server'
  return 'rejection'
}

export function parseRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return undefined
  const seconds = Number(value)
  const parsed = Number.isFinite(seconds) ? seconds : (Date.parse(value) - now) / 1000
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(Math.ceil(parsed), 3600)
}
export function metaConfiguration() {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const configId = process.env.META_LOGIN_CONFIG_ID
  const redirectUri = process.env.META_REDIRECT_URI
  const version = process.env.META_GRAPH_VERSION
  const key = process.env.META_TOKEN_KEY
  if (!appId || !appSecret || !configId || !redirectUri || !version || !key)
    throw createError({
      statusCode: 503,
      message: 'Lidhja me Meta ende nuk është konfiguruar nga platforma.',
    })
  const redirect = new URL(redirectUri)
  if (
    redirect.protocol !== 'https:' ||
    redirect.origin !== new URL(process.env.APP_URL!).origin ||
    !/^v\d+\.0$/.test(version) ||
    Buffer.from(key, 'base64').length !== 32
  )
    throw createError({ statusCode: 503, message: 'Konfigurimi i Meta-s nuk është i vlefshëm.' })
  return { appId, appSecret, configId, redirectUri, version, key: Buffer.from(key, 'base64') }
}
export function metaConfigured() {
  try {
    metaConfiguration()
    return true
  } catch {
    return false
  }
}
export const hashState = (value: string) => createHash('sha256').update(value).digest('hex')
export function encryptMetaToken(token: string, businessId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', metaConfiguration().key, iv)
  cipher.setAAD(Buffer.from(businessId))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString('base64url')).join('.')
}
export function decryptMetaToken(envelope: string, businessId: string) {
  const [iv, tag, ciphertext] = envelope.split('.').map((value) => Buffer.from(value, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new MetaFailure(190, false)
  const decipher = createDecipheriv('aes-256-gcm', metaConfiguration().key, iv)
  decipher.setAAD(Buffer.from(businessId))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
// No caller-supplied hostname and no tokens in application responses or logs.
export async function graphRequest<T>(
  path: string,
  token: string,
  parameters: Record<string, string> = {},
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<T> {
  const config = metaConfiguration()
  if (!/^[a-zA-Z0-9_/-]+$/.test(path)) throw new Error('Invalid Graph path')
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`)
  const params = new URLSearchParams({
    ...parameters,
    appsecret_proof: createHmac('sha256', config.appSecret).update(token).digest('hex'),
  })
  if (method === 'GET') url.search = params.toString()
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: method === 'GET' ? undefined : params,
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
  } catch {
    throw new MetaFailure(
      0,
      true,
      'Lidhja me Meta nuk u konfirmua. Kontrollo gjendjen përpara se të provosh sërish.',
      { category: 'network', safeToRetry: method === 'GET' },
    )
  }
  let raw: string
  try {
    raw = await response.text()
  } catch {
    throw new MetaFailure(
      0,
      true,
      'Lidhja me Meta nuk u konfirmua. Kontrollo gjendjen përpara se të provosh sërish.',
      { category: 'network', httpStatus: response.status, safeToRetry: method === 'GET' },
    )
  }
  let result: T & {
    error?: { code?: number; error_subcode?: number; is_transient?: boolean }
  }
  try {
    result = (raw ? JSON.parse(raw) : {}) as typeof result
  } catch {
    throw new MetaFailure(
      response.status,
      true,
      undefined,
      {
        category: response.status >= 500 ? 'server' : 'rejection',
        httpStatus: response.status,
        safeToRetry: method === 'GET',
      },
    )
  }
  if (!response.ok || result.error) {
    const code = result.error?.code || response.status
    const category = metaFailureCategory(
      response.status,
      code,
      result.error?.error_subcode,
    )
    const retryable =
      !!result.error?.is_transient ||
      category === 'rate_limit' ||
      category === 'server'
    throw new MetaFailure(
      code,
      retryable,
      undefined,
      {
        category,
        httpStatus: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
        // A GET is side-effect free. A rate-limit response is an explicit rejection.
        // Other failed publication writes are reconciled instead of being repeated.
        safeToRetry: method === 'GET' || category === 'rate_limit',
      },
    )
  }
  return result
}
export async function exchangeMetaCode(code: string) {
  const config = metaConfiguration()
  async function exchange(parameters: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`)
    url.search = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      ...parameters,
    }).toString()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' })
      const result = (await response.json()) as { access_token?: string; expires_in?: number }
      if (!response.ok || !result.access_token) throw new Error('Token exchange failed')
      return { token: result.access_token, seconds: result.expires_in || 0 }
    } catch {
      throw new MetaFailure(190, false, 'Autorizimi nuk u përfundua. Nise lidhjen edhe një herë.')
    }
  }
  const short = await exchange({ code, redirect_uri: config.redirectUri })
  const long = await exchange({ grant_type: 'fb_exchange_token', fb_exchange_token: short.token })
  const debug = await graphRequest<{
    data: {
      app_id: string
      user_id: string
      is_valid: boolean
      expires_at: number
      data_access_expires_at?: number
      scopes?: string[]
    }
  }>('debug_token', `${config.appId}|${config.appSecret}`, { input_token: long.token })
  if (
    !debug.data.is_valid ||
    debug.data.app_id !== config.appId ||
    !debug.data.user_id ||
    debug.data.expires_at * 1000 <= Date.now()
  )
    throw new MetaFailure(190, false)
  return {
    token: long.token,
    userId: debug.data.user_id,
    expiresAt: new Date(
      Math.min(debug.data.expires_at, debug.data.data_access_expires_at || debug.data.expires_at) *
        1000,
    ),
    scopes: debug.data.scopes || [],
  }
}
export async function businessForUser(userId: string, db: Pool | PoolClient = database()) {
  const result = await db.query('SELECT id, slug FROM businesses WHERE owner_id = $1', [
    userId,
  ])
  if (!result.rows[0])
    throw createError({ statusCode: 404, message: 'Plotëso fillimisht profilin e biznesit.' })
  return result.rows[0] as { id: string; slug: string }
}
export async function connectedMeta(businessId: string, db: Pool | PoolClient = database()) {
  const result = await db.query(
    "SELECT * FROM meta_connections WHERE business_id = $1 AND status = 'connected' AND expires_at > now()",
    [businessId],
  )
  if (!result.rows[0])
    throw createError({ statusCode: 409, message: 'Lidh ose rinovo llogarinë e rrjetit social.' })
  return result.rows[0] as {
    id: string
    page_id: string
    page_name: string
    page_token_ciphertext: string
    instagram_id: string | null
    instagram_username: string | null
    scopes: string[]
    expires_at: Date
  }
}

export async function withBusinessTransaction<T>(
  userId: string,
  work: (client: PoolClient, business: { id: string; slug: string }) => Promise<T>,
) {
  return withUserTransaction(userId, async (client) => {
    const business = await businessForUser(userId, client)
    await setTenantContext(client, { userId, organizationId: business.id })
    return work(client, business)
  })
}
