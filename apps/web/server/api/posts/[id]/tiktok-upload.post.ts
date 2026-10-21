import { z } from 'zod'
import type { PoolClient } from 'pg'
import { postSchema } from '../../../../shared/schemas/workspace'
import { matchesChannelCanvas } from '../../../../shared/schemas/channel-format'
import { downloadAsset } from '../../../utils/asset-storage'
import {
  decryptTikTokToken,
  TikTokPhotoNotPermitted,
  uploadTikTokDraft,
  uploadTikTokPhotoDraft,
} from '../../../utils/tiktok'

// Records how the post was handed to TikTok, so a photo TikTok would not take
// stays visibly ready for manual publishing instead of failing silently.
async function recordDelivery(
  client: PoolClient,
  businessId: string,
  userId: string,
  postId: string,
  delivery: { mode: 'draft' | 'manual'; reason?: string },
) {
  const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, businessId])
  if (!current.rows[0]) return
  const post = postSchema.parse(current.rows[0].payload)
  post.tiktokDelivery = { ...delivery, at: new Date().toISOString() }
  await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), postId, businessId])
  await client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [businessId])
  await client.query(
    "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,$3,'post',$4,'succeeded',revision FROM businesses WHERE id=$1",
    [businessId, userId, delivery.mode === 'draft' ? 'tiktok.draft_sent' : 'tiktok.manual_required', postId],
  )
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [id, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    const connection = await client.query<{ access_token_ciphertext: string; expires_at: Date; scopes: string[] }>(
      "SELECT access_token_ciphertext,expires_at,scopes FROM tiktok_connections WHERE business_id=$1 AND status='connected'",
      [business.id],
    )
    const tiktok = connection.rows[0]
    if (!tiktok || tiktok.expires_at < new Date())
      throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED' })
    if (post.video) {
      const render = await client.query<{ storage_path: string | null; status: string; composed: boolean }>(
        `SELECT r.storage_path,r.status,r.composed
           FROM video_renders r
          WHERE r.post_id=$1 AND r.business_id=$2 ORDER BY r.created_at DESC LIMIT 1`,
        [id, business.id],
      )
      if (!render.rows[0] || render.rows[0].status !== 'ready' || !render.rows[0].storage_path
        || !render.rows[0].composed)
        throw createError({ statusCode: 409, message: 'server.VIDEO_REQUIRED_FOR_TIKTOK' })
      if (!tiktok.scopes.includes('video.upload'))
        throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED' })
      return { kind: 'video' as const, path: render.rows[0].storage_path, token: decryptTikTokToken(tiktok.access_token_ciphertext, business.id) }
    }
    // A photo goes out only on the TikTok canvas it was made for.
    const assetId = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(post.image)?.[1]
    const asset = assetId
      ? (await client.query<{ width: number | null; height: number | null; rights: boolean }>(
          'SELECT width,height,rights FROM assets WHERE id=$1 AND business_id=$2',
          [assetId, business.id],
        )).rows[0]
      : undefined
    if (!asset?.rights)
      throw createError({ statusCode: 409, message: 'server.BUSINESS_PHOTO_RIGHTS_REQUIRED' })
    if (!asset.width || !asset.height || !matchesChannelCanvas('TikTok', { width: asset.width, height: asset.height }))
      throw createError({ statusCode: 409, message: 'server.TIKTOK_PHOTO_FORMAT_REQUIRED' })
    return {
      kind: 'photo' as const,
      image: post.image,
      title: post.title,
      caption: post.caption,
      canUpload: tiktok.scopes.includes('video.upload'),
      token: decryptTikTokToken(tiktok.access_token_ciphertext, business.id),
    }
  })

  if (snapshot.kind === 'photo') {
    let reason: string | undefined = snapshot.canUpload ? undefined : 'scope_not_authorized'
    if (!reason) {
      try {
        const result = await uploadTikTokPhotoDraft(snapshot.token, {
          photoUrl: publicMediaUrl(snapshot.image),
          title: snapshot.title,
          description: snapshot.caption,
        })
        await withBusinessTransaction(user.id, (client, business) =>
          recordDelivery(client, business.id, user.id, id, { mode: 'draft' }))
        return { mode: 'draft' as const, publishId: result.publishId }
      } catch (error) {
        if (!(error instanceof TikTokPhotoNotPermitted)) throw error
        reason = error.code
      }
    }
    await withBusinessTransaction(user.id, (client, business) =>
      recordDelivery(client, business.id, user.id, id, { mode: 'manual', reason }))
    return { mode: 'manual' as const, reason }
  }

  const bytes = await downloadAsset(snapshot.path, 50 * 1024 * 1024)
  const result = await uploadTikTokDraft(snapshot.token, bytes)
  // Check publish status after upload
  try {
    const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${snapshot.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: result.publishId }),
      signal: AbortSignal.timeout(10000),
    })
    const statusData = await statusRes.json()
    console.log('[tiktok-upload] publish status:', statusRes.status, JSON.stringify(statusData))
  } catch (e) {
    console.log('[tiktok-upload] status check failed:', e)
  }
  await withBusinessTransaction(user.id, (client, business) =>
    recordDelivery(client, business.id, user.id, id, { mode: 'draft' }))
  return { mode: 'draft' as const, publishId: result.publishId }
})
