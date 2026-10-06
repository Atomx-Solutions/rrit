import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, uploadBinaryAsset } from '../../../utils/asset-storage'
import { renderTikTokPhotoVideo } from '../../../utils/tiktok-video-renderer'
import { consumeCredits, refundCredits } from '../../../utils/credits'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [id, business.id])
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    if (!post?.tiktokVideo?.sourceAssetIds.length)
      throw createError({ statusCode: 409, message: 'Përgatite fillimisht brief-in e videos TikTok.' })

    const asset = await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
      "SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true AND kind='photo' AND creative_provenance IS NULL",
      [post.tiktokVideo.sourceAssetIds[0], business.id],
    )
    if (!asset.rows[0])
      throw createError({ statusCode: 409, message: 'Fotoja origjinale nuk është më e disponueshme.' })

    const logo = post.tiktokVideo.logoAssetId
      ? await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
          "SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true AND kind='brand' AND tags ? 'logo'",
          [post.tiktokVideo.logoAssetId, business.id],
        )
      : undefined
    const render = await client.query<{ id: string }>(
      "INSERT INTO tiktok_video_renders(business_id,post_id,source_asset_ids,logo_asset_id,status) VALUES($1,$2,$3,$4,'rendering') RETURNING id",
      [business.id, id, JSON.stringify(post.tiktokVideo.sourceAssetIds), post.tiktokVideo.logoAssetId || null],
    )
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 500, message: 'Video job nuk u krijua.' })
    const pricing = await client.query<{ tiktok_video_credits: number }>('SELECT tiktok_video_credits FROM credit_pricing WHERE singleton=true')
    const videoCredits = Number(pricing.rows[0]?.tiktok_video_credits || 5)
    await consumeCredits(client, { organizationId: business.id, credits: videoCredits, usageKind: 'generation', referenceType: 'tiktok_video', referenceId: renderRow.id, idempotencyKey: `tiktok-video:${renderRow.id}` })
    const logoRow = logo?.rows[0]
    return {
      business,
      renderId: renderRow.id,
      source: asset.rows[0].storage_path
        ? await downloadAsset(asset.rows[0].storage_path, 10 * 1024 * 1024)
        : asset.rows[0].bytes!,
      logo: logoRow
        ? (logoRow.storage_path
            ? await downloadAsset(logoRow.storage_path, 5 * 1024 * 1024)
            : logoRow.bytes || undefined)
        : undefined,
      videoCredits,
    }
  })

  try {
    const bytes = await renderTikTokPhotoVideo(snapshot.source, snapshot.logo)
    const path = `${assetStorageFolder(snapshot.business.slug, snapshot.business.id)}/tiktok-${id}-${randomUUID()}.mp4`
    await uploadBinaryAsset(path, bytes, 'video/mp4')
    await withBusinessTransaction(user.id, async (client, business) => {
      await client.query(
        "UPDATE tiktok_video_renders SET status='ready',storage_path=$1,size_bytes=$2,completed_at=now() WHERE id=$3 AND business_id=$4",
        [path, bytes.length, snapshot.renderId, business.id],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.tiktokVideo) {
        currentPost.tiktokVideo.status = 'ready'
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), id, business.id])
      }
    })
    return { renderId: snapshot.renderId, status: 'ready' }
  } catch (error) {
    await withBusinessTransaction(user.id, async (client, business) => {
      await refundCredits(client, { organizationId: business.id, credits: snapshot.videoCredits, referenceType: 'tiktok_video', referenceId: snapshot.renderId, idempotencyKey: `tiktok-video-refund:${snapshot.renderId}` })
      await client.query(
        "UPDATE tiktok_video_renders SET status='failed',failure_reason='render_failed',completed_at=now() WHERE id=$1 AND business_id=$2",
        [snapshot.renderId, business.id],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.tiktokVideo) {
        currentPost.tiktokVideo.status = 'failed'
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), id, business.id])
      }
    })
    throw error
  }
})
