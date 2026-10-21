import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { postSchema } from '../../shared/schemas/workspace'
import { channelCanvas, channelFormat } from '../../shared/schemas/channel-format'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from './asset-storage'
import {
  consumeReservedCredits,
  creditsForCost,
  releaseReservedCredits,
  reserveCredits,
  videoRenderCredits,
} from './credits'
import { aiVideoCanvas, aiVideoConfigured, aiVideoPromptLimit, generateAiVideo } from './ai-video-provider'
import { buildVideoEndCard, buildVideoOverlayLayers, padFrameToCanvas, videoKeyframes } from './image-processing'
import { buildVideoCreativePlan } from './video-plan'
import { buildVideoExecutionBrief } from './video-execution-brief'
import { composeBrandedVideo, extractVideoFrames, renderStillMotion, VIDEO_END_CARD_SECONDS } from './video-compose'
import { reviewVideoQuality, verifyVideoSubject } from './video-subject-check'
import { brainForSlot, plannerBrainOf } from './monthly-planner-domain'
import { editorialPlanSchema, researchSchema } from '../../shared/schemas/monthly-plan'

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
  // A failure while the render is being prepared rolls that transaction back,
  // so the brief would otherwise stay 'brief_ready' and read as in progress
  // forever. It is recorded as failed instead, which the editor can retry.
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown; monthly_plan_id: string | null; monthly_slot: number | null }>('SELECT payload,monthly_plan_id,monthly_slot FROM posts WHERE id=$1 AND business_id=$2', [postId, business.id])
    const postRow = result.rows[0]
    const post = postRow && postSchema.parse(postRow.payload)
    if (!post?.video?.sourceAssetIds.length)
      throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })
    // Every new render is made on the post's channel canvas. A brief stored
    // before canvases followed the channel still names 1080x1920; it is read
    // as it is and only this render, once ready, records the channel's format.
    const canvas = channelCanvas(post.channel)

    const provenance = post.aiProvenance
    let verifiedFacts: string[] = []
    let researchFindings = ''
    let researchSources: string[] = provenance?.sourceUrls || []
    let businessBrain = ''
    let planResearch: unknown
    if (postRow?.monthly_plan_id) {
      const planResult = await client.query<{ evidence: unknown; research: unknown; editorial_plan: unknown; month_key: string }>(
        "SELECT evidence,research,editorial_plan,to_char(month,'YYYY-MM') AS month_key FROM monthly_plans WHERE id=$1 AND business_id=$2",
        [postRow.monthly_plan_id, business.id],
      )
      const planRow = planResult.rows[0]
      if (planRow) {
        planResearch = planRow.research
        const evidence = planRow.evidence as { brand?: { facts?: Array<{ id: string; text: string; source?: string }> }; brain?: unknown } | null
        const factIds = new Set(provenance?.factIds || [])
        verifiedFacts = (evidence?.brand?.facts || [])
          .filter(fact => factIds.has(fact.id))
          .map(fact => `${fact.text}${fact.source ? ` (burimi: ${fact.source})` : ''}`)
        const research = researchSchema.safeParse(planRow.research)
        if (research.success) {
          researchFindings = research.data.text
          const allowed = new Set(researchSources)
          researchSources = research.data.sources
            .filter(source => !allowed.size || allowed.has(source.url))
            .map(source => `${source.title}: ${source.url}`)
        }
        if (postRow.monthly_slot !== null && postRow.monthly_slot !== undefined) {
          const editorial = editorialPlanSchema.safeParse(planRow.editorial_plan)
          if (editorial.success) {
            const slot = editorial.data.slots[postRow.monthly_slot]
            const evidenceBrain = plannerBrainOf(evidence as never || {})
            if (slot) businessBrain = JSON.stringify(brainForSlot(evidenceBrain, slot, `${planRow.month_key}-${String(slot.day).padStart(2, '0')}`))
          }
        }
      }
    }

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
        canvas.width,
        canvas.height,
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
    const locale = audienceLanguageFromResearch(
      planResearch,
      contentLocaleForPreferences(workspace.preferences),
    )
    // The deterministic Video Creative Plan is rebuilt per render from the
    // brief + brand + duration. No AI call; the plan is the structure the
    // prompt and the future deterministic composition both consume.
    const plan = buildVideoCreativePlan({
      brief: post.video,
      brand: workspace.brand,
      locale,
      durationSeconds: post.video.durationSeconds,
    })
    const prompt = buildVideoExecutionBrief({
      plan,
      sourceContext: {
        assetDirection: post.video.assetDirection,
        visualLayout: post.video.visualLayout,
        verifiedFacts,
        researchFindings,
        researchSources,
        businessBrain,
      },
      durationSeconds: post.video.durationSeconds,
      guardrails: workspace.brand.guardrails,
      maxLength: aiVideoPromptLimit(),
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
    // The post's own approved design copy, set over the motion in the zone the
    // strategy kept clear. A video prepared by hand has no generated creative,
    // so it falls back to the brief's hook and call to action.
    const creative = post.aiProvenance?.creative
    const overlayZone = plan.shot.textZone === 'bottom' ? 'bottom' as const : 'top' as const
    const overlay = await buildVideoOverlayLayers({
      businessName: workspace.brand.name,
      eyebrow: creative?.eyebrow,
      headline: creative?.headline || post.video.hook,
      subline: creative ? hookRemainder(post.video.hook, creative.headline) : undefined,
      cta: creative?.cta || post.video.cta,
      zone: overlayZone,
      primaryColor: endCardInput.primaryColor,
      onPrimary: endCardInput.onPrimary,
      fontFamily: endCardInput.fontFamily,
      weightHook: endCardInput.weightHook,
      weightCta: endCardInput.weightCta,
      logo: logoBytes || undefined,
      target: canvas,
    })
    return {
      business,
      brandName: workspace.brand.name,
      locale,
      channel: post.channel,
      caption: post.caption,
      verifiedFacts,
      contentVersion: post.contentVersion ?? 1,
      renderId: renderRow.id,
      source: asset.rows[0].storage_path
        ? await downloadAsset(asset.rows[0].storage_path, 10 * 1024 * 1024)
        : asset.rows[0].bytes!,
      videoCredits,
      prompt,
      durationSeconds: post.video.durationSeconds,
      canvas,
      format: channelFormat(post.channel),
      endCardInput,
      shot: plan.shot,
      // Brand first, then the headline, then the supporting line and button,
      // spread across the first part of the motion.
      overlayExtent: overlay.extent,
      zone: overlayZone,
      overlays: overlay.layers.map((image, index) => ({
        image,
        start: [0.05, 0.15, 0.4][index]! * post.video!.durationSeconds,
      })),
    }
  }).catch(async (error) => {
    await withBusinessTransaction(userId, (client, business) =>
      markPostVideoFailed(client, business.id, postId),
    )
    throw error
  })

  // Set once the file is in storage, so any later failure can take it back out
  // instead of leaving bytes behind that the allowance would keep counting.
  const uploadedPaths: string[] = []
  let failureReason = 'render_failed'
  try {
    // The source photograph may be any aspect ratio; the provider is given
    // frames that already match the requested video canvas, so a landscape
    // source does not come back letterboxed with black bars. Both ends of the
    // motion are cut from that one photograph, so the subject stays the
    // subject that was photographed.
    const keyframes = await videoKeyframes(snapshot.source, snapshot.canvas, snapshot.shot)
    // Only the camera moves: the clip is rendered from the photograph itself,
    // so no provider is paid and the subject cannot change. Anything that
    // adds life to the scene goes to the motion model, on the landscape canvas
    // the keyframes were cut for when the photograph is landscape. The model
    // paints its own closest ratio; the keyframes are padded out to it whole
    // and the composer crops the clip back to the keyframes' canvas.
    const provider = snapshot.shot.action === 'camera_only' ? undefined : await aiVideoCanvas(keyframes.canvas)
    const providerFirst = provider ? await padFrameToCanvas(keyframes.first, provider.canvas) : keyframes.first
    const generated = !provider
      ? {
          bytes: await renderStillMotion({
            image: keyframes.still.image,
            from: keyframes.still.from,
            to: keyframes.still.to,
            canvas: keyframes.canvas,
            seconds: snapshot.durationSeconds,
          }),
          costUsd: 0,
        }
      : await generateAiVideo({
          image: providerFirst,
          lastFrame: keyframes.last && await padFrameToCanvas(keyframes.last, provider.canvas),
          prompt: snapshot.prompt,
          durationSeconds: snapshot.durationSeconds,
          canvas: provider.canvas,
          aspectRatio: provider.aspectRatio,
        })
    if (!generated) throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
    const { costUsd } = generated
    // A generated clip can drift between its keyframes, even when both are
    // the photograph, so it is held against the photograph before anything is
    // delivered.
    if (snapshot.shot.action !== 'camera_only') {
      // Held against the exact frame the model was given, padding included,
      // so the padding itself never reads as a change of subject.
      const check = await verifyVideoSubject({
        photograph: providerFirst,
        frames: await extractVideoFrames(generated.bytes, [0.3, 0.6, 0.95]),
      })
      if (!check.sameSubject) {
        console.warn('A generated video changed its subject and was not delivered', { postId, reason: check.reason })
        failureReason = 'subject_changed'
        throw createError({ statusCode: 422, message: 'server.VIDEO_SUBJECT_CHANGED' })
      }
    }
    // Compose before upload. The provider MP4 is an in-memory intermediate;
    // only the branded MP4 becomes the ready render's canonical storage path.
    const { width: endCardWidth, height: endCardHeight } = snapshot.canvas
    const endCardAssetId = randomUUID()
    failureReason = 'composition_failed'
    // The strategy decides whether this video closes on the branded card.
    const endCardImage = snapshot.shot.endCard
      ? await buildVideoEndCard({
          ...snapshot.endCardInput,
          target: { width: endCardWidth, height: endCardHeight },
        })
      : undefined
    const bytes = await composeBrandedVideo({
      motion: generated.bytes,
      endCard: endCardImage,
      target: { width: endCardWidth, height: endCardHeight },
      overlays: snapshot.overlays,
      ...(keyframes.landscape ? { placement: { y: clearOfType(snapshot.overlayExtent, keyframes.canvas, { width: endCardWidth, height: endCardHeight }, snapshot.zone) } } : {}),
    })
    failureReason = 'quality_review_failed'
    const quality = await reviewVideoQuality({
      photograph: snapshot.source,
      frames: await extractVideoFrames(bytes, [0.1, 0.4, 0.7, 0.95]),
      caption: snapshot.caption,
      brandName: snapshot.brandName,
      locale: snapshot.locale,
      verifiedFacts: snapshot.verifiedFacts,
      targetChannel: snapshot.channel,
    })
    const folder = assetStorageFolder(snapshot.business.slug, snapshot.business.id)
    const path = `${folder}/video-${postId}-${randomUUID()}.mp4`
    const endCardStoragePath = `${folder}/video-endcard-${postId}-${endCardAssetId}.jpg`
    failureReason = 'storage_failed'
    await uploadBinaryAsset(path, bytes, 'video/mp4')
    uploadedPaths.push(path)
    if (endCardImage) {
      await uploadBinaryAsset(endCardStoragePath, endCardImage, 'image/jpeg')
      uploadedPaths.push(endCardStoragePath)
    }
    failureReason = 'render_failed'
    await withBusinessTransaction(userId, async (client, business) => {
      // The video occupies the same storage allowance as the photos, so it is
      // measured before the render is recorded as ready. The end-card is
      // included in the same measurement so a business cannot exceed its
      // media allowance by one end-card after the mp4 settles.
      await requireQuota(business.id, 'media_storage_bytes', bytes.length + (endCardImage?.length || 0), client)
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
        "UPDATE video_renders SET status='ready',storage_path=$1,size_bytes=$2,duration_seconds=$3,composed=true,completed_at=now() WHERE id=$4 AND business_id=$5",
        [path, bytes.length, snapshot.durationSeconds + (endCardImage ? VIDEO_END_CARD_SECONDS : 0), snapshot.renderId, business.id],
      )
      // Retain the deterministic card for provenance and future recomposition.
      // Gallery and publishing use the composed MP4 at video_renders.storage_path.
      if (endCardImage) await client.query(
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
        if ((currentPost.contentVersion ?? 1) !== snapshot.contentVersion)
          throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_VALIDATION' })
        currentPost.video.status = 'ready'
        currentPost.video.format = snapshot.format
        currentPost.video.quality = quality
        currentPost.video.qualityContentVersion = snapshot.contentVersion
        currentPost.policy = quality.factuality ? 'warn' : 'block'
        currentPost.policyReason = quality.reasons.join(' ') || 'validation.aiQualityPassed'
        if (endCardImage) currentPost.video.endCardAssetId = endCardAssetId
        else delete currentPost.video.endCardAssetId
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
      await markPostVideoFailed(client, business.id, postId)
    })
    throw error
  }
}

