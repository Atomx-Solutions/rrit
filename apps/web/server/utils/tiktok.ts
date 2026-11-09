import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { MetaFailure } from './meta'

const authorizeUrl = 'https://www.tiktok.com/v2/auth/authorize/'
const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/'
const inboxVideoInitUrl = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
const contentInitUrl = 'https://open.tiktokapis.com/v2/post/publish/content/init/'
const videoListUrl = 'https://open.tiktokapis.com/v2/video/list/'
const creatorInfoUrl = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/'
const directVideoInitUrl = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
const publishStatusUrl = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'
// video.publish lets a scheduled post go out directly; video.upload keeps the
// draft hand-over available.
export const tiktokScopes = ['user.info.basic', 'video.upload', 'video.publish', 'video.list']
export const tiktokDirectPostScope = 'video.publish'

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
  url.search = new URLSearchParams({ client_key: config.clientKey, redirect_uri: config.redirectUri, response_type: 'code', scope: tiktokScopes.join(','), state }).toString()
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

export async function refreshTikTokToken(refreshToken: string) {
  const config = tiktokConfiguration()
  const body = new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken })
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000), redirect: 'error' })
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number }
  if (!response.ok || !data.access_token || !data.refresh_token)
    throw new MetaFailure(190, false, undefined, { category: 'authentication', httpStatus: response.status })
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000), refreshExpiresAt: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000) : null }
}

// An access token lasts a day, so a post scheduled for later is published
// with a token renewed from the refresh token shortly before it expires.
export function tiktokTokenNeedsRefresh(expiresAt: Date, now = Date.now()) {
  return expiresAt.getTime() - now < 60 * 60 * 1000
}

type TikTokConnectionRow = {
  id: string
  open_id: string
  access_token_ciphertext: string
  refresh_token_ciphertext: string
  expires_at: Date
  refresh_expires_at: Date | null
  scopes: string[]
}

/** The connected account with a usable access token, renewed when it is about to expire. */
export async function connectedTikTok(businessId: string, db: Pool | PoolClient = database()) {
  const result = await db.query<TikTokConnectionRow>(
    "SELECT id,open_id,access_token_ciphertext,refresh_token_ciphertext,expires_at,refresh_expires_at,scopes FROM tiktok_connections WHERE business_id=$1 AND status='connected'",
    [businessId],
  )
  const row = result.rows[0]
  if (!row) return null
  if (!tiktokTokenNeedsRefresh(row.expires_at))
    return { ...row, token: decryptTikTokToken(row.access_token_ciphertext, businessId) }
  if (row.refresh_expires_at && row.refresh_expires_at.getTime() <= Date.now()) {
    await db.query("UPDATE tiktok_connections SET status='expired',updated_at=now() WHERE id=$1", [row.id])
    return null
  }
  let refreshed: Awaited<ReturnType<typeof refreshTikTokToken>>
  try {
    refreshed = await refreshTikTokToken(decryptTikTokToken(row.refresh_token_ciphertext, businessId))
  } catch {
    // The current token still serves until it expires; afterwards renewal is required.
    if (row.expires_at.getTime() > Date.now()) return { ...row, token: decryptTikTokToken(row.access_token_ciphertext, businessId) }
    await db.query("UPDATE tiktok_connections SET status='expired',updated_at=now() WHERE id=$1", [row.id])
    return null
  }
  await db.query(
    'UPDATE tiktok_connections SET access_token_ciphertext=$1,refresh_token_ciphertext=$2,expires_at=$3,refresh_expires_at=COALESCE($4,refresh_expires_at),updated_at=now() WHERE id=$5',
    [encryptTikTokToken(refreshed.accessToken, businessId), encryptTikTokToken(refreshed.refreshToken, businessId), refreshed.expiresAt, refreshed.refreshExpiresAt, row.id],
  )
  return { ...row, expires_at: refreshed.expiresAt, token: refreshed.accessToken }
}

// TikTok reports failures as a string code in an error object, also on a 200.
async function tiktokRequest<T>(url: string, accessToken: string, body?: unknown, safeToRetry = false): Promise<T> {
  let response: Response
  let data: { data?: T; error?: { code?: string; message?: string } }
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
    data = await response.json() as typeof data
  } catch {
    throw new MetaFailure(0, true, undefined, { category: 'network', safeToRetry })
  }
  const code = data.error?.code
  if (response.ok && (!code || code === 'ok') && data.data) return data.data
  const category =
    response.status === 429 || code === 'rate_limit_exceeded' || code === 'spam_risk_too_many_posts'
      ? 'rate_limit'
      : code === 'access_token_invalid' || response.status === 401
        ? 'authentication'
        : code === 'scope_not_authorized' || code === 'scope_permission_missed' || code === 'unaudited_client_can_only_post_to_private_accounts'
          ? 'permission'
          : response.status >= 500
            ? 'server'
            : 'rejection'
  console.error('[tiktok] request rejected:', url, response.status, code)
  throw new MetaFailure(category === 'authentication' ? 190 : response.status, category === 'rate_limit' || category === 'server', undefined, {
    category,
    httpStatus: response.status,
    safeToRetry: safeToRetry || category === 'rate_limit',
  })
}

