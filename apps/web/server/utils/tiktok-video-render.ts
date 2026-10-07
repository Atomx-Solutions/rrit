import { randomUUID } from 'node:crypto'
import { postSchema } from '../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from './asset-storage'
import {
  consumeReservedCredits,
  creditsForCost,
  releaseReservedCredits,
  reserveCredits,
  tiktokVideoCredits,
} from './credits'
import { aiVideoConfigured, generateAiVideo } from './ai-video-provider'
import { postVideoPrompt } from './monthly-ai'

/**
 * Render a post's TikTok video and settle what it cost.
 *
 * This is the whole deliverable, so it is shared rather than left inside the
 * HTTP route: the monthly planner renders the videos a business bought as part
 * of the same run that produced its posts, and a business that renders one by
 * hand from the editor must get exactly the same work, charge and bookkeeping.
 */
export async function renderTikTokVideoForPost(userId: string, postId: string) {
  // Generation is the whole deliverable, so an unconfigured provider stops the
  // request before anything is reserved or recorded rather than falling back to
  // a render the brief never asked for.
  if (!aiVideoConfigured())
    throw createError({ statusCode: 503, message: 'Gjenerimi i videos me AI nuk është i konfiguruar.' })
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [postId, business.id])
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
      `INSERT INTO tiktok_video_renders(
         business_id,post_id,source_asset_ids,logo_asset_id,status,quota_month,width,height,duration_seconds
       ) VALUES($1,$2,$3,$4,'rendering',date_trunc('month',now() AT TIME ZONE 'UTC')::date,$5,$6,$7) RETURNING id`,
      [
        business.id,
        postId,
        JSON.stringify(post.tiktokVideo.sourceAssetIds),
        post.tiktokVideo.logoAssetId || null,
        ...post.tiktokVideo.format.split('x').map(Number),
        post.tiktokVideo.durationSeconds,
      ],
    )
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 500, message: 'Video job nuk u krijua.' })
    // The configured figure is the reservation, not the charge: it holds enough
    // credits to cover a render so the business cannot start one it cannot pay
    // for. What is actually taken is the provider's real cost, settled below.
    const videoCredits = await tiktokVideoCredits(client)
    await reserveCredits(client, { organizationId: business.id, credits: videoCredits, usageKind: 'generation', referenceType: 'tiktok_video', referenceId: renderRow.id, idempotencyKey: `tiktok-video-reserve:${renderRow.id}` })
    const logoRow = logo?.rows[0]
    const { workspace } = await loadWorkspace(client, business.id, userId)
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
    if (!generated) throw createError({ statusCode: 503, message: 'Gjenerimi i videos me AI nuk është i konfiguruar.' })
    const { bytes, costUsd } = generated
    const path = `${assetStorageFolder(snapshot.business.slug, snapshot.business.id)}/tiktok-${postId}-${randomUUID()}.mp4`
    await uploadBinaryAsset(path, bytes, 'video/mp4')
    uploadedPath = path
    await withBusinessTransaction(userId, async (client, business) => {
      // The video occupies the same storage allowance as the photos, so it is
      // measured before the render is recorded as ready.
      await requireQuota(business.id, 'media_storage_bytes', bytes.length, client)
      // Charged on what it actually cost. A provider that reports no cost
      // leaves the reservation as the charge, because guessing lower would give
      // the generation away and guessing higher would overcharge.
      const usdMicroEur = Number(process.env.AI_USD_MICRO_EUR)
      const charged = costUsd !== null && costUsd > 0 && Number.isFinite(usdMicroEur) && usdMicroEur > 0
        ? await creditsForCost(client, Math.max(1, Math.ceil(costUsd * usdMicroEur)))
        : snapshot.videoCredits
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
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.tiktokVideo) {
        currentPost.tiktokVideo.status = 'ready'
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, business.id])
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
    await withBusinessTransaction(userId, async (client, business) => {
      // Nothing was delivered, so the whole reservation goes back.
      await releaseReservedCredits(client, { organizationId: business.id, credits: snapshot.videoCredits, usageKind: 'generation', referenceType: 'tiktok_video', referenceId: snapshot.renderId, idempotencyKey: `tiktok-video-release:${snapshot.renderId}` })
      await client.query(
        "UPDATE tiktok_video_renders SET status='failed',failure_reason='render_failed',completed_at=now() WHERE id=$1 AND business_id=$2",
        [snapshot.renderId, business.id],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.tiktokVideo) {
        currentPost.tiktokVideo.status = 'failed'
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, business.id])
      }
    })
    throw error
  }
}
