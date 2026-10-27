import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const authorizeUrl = 'https://www.tiktok.com/v2/auth/authorize/'
const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/'
const inboxVideoInitUrl = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
const contentInitUrl = 'https://open.tiktokapis.com/v2/post/publish/content/init/'
const videoListUrl = 'https://open.tiktokapis.com/v2/video/list/'

export const hashTikTokState = (value: string) => createHash('sha256').update(value).digest('hex')

export function tiktokConfiguration() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  const key = process.env.TIKTOK_TOKEN_KEY
  if (!clientKey || !clientSecret || !redirectUri || !key)
    throw createError({ statusCode: 503, message: 'server.TIKTOK_NOT_CONFIGURED' })
  const redirect = new URL(redirectUri)
  if (redirect.protocol !== 'https:' || redirect.origin !== new URL(process.env.APP_URL!).origin || Buffer.from(key, 'base64').length !== 32)
    throw createError({ statusCode: 503, message: 'server.TIKTOK_CONFIG_INVALID' })
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
  if (!iv || !tag || !ciphertext) throw createError({ statusCode: 409, message: 'server.TIKTOK_RENEWAL_REQUIRED' })
  const decipher = createDecipheriv('aes-256-gcm', tiktokConfiguration().key, iv)
  decipher.setAAD(Buffer.from(businessId)); decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function tiktokAuthorizeUrl(state: string) {
  const config = tiktokConfiguration()
  const url = new URL(authorizeUrl)
  url.search = new URLSearchParams({ client_key: config.clientKey, redirect_uri: config.redirectUri, response_type: 'code', scope: 'user.info.basic,video.upload,video.list', state }).toString()
  return url.toString()
}

export async function exchangeTikTokCode(code: string) {
  const config = tiktokConfiguration()
  const body = new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: config.redirectUri })
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000), redirect: 'error' })
  const data = await response.json() as { access_token?: string; refresh_token?: string; open_id?: string; expires_in?: number; refresh_expires_in?: number; scope?: string; error?: { message?: string } }
  if (!response.ok || !data.access_token || !data.refresh_token || !data.open_id)
    throw createError({ statusCode: 502, message: 'server.TIKTOK_AUTH_INCOMPLETE' })
  return { accessToken: data.access_token, refreshToken: data.refresh_token, openId: data.open_id, expiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000), refreshExpiresAt: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000) : null, scopes: (data.scope || '').split(',').filter(Boolean) }
}

export async function uploadTikTokDraft(accessToken: string, video: Buffer, contentType = 'video/mp4') {
  if (video.length > 50 * 1024 * 1024)
    throw createError({ statusCode: 400, message: 'server.VIDEO_SIZE_EXCEEDED' })
  const init = await fetch(inboxVideoInitUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 } }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  const initialized = await init.json() as { data?: { publish_id?: string; upload_url?: string }; error?: { code: string; message: string } }
  console.log('[tiktok-upload] init response:', init.status, JSON.stringify(initialized))
  if (!init.ok || !initialized.data?.publish_id || !initialized.data.upload_url)
    throw createError({ statusCode: 502, message: 'server.TIKTOK_UPLOAD_REJECTED' })
  const uploaded = await fetch(initialized.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(video.length), 'Content-Range': `bytes 0-${video.length - 1}/${video.length}` },
    body: new Uint8Array(video).buffer,
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  })
  const uploadBody = await uploaded.text()
  console.log('[tiktok-upload] upload response:', uploaded.status, uploadBody)
  if (!uploaded.ok) throw createError({ statusCode: 502, message: 'server.TIKTOK_SEND_FAILED' })
  return { publishId: initialized.data.publish_id }
}

// TikTok refuses a photo for reasons only the app owner can clear in the
// developer portal: the photo URL prefix is not verified, or the app was not
// granted the upload scope. Those are not failures of this post, so the post
// is handed over for manual publishing instead of failing.
export const tiktokPhotoPermissionErrors = ['url_ownership_unverified', 'scope_not_authorized', 'scope_permission_missed']

export class TikTokPhotoNotPermitted extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

// Sends one photo to the account holder's TikTok inbox as a draft they finish
// and post in the app, the same hand-over a video gets. TikTok accepts photos
// only by pulling them from a URL whose prefix the app has verified.
export async function uploadTikTokPhotoDraft(
  accessToken: string,
  input: { photoUrl: string; title: string; description: string },
) {
  const response = await fetch(contentInitUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      media_type: 'PHOTO',
      post_mode: 'MEDIA_UPLOAD',
      post_info: {
        title: Array.from(input.title).slice(0, 90).join(''),
        description: Array.from(input.description).slice(0, 4000).join(''),
      },
      source_info: { source: 'PULL_FROM_URL', photo_images: [input.photoUrl], photo_cover_index: 0 },
    }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  })
  const data = await response.json().catch(() => ({})) as { data?: { publish_id?: string }; error?: { code?: string; message?: string } }
  const code = data.error?.code
  if (code && tiktokPhotoPermissionErrors.includes(code)) throw new TikTokPhotoNotPermitted(code)
  if (!response.ok || !data.data?.publish_id || (code && code !== 'ok'))
    throw createError({ statusCode: 502, message: 'server.TIKTOK_UPLOAD_REJECTED' })
  return { publishId: data.data.publish_id }
}

export type TikTokVideo = {
  id: string
  title: string
  cover_image_url: string
  share_url: string
  create_time: number
  duration: number
}

export async function listTikTokVideos(accessToken: string, cursor?: number, maxCount = 20) {
  const body: Record<string, unknown> = { max_count: maxCount }
  if (cursor) body.cursor = cursor
  const response = await fetch(`${videoListUrl}?fields=id,title,cover_image_url,share_url,create_time,duration`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  const data = await response.json() as {
    data?: { videos?: TikTokVideo[]; cursor?: number; has_more?: boolean }
    error?: { code: string; message: string }
  }
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    console.error('[tiktok] video list response:', response.status, JSON.stringify(data))
    throw createError({ statusCode: 502, message: 'server.TIKTOK_LIST_FAILED' })
  }
  return {
    videos: data.data?.videos || [],
    cursor: data.data?.cursor,
    hasMore: data.data?.has_more || false,
  }
}