async function markPostVideoFailed(client: PoolClient, businessId: string, postId: string) {
  const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, businessId])
  const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
  if (currentPost?.video) {
    currentPost.video.status = 'failed'
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, businessId])
  }
}

// What the hook says beyond the headline. A post's headline is often the
// hook's opening ("NGA AEROPORTI," of "Nga aeroporti, drejt planit tuaj."),
// and the post sets the rest beneath it. A hook that is a different sentence
// is not set at all: it was written for the strategy, not as approved copy,
// and can even be in another language than the post.
function hookRemainder(hook: string, headline: string) {
  const letters = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const head = letters(headline)
  if (!head || letters(hook) === head) return undefined
  let consumed = 0
  let matched = ''
  for (const char of hook) {
    consumed += char.length
    matched += letters(char)
    if (matched === head) return hook.slice(consumed).replace(/^[\s,.;:–-]+/, '').trim() || undefined
    if (!head.startsWith(matched)) return undefined
  }
  return undefined
}

// Where a landscape clip's top edge goes in the vertical canvas: just below
// the type when it sits on top, just above it when it sits at the bottom, so
// the copy never covers the photographed subject.
function clearOfType(
  extent: { top: number; bottom: number },
  clip: { width: number; height: number },
  canvas: { width: number; height: number },
  zone: 'top' | 'bottom',
) {
  const height = Math.round(canvas.width * clip.height / clip.width)
  const gap = Math.round(canvas.height * 0.025)
  const y = zone === 'top' ? extent.bottom + gap : extent.top - gap - height
  return Math.max(0, Math.min(canvas.height - height, y))
}
