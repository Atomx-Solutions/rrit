import { z } from 'zod'
import { downloadAsset } from '../../../utils/asset-storage'
import { decryptTikTokToken, uploadTikTokDraft } from '../../../utils/tiktok'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
    const render = await client.query<{ storage_path: string }>(
      "SELECT storage_path FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [id, business.id],
    )
    if (!render.rows[0]) throw createError({ statusCode: 409, message: 'server.VIDEO_REQUIRED_FOR_TIKTOK' })
    const connection = await client.query<{ access_token_ciphertext: string; expires_at: Date; scopes: string[] }>(
      "SELECT access_token_ciphertext,expires_at,scopes FROM tiktok_connections WHERE business_id=$1 AND status='connected'",
      [business.id],
    )
    const row = connection.rows[0]
    if (!row || row.expires_at < new Date() || !row.scopes.includes('video.upload'))
      throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED' })
    return { path: render.rows[0].storage_path, token: decryptTikTokToken(row.access_token_ciphertext, business.id) }
  })
  const bytes = await downloadAsset(snapshot.path, 50 * 1024 * 1024)
  return uploadTikTokDraft(snapshot.token, bytes)
})
