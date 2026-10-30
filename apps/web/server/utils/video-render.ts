import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { contentLocaleForPreferences, postSchema } from '../../shared/schemas/workspace'
import { channelCanvas, channelFormat, channelUiInsets } from '../../shared/schemas/channel-format'
import { audienceLanguageFromResearch } from './audience-language'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from './asset-storage'
import {
  consumeReservedCredits,
  creditBalanceSnapshot,
  creditPricing,
  releaseReservedCredits,
  reserveCredits,
  videoRenderCredits,
} from './credits'
import { aiVideoCanvas, aiVideoCapabilities, aiVideoConfigured, aiVideoPromptLimit } from './ai-video-provider'
import { buildVideoOverlayLayers } from './image-processing'
import { approvedVideoCopy, videoPostEvidence } from './video-quality'
import { fitPhotoToChannel, requestOutpaint, reviewExtension } from './photo-fit'
import { directVideo, videoCrossfadeSeconds, videoLengthLimits } from './video-director'
import { affordableVideoSeconds, estimatedVideoCredits, usdMicroEurRate } from './video-budget'
import { directedTakes, videoChargeCredits } from './video-takes'
import { maxVideoPhotos, storyboardSeconds, type Storyboard } from '../../shared/schemas/storyboard'
import { addMusicToVideo, composeBrandedVideo, extractVideoFrames, joinClips, videoDuration } from './video-compose'
import { generateVideoMusic, videoMusicConfigured } from './video-music'
import { generateStoryboardShots } from './video-shots'
import { reviewVideoQuality, verifySamePhotographedSubject } from './video-subject-check'

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

    const { verifiedFacts, businessBrain, planResearch } = await videoPostEvidence(client, business.id, post, postRow!)

    const asset = await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
      "SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true AND kind='photo' AND creative_provenance IS NULL",
      [post.video.sourceAssetIds[0], business.id],
    )
    if (!asset.rows[0])
      throw createError({ statusCode: 409, message: 'server.ORIGINAL_PHOTO_UNAVAILABLE' })
    // Further angles of the subject grouped with the main photograph, under the
    // same rule: owned originals with their rights confirmed. One no longer
    // allowed is left out; the video can be made without it.
    const extraIds = post.video.sourceAssetIds.slice(1, maxVideoPhotos)
    const extraRows = extraIds.length
      ? (await client.query<{ id: string; bytes: Buffer | null; storage_path: string | null }>(
          "SELECT id,bytes,storage_path FROM assets WHERE id = ANY($1::uuid[]) AND business_id=$2 AND rights=true AND kind='photo' AND creative_provenance IS NULL",
          [extraIds, business.id],
        )).rows
      : []
    const extraAssets = extraIds.flatMap((id) => extraRows.filter((row) => row.id === id))
    // The planner already fitted this photograph to the channel canvas for
    // the poster; that same image is what the video animates, so it is reused
    // rather than extended (and paid for) again.
    const posterId = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(post.image)?.[1]
    const fittedPoster = posterId
      ? (await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
          `SELECT bytes,storage_path FROM assets
            WHERE id=$1 AND business_id=$2 AND rights=true
              AND creative_provenance->>'source'='video-first-frame'
              AND creative_provenance->>'sourceAssetId'=$3
              AND creative_provenance->>'channel'=$4
              AND creative_provenance->>'fit' IS NOT NULL`,
          [posterId, business.id, post.video.sourceAssetIds[0], post.channel],
        )).rows[0]
      : undefined

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
    // The video speaks the language of the audience the research found.
    const locale = audienceLanguageFromResearch(
      planResearch,
      contentLocaleForPreferences(workspace.preferences),
      post.aiProvenance?.locale,
    )
    // The approved logo, resolved inside the same transaction so the
    // composition stage below never has to re-read business data.
    const logoBytes = logoRow
      ? (logoRow.storage_path
          ? await downloadAsset(logoRow.storage_path, 4 * 1024 * 1024)
          : (logoRow.bytes as Buffer | null))
      : null
    if (post.video.logoAssetId && !logoBytes)
      throw createError({ statusCode: 409, message: 'server.APPROVED_LOGO_UNAVAILABLE' })
    // The post's own approved design copy, set over the motion in the zone the
    // strategy kept clear. A video prepared by hand has no generated creative,
    // so it falls back to the brief's hook and call to action.
    const creative = post.aiProvenance?.creative
    // Where the text sits until the director has located the subject; it is
    // set again beside the subject once the storyboard is known.
    const overlayZone = post.video.shot?.textZone === 'bottom' ? 'bottom' as const : 'top' as const
    const overlayInput = {
      businessName: workspace.brand.name,
      eyebrow: creative?.eyebrow,
      headline: creative?.headline || post.video.hook,
      subline: creative ? hookRemainder(post.video.hook, creative.headline) : undefined,
      cta: creative?.cta || post.video.cta,
      zone: overlayZone,
      primaryColor: workspace.brand.palette?.primary || workspace.brand.color,
      onPrimary: workspace.brand.palette?.onPrimary,
      fontFamily: workspace.brand.typography?.family,
      weightHook: workspace.brand.typography?.weightHook,
      weightCta: workspace.brand.typography?.weightCta,
      logo: logoBytes || undefined,
      target: canvas,
      covered: channelUiInsets(post.channel),
    }
    const overlay = await buildVideoOverlayLayers(overlayInput)
    return {
      business,
      brandName: workspace.brand.name,
      locale,
      channel: post.channel,
      caption: post.caption,
      verifiedFacts,
      businessBrain,
      approvedCopy: approvedVideoCopy(post),
      contentVersion: post.contentVersion ?? 1,
      renderId: renderRow.id,
      source: asset.rows[0].storage_path
        ? await downloadAsset(asset.rows[0].storage_path, 10 * 1024 * 1024)
        : asset.rows[0].bytes!,
      extraSources: await Promise.all(extraAssets.map((row) => row.storage_path
        ? downloadAsset(row.storage_path, 10 * 1024 * 1024)
        : Promise.resolve(row.bytes!))),
      fitted: fittedPoster
        ? fittedPoster.storage_path
          ? await downloadAsset(fittedPoster.storage_path, 10 * 1024 * 1024)
          : fittedPoster.bytes
        : null,
      videoCredits,
      // What the creative director is told about this post.
      director: {
        brand: {
          name: workspace.brand.name,
          industry: workspace.brand.industry,
          audience: workspace.brand.audience,
          voice: workspace.brand.voice,
        },
        guardrails: workspace.brand.guardrails || [],
        post: {
          title: post.title,
          caption: post.caption,
          hook: post.video.hook,
          cta: post.video.cta,
          intent: post.video.intent,
          purpose: post.video.purpose,
        },
        userInstruction: post.video.editInstruction,
      },
      durationSeconds: post.video.durationSeconds,
      canvas,
      format: channelFormat(post.channel),
      // Brand first, then the headline, then the supporting line and button,
      // spread across the first part of the motion.
      // Placed in time once the shots are known.
      overlayImages: overlay.layers,
      overlayInput,
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
  // What is held for this render: the configured reservation, raised once
  // the director has planned the video and its cost can be estimated.
  let reservedCredits = snapshot.videoCredits
  let failureReason = 'render_failed'
  // How long each step took, logged once the render ends, to trace slow renders.
  const timings: { step: string; ms: number }[] = []
  const renderStarted = Date.now()
  const timed = async <T>(step: string, run: () => Promise<T>) => {
    const started = Date.now()
    try {
      return await run()
    } finally {
      timings.push({ step, ms: Date.now() - started })
    }
  }
  const logTimings = (outcome: string) => console.info('Video render timings', {
    postId,
    outcome,
    totalMs: Date.now() - renderStarted,
    steps: timings,
  })
  try {
    // Both ends of the motion are cut from one photograph, so the subject
    // stays the subject that was photographed.
    // The photograph on the channel canvas: the planner's fitted poster when
    // there is one, otherwise fitted here and charged with this render. A
    // photograph far from the canvas is extended rather than cropped to a
    // fragment, and the video never turns on its side.
    let fitCostUsd = 0
    if (!snapshot.fitted) {
      failureReason = 'photo_fit_failed'
      const fit = await timed('photo_fit', () => fitPhotoToChannel(snapshot.source, snapshot.channel, {
        outpaint: (guide, prompt) => requestOutpaint(guide, prompt, snapshot.channel),
        review: reviewExtension,
      }))
      fitCostUsd = fit.costUsd
      if (fit.mode === 'crop_fallback' && fit.reasons.length)
        console.warn('A photograph could not be extended and was cropped instead', { postId, reasons: fit.reasons })
      failureReason = 'render_failed'
      snapshot.fitted = fit.bytes
    }
    // Each further photograph is fitted the same way, all at once, and kept
    // only if it shows the very same subject as the main one. What fitting and
    // checking cost is charged whether or not a photograph is kept.
    const extraFitted: Buffer[] = []
    if (snapshot.extraSources.length) {
      failureReason = 'photo_fit_failed'
      const extras = await timed('extra_photos_fit', () => Promise.all(snapshot.extraSources.map(async (source) => {
        const fit = await fitPhotoToChannel(source, snapshot.channel, {
          outpaint: (guide, prompt) => requestOutpaint(guide, prompt, snapshot.channel),
          review: reviewExtension,
        })
        const check = await verifySamePhotographedSubject({ main: snapshot.fitted!, other: fit.bytes })
        return { fit, check }
      })))
      failureReason = 'render_failed'
      for (const [index, { fit, check }] of extras.entries()) {
        fitCostUsd += fit.costUsd + check.costUsd
        if (check.sameSubject) extraFitted.push(fit.bytes)
        else console.warn('A grouped photograph shows another subject and was left out of the video', { postId, photo: index + 2, reason: check.reason })
      }
    }
    // The AI creative director invents this video's concept and storyboard
    // from the fitted photograph. Without a valid storyboard the strategy's
    // own shot direction is rendered as before.
    const capabilities = await aiVideoCapabilities(snapshot.canvas)
    let limits = { ...videoLengthLimits(capabilities.durations), photos: 1 + extraFitted.length }
    // The video is planned within what the business can pay for: the model's
    // published price per second against the credits held for this render and
    // still free. Without a published price the configured reservation stands.
    const usdMicroEur = usdMicroEurRate()
    const pricing = capabilities.pricePerSecondUsd && usdMicroEur
      ? await withBusinessTransaction(userId, async (client, business) => {
          const credit = await creditPricing(client)
          const balance = await creditBalanceSnapshot(client, business.id)
          return {
            spendable: balance.spendable,
            rates: { pricePerSecondUsd: capabilities.pricePerSecondUsd!, usdMicroEur, providerCostPerCreditMicroEur: credit.providerCostPerCreditMicroEur },
          }
        })
      : null
    if (pricing) {
      const seconds = affordableVideoSeconds(pricing.spendable + reservedCredits, pricing.rates)
      const shortest = Math.min(...(capabilities.durations.length ? capabilities.durations : [limits.minSeconds]))
      if (seconds < Math.max(limits.minSeconds, shortest)) {
        failureReason = 'credits_insufficient'
        throw createError({ statusCode: 402, message: 'server.VIDEO_CREDITS_INSUFFICIENT' })
      }
      limits = { ...limits, maxSeconds: Math.min(limits.maxSeconds, seconds) }
    }
    // Holds enough for every take planned so far before the next is
    // generated; a take the business cannot pay for is never started.
    let plannedSeconds = 0
    const reserveFor = async (seconds: number, attempt: number) => {
      plannedSeconds += seconds
      seconds = plannedSeconds
      if (!pricing) return
      const needed = estimatedVideoCredits(seconds, pricing.rates)
      if (needed <= reservedCredits) return
      const extra = needed - reservedCredits
      await withBusinessTransaction(userId, (client, business) => reserveCredits(client, {
        organizationId: business.id,
        credits: extra,
        usageKind: 'generation',
        referenceType: 'video',
        referenceId: snapshot.renderId,
        idempotencyKey: `video-reserve-extra:${snapshot.renderId}:${attempt}`,
      }))
      reservedCredits += extra
    }
    // Every video is made by the configured motion model; nothing is animated
    // locally. The model paints its own closest ratio around the channel
    // canvas, and the composer crops the clip back to it.
    const provider = await aiVideoCanvas(snapshot.canvas)
    let generationCostUsd: number | null = 0
    const addCost = (value: number | null) => {
      generationCostUsd = generationCostUsd === null || value === null ? null : generationCostUsd + value
    }
    // One take: the director's storyboard, shot by shot.
    const take = async (storyboard: Storyboard, onSubjectChange: 'stop' | 'record') => {
      const crossfade = videoCrossfadeSeconds()
      const shots = await generateStoryboardShots({
        storyboard,
        fitted: snapshot.fitted!,
        extraFitted,
        provider,
        lastFrameSupported: capabilities.lastFrame,
        guardrails: snapshot.director.guardrails,
        maxLength: aiVideoPromptLimit(),
        onSubjectChange,
      }, { onCost: addCost, onTiming: (step, ms) => timings.push({ step, ms }) })
      return {
        subjectChanges: shots.subjectChanges,
        motion: await timed('join_clips', () => joinClips(shots.clips, provider.canvas, crossfade)),
        shotStarts: storyboard.shots.reduce<number[]>((starts, _shot, index) => {
          starts.push(index ? starts[index - 1]! + storyboard.shots[index - 1]!.durationSeconds - crossfade : 0)
          return starts
        }, []),
      }
    }
    // The AI creative director invents this video's concept and storyboard
    // from the fitted photograph. When a take changes the subject, the
    // director is told how and asked for a calmer concept, and that is shot
    // once more. The second take is always delivered: if it changed the
    // subject too, the video carries a warning for the business to review,
    // and they can direct a new take themselves with Edit video with AI.
    const takes = await directedTakes({
      direct: async (previousAttempt) => {
        failureReason = 'direction_failed'
        const direction = await timed('direct', () => directVideo({
          photograph: snapshot.fitted!,
          extraPhotographs: extraFitted,
          channel: snapshot.channel,
          limits,
          locale: snapshot.locale,
          ...snapshot.director,
          ...(previousAttempt ? { previousAttempt } : {}),
        }))
        // Every video is directed: without a valid storyboard nothing is shot,
        // so no motion is paid for and the held credits are released.
        if (!direction.storyboard) {
          console.warn('The video director gave no valid storyboard; the video was not made', { postId })
          throw createError({ statusCode: 502, message: 'server.VIDEO_DIRECTION_FAILED' })
        }
        failureReason = 'render_failed'
        return direction
      },
      seconds: (planned) => storyboardSeconds(planned!),
      reserve: async (seconds, attempt) => {
        failureReason = 'credits_insufficient'
        await reserveFor(seconds, attempt)
        failureReason = 'render_failed'
      },
      retryAffordable: (planned, next) => !pricing
        || affordableVideoSeconds(pricing.spendable + snapshot.videoCredits, pricing.rates) >= planned + next,
      take: (planned, _calmer, mode) => take(planned!, mode),
    })
    const { result, storyboard, directionCostUsd } = takes
    // The director located the subject in the photograph, so the text is set
    // again in the free space beside it instead of over it.
    if (storyboard?.subjectFrame)
      snapshot.overlayImages = (await buildVideoOverlayLayers({ ...snapshot.overlayInput, avoid: storyboard.subjectFrame })).layers
    const { motion, shotStarts } = result
    const subjectWarning = result.subjectChanges.length
      ? result.subjectChanges.map((change) => `Shot ${change.shot}: ${change.reason}`).join(' ').slice(0, 400)
      : undefined
    if (subjectWarning) console.warn('A delivered video may have changed its subject', { postId, subjectWarning })
    // A provider that reports no cost leaves the reservation as the charge.
    const costUsd = generationCostUsd === null ? null : generationCostUsd + fitCostUsd + directionCostUsd
    const motionSeconds = await videoDuration(motion)
    // The brand and headline arrive in the opening shot; the call to action
    // arrives with the final shot, or a little into a single one.
    const finalStart = shotStarts.at(-1) || 0
    const overlayStarts = shotStarts.length > 1
      ? [0.2, 0.7, finalStart + 0.4]
      : [0.05, 0.15, 0.4].map((share) => share * motionSeconds)
    const overlays = snapshot.overlayImages.map((image, index) => ({
      image,
      start: Math.min(overlayStarts[Math.min(index, overlayStarts.length - 1)]!, Math.max(0, motionSeconds - 1)),
    }))
    // Compose before upload. The provider MP4 is an in-memory intermediate;
    // only the branded MP4 becomes the ready render's canonical storage path.
    failureReason = 'composition_failed'
    let bytes = await timed('compose', () => composeBrandedVideo({
      motion,
      target: snapshot.canvas,
      overlays,
    }))
    // Frames of the finished video, read by both the music and the review.
    const frames = await timed('extract_frames', () => extractVideoFrames(bytes, [0.1, 0.4, 0.7, 0.95]))
    // One track for the whole video, made from what it shows. Music that
    // cannot be made leaves the video silent, as videos were before; it never
    // costs the business the video itself.
    let musicCostUsd: number | null = 0
    if (videoMusicConfigured()) {
      try {
        const music = await timed('music', () => generateVideoMusic({
          frames,
          caption: snapshot.caption,
          brandName: snapshot.brandName,
          durationSeconds: motionSeconds,
        }))
        if (music) {
          musicCostUsd = music.costUsd
          bytes = await timed('add_music', () => addMusicToVideo(bytes, music.audio))
        }
      } catch (error) {
        console.warn('Video music was unavailable; the video stays silent', { postId, error: error instanceof Error ? error.message : 'unknown' })
      }
    }
    // The finished video is reviewed like a post's still image: against the
    // photograph, the verified facts, the Business Brain commitments, the
    // business's restrictions, the approved copy, the channel frame and the
    // concept it was shot from. A reviewer that cannot answer leaves the
    // review pending, to run again before publishing; it never costs the
    // business the video it has already paid for.
    let quality: Awaited<ReturnType<typeof reviewVideoQuality>>['quality'] | null = null
    let reviewCostUsd = 0
    try {
      const review = await timed('quality_review', () => reviewVideoQuality({
        photograph: snapshot.source,
        extraPhotographs: extraFitted,
        frames,
        caption: snapshot.caption,
        brandName: snapshot.brandName,
        locale: snapshot.locale,
        verifiedFacts: snapshot.verifiedFacts,
        targetChannel: snapshot.channel,
        context: {
          businessBrain: snapshot.businessBrain,
          guardrails: snapshot.director.guardrails,
          approvedCopy: snapshot.approvedCopy,
          storyboard: storyboard || undefined,
        },
      }))
      quality = review.quality
      reviewCostUsd = review.costUsd
    } catch (error) {
      console.warn('Video QA was unavailable; the review stays pending', { postId, error: error instanceof Error ? error.message : 'unknown' })
    }
    const folder = assetStorageFolder(snapshot.business.slug, snapshot.business.id)
    const path = `${folder}/video-${postId}-${randomUUID()}.mp4`
    failureReason = 'storage_failed'
    await timed('upload', () => uploadBinaryAsset(path, bytes, 'video/mp4'))
    uploadedPaths.push(path)
    failureReason = 'render_failed'
    await withBusinessTransaction(userId, async (client, business) => {
      // The video occupies the same storage allowance as the photos, so it is
      // measured before the render is recorded as ready.
      await requireQuota(business.id, 'media_storage_bytes', bytes.length, client)
      // Charged on what it actually cost. A provider that reports no cost
      // leaves the reservation as the charge, because guessing lower would give
      // the generation away and guessing higher would overcharge.
      const charged = videoChargeCredits({
        costUsd: costUsd === null || musicCostUsd === null ? null : costUsd + reviewCostUsd + musicCostUsd,
        reservedCredits,
        usdMicroEur: usdMicroEurRate(),
        providerCostPerCreditMicroEur: (await creditPricing(client)).providerCostPerCreditMicroEur,
      })
      await consumeReservedCredits(client, {
        organizationId: business.id,
        credits: charged,
        reservedCredits,
        usageKind: 'generation',
        referenceType: 'video',
        referenceId: snapshot.renderId,
        idempotencyKey: `video-charge:${snapshot.renderId}`,
      })
      if (reservedCredits > charged)
        await releaseReservedCredits(client, {
          organizationId: business.id,
          credits: reservedCredits - charged,
          usageKind: 'generation',
          referenceType: 'video',
          referenceId: snapshot.renderId,
          idempotencyKey: `video-release:${snapshot.renderId}`,
        })
      await client.query(
        "UPDATE video_renders SET status='ready',storage_path=$1,size_bytes=$2,duration_seconds=$3,composed=true,completed_at=now() WHERE id=$4 AND business_id=$5",
        [path, bytes.length, Math.round(motionSeconds), snapshot.renderId, business.id],
      )
      const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, business.id])
      const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
      if (currentPost?.video) {
        if ((currentPost.contentVersion ?? 1) !== snapshot.contentVersion)
          throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_VALIDATION' })
        currentPost.video.status = 'ready'
        delete currentPost.video.failure
        if (subjectWarning) currentPost.video.subjectWarning = { detail: subjectWarning, at: new Date().toISOString() }
        else delete currentPost.video.subjectWarning
        currentPost.video.format = snapshot.format
        if (storyboard) currentPost.video.storyboard = storyboard
        else delete currentPost.video.storyboard
        if (quality) {
          currentPost.video.quality = quality
          currentPost.video.qualityContentVersion = snapshot.contentVersion
          currentPost.policy = quality.factuality ? 'warn' : 'block'
          currentPost.policyReason = quality.reasons.join(' ') || 'validation.aiQualityPassed'
        } else {
          // Pending: validation runs the review again before publishing.
          delete currentPost.video.quality
          delete currentPost.video.qualityContentVersion
          currentPost.policy = 'warn'
          currentPost.policyReason = 'server.AI_QUALITY_REVIEW_NEEDED'
        }
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(currentPost), postId, business.id])
      }
    })
    logTimings('ready')
    return { renderId: snapshot.renderId, status: 'ready' }
  } catch (error) {
    logTimings(failureReason)
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
      await releaseReservedCredits(client, { organizationId: business.id, credits: reservedCredits, usageKind: 'generation', referenceType: 'video', referenceId: snapshot.renderId, idempotencyKey: `video-release:${snapshot.renderId}` })
      await client.query(
        "UPDATE video_renders SET status='failed',failure_reason=$1,completed_at=now() WHERE id=$2 AND business_id=$3",
        [failureReason, snapshot.renderId, business.id],
      )
      await markPostVideoFailed(client, business.id, postId, { code: failureReason })
    })
    throw error
  }
}

async function markPostVideoFailed(
  client: PoolClient,
  businessId: string,
  postId: string,
  failure?: { code: string; detail?: string },
) {
  const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [postId, businessId])
  const currentPost = current.rows[0] && postSchema.parse(current.rows[0].payload)
  // A post whose video is already made keeps it: a later render that fails,
  // for example one started without credits left, made nothing to replace it.
  if (currentPost?.video && currentPost.video.status !== 'ready') {
    currentPost.video.status = 'failed'
    if (failure) currentPost.video.failure = { ...failure, detail: failure.detail?.slice(0, 400), at: new Date().toISOString() }
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
