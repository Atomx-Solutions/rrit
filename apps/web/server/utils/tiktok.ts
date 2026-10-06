import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const authorizeUrl = 'https://www.tiktok.com/v2/auth/authorize/'
const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/'
const inboxVideoInitUrl = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'

export const hashTikTokState = (value: string) => createHash('sha256').update(value).digest('hex')

export function tiktokConfiguration() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  const key = process.env.TIKTOK_TOKEN_KEY
  if (!clientKey || !clientSecret || !redirectUri || !key)
    throw createError({ statusCode: 503, message: 'Lidhja me TikTok ende nuk është konfiguruar.' })
  const redirect = new URL(redirectUri)
  if (redirect.protocol !== 'https:' || redirect.origin !== new URL(process.env.APP_URL!).origin || Buffer.from(key, 'base64').length !== 32)
    throw createError({ statusCode: 503, message: 'Konfigurimi i TikTok nuk është i vlefshëm.' })
  return { clientKey, clientSecret, redirectUri, key: Buffer.from(key, 'base64') }
}

export function tiktokConfigured() {
  try { tiktokConfiguration(); return true } catch { return false }
}

export function encryptTikTokToken(token: string, businessId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tiktokConfiguration().key, iv)
  cipher.setAAD(Buffer.from(businessId))
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptTikTokToken(envelope: string, businessId: string) {
  const [iv, tag, ciphertext] = envelope.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw createError({ statusCode: 409, message: 'Lidhja me TikTok duhet rinovuar.' })
  const decipher = createDecipheriv('aes-256-gcm', tiktokConfiguration().key, iv)
  decipher.setAAD(Buffer.from(businessId)); decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function tiktokAuthorizeUrl(state: string) {
  const config = tiktokConfiguration()
  const url = new URL(authorizeUrl)
  url.search = new URLSearchParams({ client_key: config.clientKey, redirect_uri: config.redirectUri, response_type: 'code', scope: 'user.info.basic,video.upload', state }).toString()
  return url.toString()
}

export async function exchangeTikTokCode(code: string) {
  const config = tiktokConfiguration()
  const body = new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: config.redirectUri })
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000), redirect: 'error' })
  const data = await response.json() as { access_token?: string; refresh_token?: string; open_id?: string; expires_in?: number; refresh_expires_in?: number; scope?: string; error?: { message?: string } }
  if (!response.ok || !data.access_token || !data.refresh_token || !data.open_id)
    throw createError({ statusCode: 502, message: 'TikTok nuk e përfundoi autorizimin. Provo përsëri.' })
  return { accessToken: data.access_token, refreshToken: data.refresh_token, openId: data.open_id, expiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000), refreshExpiresAt: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000) : null, scopes: (data.scope || '').split(',').filter(Boolean) }
}

export async function uploadTikTokDraft(accessToken: string, video: Buffer, contentType = 'video/mp4') {
  if (video.length > 50 * 1024 * 1024)
    throw createError({ statusCode: 400, message: 'Videoja nuk mund të kalojë 50 MB.' })
  const init = await fetch(inboxVideoInitUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 } }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  const initialized = await init.json() as { data?: { publish_id?: string; upload_url?: string } }
  if (!init.ok || !initialized.data?.publish_id || !initialized.data.upload_url)
    throw createError({ statusCode: 502, message: 'TikTok nuk e pranoi upload-in. Provo përsëri.' })
  const uploaded = await fetch(initialized.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(video.length), 'Content-Range': `bytes 0-${video.length - 1}/${video.length}` },
    body: new Uint8Array(video).buffer,
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  })
  if (!uploaded.ok) throw createError({ statusCode: 502, message: 'Videoja nuk u dërgua te TikTok. Provo përsëri.' })
  return { publishId: initialized.data.publish_id }
}
