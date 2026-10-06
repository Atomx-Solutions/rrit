import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from '../../../utils/asset-storage'
import { renderTikTokPhotoVideo } from '../../../utils/tiktok-video-renderer'
import {
  consumeReservedCredits,
  creditsForCost,
  releaseReservedCredits,
  reserveCredits,
  tiktokVideoCredits,
} from '../../../utils/credits'
import { generateAiVideo } from '../../../utils/ai-video-provider'
import { postVideoPrompt } from '../../../utils/monthly-ai'

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
    // The package allowance is checked before the render row exists, exactly as
    // posts are, so a business over its limit is stopped before it is charged.
    await requireQuota(business.id, 'videos_per_month', 1, client)
    const render = await client.query<{ id: string }>(
      `INSERT INTO tiktok_video_renders(business_id,post_id,source_asset_ids,logo_asset_id,status,quota_month)
       VALUES($1,$2,$3,$4,'rendering',date_trunc('month',now() AT TIME ZONE 'UTC')::date) RETURNING id`,
      [business.id, id, JSON.stringify(post.tiktokVideo.sourceAssetIds), post.tiktokVideo.logoAssetId || null],
    )
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 500, message: 'Video job nuk u krijua.' })
    // The configured figure is the reservation, not the charge: it holds enough
    // credits to cover a render so the business cannot start one it cannot pay
    // for. What is actually taken is the provider's real cost, settled below.
    const videoCredits = await tiktokVideoCredits(client)
    await reserveCredits(client, { organizationId: business.id, credits: videoCredits, usageKind: 'generation', referenceType: 'tiktok_video', referenceId: renderRow.id, idempotencyKey: `tiktok-video-reserve:${renderRow.id}` })
    const logoRow = logo?.rows[0]
    const { workspace } = await loadWorkspace(client, business.id, user.id)
    const prompt = postVideoPrompt({
      brand: workspace.brand,
      post: {
        channel: post.channel,
        title: post.title,
        caption: post.caption,
        pillar: post.pillar,
        creative: post.aiProvenance?.creative,
        rationale: post.aiProvenance?.rationale,
      },
      brief: post.tiktokVideo,
      logoAvailable: Boolean(logoRow),
      guardrails: workspace.brand.guardrails,
    })
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
      prompt,
      durationSeconds: post.tiktokVideo.durationSeconds,
      format: post.tiktokVideo.format,
    }
  })

  // Set once the file is in storage, so any later failure can take it back out
  // instead of leaving bytes behind that the allowance would keep counting.
  let uploadedPath: string | undefined
  try {
    const generated = await generateAiVideo({
      image: snapshot.source,
      prompt: snapshot.prompt,
      durationSeconds: snapshot.durationSeconds,
      format: snapshot.format,
    })
    // The local renderer costs the provider nothing, so it is charged nothing.
    const bytes = generated?.bytes || await renderTikTokPhotoVideo(snapshot.source, snapshot.logo)
    const costUsd = generated ? generated.costUsd : 0
    const path = `${assetStorageFolder(snapshot.business.slug, snapshot.business.id)}/tiktok-${id}-${randomUUID()}.mp4`
    await uploadBinaryAsset(path, bytes, 'video/mp4')
    uploadedPath = path
    await withBusinessTransaction(user.id, async (client, business) => {
      // The video occupies the same storage allowance as the photos, so it is
      // measured before the render is recorded as ready.
      await requireQuota(business.id, 'media_storage_bytes', bytes.length, client)
      // Charged on what it actually cost. A provider that reports no cost
      // leaves the reservation as the charge, because guessing lower would give
      // the generation away and guessing higher would overcharge.
      const usdMicroEur = Number(process.env.AI_USD_MICRO_EUR)
      const charged = costUsd !== null && costUsd > 0 && Number.isFinite(usdMicroEur) && usdMicroEur > 0
        ? await creditsForCost(client, Math.max(1, Math.ceil(costUsd * usdMicroEur)))
        : costUsd === 0 ? 0 : snapshot.videoCredits
      await consumeReservedCredits(client, {
        organizationId: business.id,
        credits: charged,
        reservedCredits: snapshot.videoCredits,
        usageKind: 'generation',
        referenceType: 'tiktok_video',
        referenceId: snapshot.renderId,
        idempotencyKey: `tiktok-video-charge:${snapshot.renderId}`,
      })
      if (snapshot.videoCredits > charged)
        await releaseReservedCredits(client, {
          organizationId: business.id,
          credits: snapshot.videoCredits - charged,
          usageKind: 'generation',
          referenceType: 'tiktok_video',
          referenceId: snapshot.renderId,
          idempotencyKey: `tiktok-video-release:${snapshot.renderId}`,
        })
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
    if (uploadedPath) {
      try {
        await removeAsset(uploadedPath)
      } catch (cleanupError) {
        console.error('Failed to remove a rendered video after a failed render', {
          storagePath: uploadedPath,
          error: cleanupError,
        })
      }
    }
    await withBusinessTransaction(user.id, async (client, business) => {
      // Nothing was delivered, so the whole reservation goes back.
      await releaseReservedCredits(client, { organizationId: business.id, credits: snapshot.videoCredits, usageKind: 'generation', referenceType: 'tiktok_video', referenceId: snapshot.renderId, idempotencyKey: `tiktok-video-release:${snapshot.renderId}` })
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