export type TikTokCreatorInfo = {
  creator_nickname: string
  creator_username: string
  creator_avatar_url?: string
  privacy_level_options: string[]
  comment_disabled: boolean
  duet_disabled: boolean
  stitch_disabled: boolean
  max_video_post_duration_sec: number
}

export function tiktokCreatorInfo(accessToken: string) {
  return tiktokRequest<TikTokCreatorInfo>(creatorInfoUrl, accessToken, undefined, true)
}

// How the account holder chose TikTok shows this post.
export type TikTokPostSettings = {
  privacyLevel: string
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandOrganic: boolean
  brandedContent: boolean
}

/** The reason TikTok would refuse these settings for this account, if any. */
export function tiktokSettingsProblem(
  settings: TikTokPostSettings,
  creator: TikTokCreatorInfo,
  // A video's length, which may not exceed what this account may post.
  videoSeconds?: number,
) {
  if (!creator.privacy_level_options.includes(settings.privacyLevel)) return 'server.TIKTOK_PRIVACY_UNAVAILABLE'
  if (videoSeconds !== undefined && videoSeconds > creator.max_video_post_duration_sec)
    return 'server.TIKTOK_VIDEO_TOO_LONG'
  // TikTok does not allow branded content to be visible only to its creator.
  if (settings.brandedContent && settings.privacyLevel === 'SELF_ONLY') return 'server.TIKTOK_BRANDED_CONTENT_PRIVATE'
  if (
    (creator.comment_disabled && !settings.disableComment) ||
    (creator.duet_disabled && !settings.disableDuet) ||
    (creator.stitch_disabled && !settings.disableStitch)
  )
    return 'server.TIKTOK_INTERACTION_UNAVAILABLE'
  return null
}

function postInfo(settings: TikTokPostSettings, title: string) {
  return {
    title: Array.from(title).slice(0, 2200).join(''),
    privacy_level: settings.privacyLevel,
    disable_comment: settings.disableComment,
    brand_organic_toggle: settings.brandOrganic,
    brand_content_toggle: settings.brandedContent,
  }
}

/** Publishes a video directly to the account; TikTok processes it after the upload. */
export async function publishTikTokVideo(
  accessToken: string,
  video: Buffer,
  caption: string,
  settings: TikTokPostSettings,
  contentType = 'video/mp4',
) {
  if (video.length > 50 * 1024 * 1024)
    throw createError({ statusCode: 400, message: 'server.VIDEO_SIZE_EXCEEDED' })
  const initialized = await tiktokRequest<{ publish_id?: string; upload_url?: string }>(directVideoInitUrl, accessToken, {
    post_info: { ...postInfo(settings, caption), disable_duet: settings.disableDuet, disable_stitch: settings.disableStitch },
    source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 },
  })
  if (!initialized.publish_id || !initialized.upload_url) throw new Error('missing_container')
  const uploaded = await fetch(initialized.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(video.length), 'Content-Range': `bytes 0-${video.length - 1}/${video.length}` },
    body: new Uint8Array(video).buffer,
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  })
  if (!uploaded.ok) throw new Error('tiktok_upload_failed')
  return initialized.publish_id
}

/** Publishes a photo directly to the account; TikTok pulls it from a verified URL. */
export async function publishTikTokPhoto(
  accessToken: string,
  input: { photoUrl: string; title: string; caption: string },
  settings: TikTokPostSettings,
) {
  const initialized = await tiktokRequest<{ publish_id?: string }>(contentInitUrl, accessToken, {
    media_type: 'PHOTO',
    post_mode: 'DIRECT_POST',
    post_info: {
      ...postInfo(settings, input.title),
      title: Array.from(input.title).slice(0, 90).join(''),
      description: Array.from(input.caption).slice(0, 4000).join(''),
      auto_add_music: true,
    },
    source_info: { source: 'PULL_FROM_URL', photo_images: [input.photoUrl], photo_cover_index: 0 },
  })
  if (!initialized.publish_id) throw new Error('missing_container')
  return initialized.publish_id
}

export type TikTokPublishStatus = {
  status: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED'
  fail_reason?: string
  // Spelled as TikTok spells it.
  publicaly_available_post_id?: (string | number)[]
}

export function tiktokPublishStatus(accessToken: string, publishId: string) {
  return tiktokRequest<TikTokPublishStatus>(publishStatusUrl, accessToken, { publish_id: publishId }, true)
}
