import { randomUUID } from 'node:crypto'
import { postSchema } from '../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from './asset-storage'
import {
  consumeReservedCredits,
  creditsForCost,
  releaseReservedCredits,
  reserveCredits,
  videoRenderCredits,
} from './credits'
import { aiVideoConfigured, generateAiVideo } from './ai-video-provider'
import { buildVideoEndCard, prepareVideoFirstFrame } from './image-processing'
import { buildVideoCreativePlan } from './video-plan'
import { buildVideoExecutionBrief } from './video-execution-brief'
import { composeBrandedVideo, VIDEO_END_CARD_SECONDS } from './video-compose'

/**
 * Render a post's video and settle what it cost.
 *
 * This is the whole deliverable, so it is shared rather than left inside the
 * HTTP route: the monthly planner renders the videos a business bought as part
 * of the same run that produced its posts, and a business that renders one by
 * hand from the editor must get exactly the same work, charge and bookkeeping.
 */
export async function renderVideoForPost(userId: string, postId: string) {
  // Generation is the whole deliverable, so an unconfigured provider stops the
  // request before anything is reserved or recorded rather than falling back to
  // a render the brief never asked for.
  if (!aiVideoConfigured())
    throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [postId, business.id])
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    if (!post?.video?.sourceAssetIds.length)
      throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })

    const asset = await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
      "SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true AND kind='photo' AND creative_provenance IS NULL",
      [post.video.sourceAssetIds[0], business.id],
    )
    if (!asset.rows[0])
      throw createError({ statusCode: 409, message: 'server.ORIGINAL_PHOTO_UNAVAILABLE' })

    const logo = post.video.logoAssetId
      ? await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
          "SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true AND kind='brand' AND tags ? 'logo'",
          [post.video.logoAssetId, business.id],
        )
      : undefined
    // The package allowance is checked before the render row exists, exactly as
    // posts are, so a business over its limit is stopped before it is charged.
    await requireQuota(business.id, 'videos_per_month', 1, client)
    const render = await client.query<{ id: string }>(
      `INSERT INTO video_renders(
         business_id,post_id,source_asset_ids,logo_asset_id,status,quota_month,width,height,duration_seconds
       ) VALUES($1,$2,$3,$4,'rendering',date_trunc('month',now() AT TIME ZONE 'UTC')::date,$5,$6,$7) RETURNING id`,
      [
        business.id,
        postId,
        JSON.stringify(post.video.sourceAssetIds),
        post.video.logoAssetId || null,
        ...post.video.format.split('x').map(Number),
        post.video.durationSeconds,
      ],
    )
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 500, message: 'server.VIDEO_JOB_NOT_CREATED' })
    // The configured figure is the reservation, not the charge: it holds enough
    // credits to cover a render so the business cannot start one it cannot pay
    // for. What is actually taken is the provider's real cost, settled below.
    const videoCredits = await videoRenderCredits(client)
    await reserveCredits(client, { organizationId: business.id, credits: videoCredits, usageKind: 'generation', referenceType: 'video', referenceId: renderRow.id, idempotencyKey: `video-reserve:${renderRow.id}` })
    const logoRow = logo?.rows[0]
    const { workspace } = await loadWorkspace(client, business.id, userId)
    // The deterministic Video Creative Plan is rebuilt per render from the
    // brief + brand + duration. No AI call; the plan is the structure the
    // prompt and the future deterministic composition both consume.
    const plan = buildVideoCreativePlan({
      brief: post.video,
      brand: workspace.brand,
      locale: workspace.preferences.locale,
      durationSeconds: post.video.durationSeconds,
    })
    const prompt = buildVideoExecutionBrief({
      plan,
      sourceContext: {
        assetDirection: post.video.assetDirection,
        visualLayout: post.video.visualLayout,
      },
      durationSeconds: post.video.durationSeconds,
      guardrails: workspace.brand.guardrails,
    })
    // Everything the deterministic end-card needs, resolved inside the same
    // transaction so the composition stage below never has to re-read business
    // data (and never has to decide whether to inject AI content: the end-card
    // is purely approved copy + logo + brand colours).
    const logoBytes = logoRow
      ? (logoRow.storage_path
          ? await downloadAsset(logoRow.storage_path, 4 * 1024 * 1024)
          : (logoRow.bytes as Buffer | null))
      : null
    if (post.video.logoAssetId && !logoBytes)
      throw createError({ statusCode: 409, message: 'server.APPROVED_LOGO_UNAVAILABLE' })
    const endCardInput = {
      businessName: workspace.brand.name,
      cta: post.video.cta,
      primaryColor: workspace.brand.palette?.primary || workspace.brand.color,
      onPrimary: workspace.brand.palette?.onPrimary,
      fontFamily: workspace.brand.typography?.family,
      weightHook: workspace.brand.typography?.weightHook,
      weightCta: workspace.brand.typography?.weightCta,
      logo: logoBytes || undefined,
    }
    return {
      business,
      renderId: renderRow.id,
      source: asset.rows[0].storage_path
        ? await downloadAsset(asset.rows[0].storage_path, 10 * 1024 * 1024)
        : asset.rows[0].bytes!,
      videoCredits,
      prompt,
      durationSeconds: post.video.durationSeconds,
      format: post.video.format,
      endCardInput,
    }
  })

  // Set once the file is in storage, so any later failure can take it back out
  // instead of leaving bytes behind that the allowance would keep counting.
  const uploadedPaths: string[] = []
  let failureReason = 'render_failed'
  try {
    // The source photograph may be any aspect ratio; the provider is given a
    // frame that already matches the requested video canvas, so a landscape
    // source does not come back letterboxed with black bars.
    const [targetWidth, targetHeight] = snapshot.format.split('x').map(Number)
    const firstFrame = targetWidth && targetHeight
      ? await prepareVideoFirstFrame(snapshot.source, { width: targetWidth, height: targetHeight })
      : snapshot.source
    const generated = await generateAiVideo({
      image: firstFrame,
      prompt: snapshot.prompt,
      durationSeconds: snapshot.durationSeconds,
      format: snapshot.format,
    })
    if (!generated) throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
    const { costUsd } = generated
    // Compose before upload. The provider MP4 is an in-memory intermediate;
    // only the branded MP4 becomes the ready render's canonical storage path.
    const [endCardWidth, endCardHeight] = snapshot.format.split('x').map(Number)
    const endCardAssetId = randomUUID()
    if (!endCardWidth || !endCardHeight) throw new Error('Invalid video canvas')
    failureReason = 'composition_failed'
    const endCardImage = await buildVideoEndCard({
      ...snapshot.endCardInput,
      target: { width: endCardWidth, height: endCardHeight },
    })
    const bytes = await composeBrandedVideo({
      motion: generated.bytes,
      endCard: endCardImage,
      target: { width: endCardWidth, height: endCardHeight },
    })
    const folder = assetStorageFolder(snapshot.business.slug, snapshot.business.id)
    const path = `${folder}/video-${postId}-${randomUUID()}.mp4`
    const endCardStoragePath = `${folder}/video-endcard-${postId}-${endCardAssetId}.jpg`
    failureReason = 'storage_failed'
    await uploadBinaryAsset(path, bytes, 'video/mp4')
    uploadedPaths.push(path)
    await uploadBinaryAsset(endCardStoragePath, endCardImage, 'image/jpeg')
    uploadedPaths.push(endCardStoragePath)
    failureReason = 'render_failed'
    await withBusinessTransaction(userId, async (client, business) => {
      // The video occupies the same storage allowance as the photos, so it is
      // measured before the render is recorded as ready. The end-card is
      // included in the same measurement so a business cannot exceed its
      // media allowance by one end-card after the mp4 settles.
      await requireQuota(business.id, 'media_storage_bytes', bytes.length + endCardImage.length, client)
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
        referenceType: 'video',
        referenceId: snapshot.renderId,
        idempotencyKey: `video-charge:${snapshot.renderId}`,
      })
      if (snapshot.videoCredits > charged)
        await releaseReservedCredits(client, {
          organizationId: business.id,
          credits: snapshot.videoCredits - charged,
          usageKind: 'generation',
          referenceType: 'video',
          referenceId: snapshot.renderId,
          idempotencyKey: `video-release:${snapshot.renderId}`,
        })
      await client.query(
        "UPDATE video_renders SET status='ready',storage_path=$1,size_bytes=$2,duration_seconds=$3,completed_at=now() WHERE id=$4 AND business_id=$5",
        [path, bytes.length, snapshot.durationSeconds + VIDEO_END_CARD_SECONDS, snapshot.renderId, business.id],
      )
      // Retain the deterministic card for provenance and future recomposition.
      // Gallery and publishing use the composed MP4 at video_renders.storage_path.
      await client.query(
        "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height,creative_provenance) VALUES($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,$7,$8,$9)",
        [
          endCardAssetId,
          business.id,
          `End card · ${postId}`,
          JSON.stringify(['video-endcard']),
          endCardStoragePath,
          endCardImage.length,
          endCardWidth,
          endCardHeight,
          JSON.stringify({ source: 'video-end-card', postId, renderId: snapshot.renderId }),
        ],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.video) {
        currentPost.video.status = 'ready'
        currentPost.video.endCardAssetId = endCardAssetId
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, business.id])
      }
    })
    return { renderId: snapshot.renderId, status: 'ready' }
  } catch (error) {
    for (const uploadedPath of uploadedPaths) {
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
      await releaseReservedCredits(client, { organizationId: business.id, credits: snapshot.videoCredits, usageKind: 'generation', referenceType: 'video', referenceId: snapshot.renderId, idempotencyKey: `video-release:${snapshot.renderId}` })
      await client.query(
        "UPDATE video_renders SET status='failed',failure_reason=$1,completed_at=now() WHERE id=$2 AND business_id=$3",
        [failureReason, snapshot.renderId, business.id],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.video) {
        currentPost.video.status = 'failed'
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, business.id])
      }
    })
    throw error
  }
}
