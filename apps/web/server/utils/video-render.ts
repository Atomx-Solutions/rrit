import { randomUUID } from 'node:crypto'
import { dominantColor } from './brand-palette'
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
import { dressVideoScene } from './video-scene'
import { directVideo, videoCrossfadeSeconds, videoLengthLimits } from './video-director'
import { affordableVideoSeconds, estimatedVideoCredits, usdMicroEurRate } from './video-budget'
import { directedTakes, videoChargeCredits } from './video-takes'
import { maxVideoPhotos, storyboardSeconds, type Storyboard } from '../../shared/schemas/storyboard'
import { addMusicToVideo, composeBrandedVideo, extractVideoFrames, joinClips, videoDuration } from './video-compose'
import { generateVideoMusic, videoMusicConfigured } from './video-music'
import { downloadMusicTrack, findMusicTrack } from './music-library'
import { generateStoryboardShots } from './video-shots'
import { reviewVideoQuality, verifySamePhotographedSubject } from './video-subject-check'

/**
 * Queue a render of a post's video, with its credits already held.
 *
 * Making a video takes minutes, so the request that asks for one only queues
 * it and answers at once; a planner run renders it from the queue. The
 * allowance and the credits are checked here, so a business that cannot pay
 * is told straight away. The monthly planner and the editor queue the same
 * way, so both get exactly the same work, charge and bookkeeping.
 */
export async function queueVideoRender(userId: string, postId: string) {
  // Generation is the whole deliverable, so an unconfigured provider stops the
  // request before anything is reserved or recorded rather than falling back to
  // a render the brief never asked for.
  if (!aiVideoConfigured())
    throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
  return queueRender(userId, postId).catch(async (error: unknown) => {
    // A render already under way keeps its brief as it is. Any other refusal
    // (no allowance, no credits) is recorded on the brief, which the editor
    // can start again, so it never reads as in progress.
    const inProgress = typeof error === 'object' && error && 'message' in error
      && error.message === 'server.VIDEO_RENDER_IN_PROGRESS'
    if (!inProgress)
      await withBusinessTransaction(userId, (client, business) =>
        markPostVideoFailed(client, business.id, postId, { code: 'queue_refused' }))
    throw error
  })
}

function queueRender(userId: string, postId: string) {
  return withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [postId, business.id])
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    if (!post?.video?.sourceAssetIds.length)
      throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })
    const canvas = channelCanvas(post.channel)
    // The package allowance is checked before the render row exists, exactly as
    // posts are, so a business over its limit is stopped before it is charged.
    await requireQuota(business.id, 'videos_per_month', 1, client)
    // The configured figure is the reservation, not the charge: it holds enough
    // credits to cover a render so the business cannot start one it cannot pay
    // for. What is actually taken is the provider's real cost, settled below.
    const videoCredits = await videoRenderCredits(client)
    const render = await client.query<{ id: string }>(
      `INSERT INTO video_renders(
         business_id,post_id,source_asset_ids,logo_asset_id,status,quota_month,width,height,duration_seconds,
         requested_by,reserved_credits
       ) VALUES($1,$2,$3,$4,'queued',date_trunc('month',now() AT TIME ZONE 'UTC')::date,$5,$6,$7,$8,$9) RETURNING id`,
      [
        business.id,
        postId,
        JSON.stringify(post.video.sourceAssetIds),
        post.video.logoAssetId || null,
        canvas.width,
        canvas.height,
        post.video.durationSeconds,
        userId,
        videoCredits,
      ],
    ).catch((error: unknown) => {
      // One render at a time for a post: a second request finds the first.
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
        throw createError({ statusCode: 409, message: 'server.VIDEO_RENDER_IN_PROGRESS' })
      throw error
    })
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 500, message: 'server.VIDEO_JOB_NOT_CREATED' })
    await reserveCredits(client, { organizationId: business.id, credits: videoCredits, usageKind: 'generation', referenceType: 'video', referenceId: renderRow.id, idempotencyKey: `video-reserve:${renderRow.id}` })
    return { renderId: renderRow.id, status: 'queued' as const }
  })
}

/** A queued render a planner run has claimed, with the lease that fences it. */
export type ClaimedVideoRender = { id: string; postId: string; requestedBy: string; leaseOwner: string }

/**
 * Render a claimed video and settle what it cost. Every write is fenced by the
 * run's lease, so a run that lost the render to another changes nothing.
 */
export async function renderQueuedVideo(job: ClaimedVideoRender) {
  const { postId, requestedBy: userId } = job
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
    // What the queue already holds for this render, read under its lease.
    const render = await client.query<{ reserved_credits: number | null }>(
      "SELECT reserved_credits FROM video_renders WHERE id=$1 AND business_id=$2 AND post_id=$3 AND status='rendering' AND lease_owner=$4",
      [job.id, business.id, postId, job.leaseOwner],
    )
    const renderRow = render.rows[0]
    if (!renderRow) throw createError({ statusCode: 409, message: 'server.VIDEO_JOB_NOT_CREATED' })
    const videoCredits = renderRow.reserved_credits || 0
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
    const source = asset.rows[0].storage_path
      ? await downloadAsset(asset.rows[0].storage_path, 10 * 1024 * 1024)
      : asset.rows[0].bytes!
    // The application-chosen brand colour; without one, the photograph's own
    // colour, so videos without a palette do not all share one fixed shade.
    const brandPrimary = workspace.brand.palette?.primary
    const primaryColor = brandPrimary || (await dominantColor(source).catch(() => undefined))
    const overlayInput = {
      businessName: workspace.brand.name,
      eyebrow: creative?.eyebrow,
      headline: creative?.headline || post.video.hook,
      subline: creative ? hookRemainder(post.video.hook, creative.headline) : undefined,
      cta: creative?.cta || post.video.cta,
      zone: overlayZone,
      primaryColor,
      onPrimary: brandPrimary ? workspace.brand.palette?.onPrimary : undefined,
      fontFamily: workspace.brand.typography?.family,
      weightHook: workspace.brand.typography?.weightHook,
      weightCta: workspace.brand.typography?.weightCta,
      logo: logoBytes || undefined,
      target: canvas,
      covered: channelUiInsets(post.channel),
    }
    const overlay = await buildVideoOverlayLayers(overlayInput)
    // The music the business chose. A library track taken out of the library
    // since leaves the video silent rather than paying for AI music instead.
    const musicChoice = post.video.music?.source || 'ai'
    const musicTrack = post.video.music?.source === 'library'
      ? await findMusicTrack(client, post.video.music.trackId)
      : null
    return {
      musicSource: musicChoice === 'library' && !musicTrack ? 'none' as const : musicChoice,
      musicTrackPath: musicTrack?.storagePath,
      business,
      brandName: workspace.brand.name,
      locale,
      reasonLocale: workspace.preferences.locale,
      channel: post.channel,
      caption: post.caption,
      verifiedFacts,
      businessBrain,
      approvedCopy: approvedVideoCopy(post),
      contentVersion: post.contentVersion ?? 1,
      renderId: job.id,
      source,
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
    await failClaimedRender(job, 'render_failed')
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
    // The video moves through the scene its still post shows: the photograph
    // dressed with the props that belong to this business, without type. Only
    // the shots need the dressed photograph, so the director plans the video
    // from the fitted one while the scene is dressed, and neither waits for
    // the other.
    const undressed = snapshot.fitted!
    const dressing = timed('dress_scene', () => dressVideoScene({
      photograph: undressed,
      channel: snapshot.channel,
      brand: snapshot.director.brand,
      post: snapshot.director.post,
    })).then((dressed) => {
      fitCostUsd += dressed.costUsd
      snapshot.fitted = dressed.bytes
    })
    // A render that stops before its first shot still settles the dressing.
    dressing.catch(() => undefined)
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
    const reserveFor = async (seconds: number, attempt: number | string) => {
      plannedSeconds += seconds
      seconds = plannedSeconds
      if (!pricing) return
      const needed = estimatedVideoCredits(seconds, pricing.rates)
      if (needed <= reservedCredits) return
      const extra = needed - reservedCredits
      await withBusinessTransaction(userId, async (client, business) => {
        await reserveCredits(client, {
          organizationId: business.id,
          credits: extra,
          usageKind: 'generation',
          referenceType: 'video',
          referenceId: snapshot.renderId,
          idempotencyKey: `video-reserve-extra:${snapshot.renderId}:${attempt}`,
        })
        // Kept with the render, so a render that is stopped can give it back.
        await client.query(
          'UPDATE video_renders SET reserved_credits=COALESCE(reserved_credits,0)+$1 WHERE id=$2 AND business_id=$3',
          [extra, snapshot.renderId, business.id],
        )
      })
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
      await dressing
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
      }, {
        onCost: addCost,
        onTiming: (step, ms) => timings.push({ step, ms }),
        reserveRetry: async (seconds, shot) => {
          if (pricing && affordableVideoSeconds(pricing.spendable + snapshot.videoCredits, pricing.rates) < plannedSeconds + seconds) return false
          try {
            await reserveFor(seconds, `shot-${shot}-${plannedSeconds}`)
            return true
          } catch {
            return false
          }
        },
      })
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
          photograph: undressed,
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
    // The AI track itself, kept with the post so the business can return to it
    // after trying a library track, without paying for it again.
    let aiMusic: Buffer | null = null
    const addMusic = async () => {
      if (snapshot.musicSource === 'none') return
      if (snapshot.musicSource === 'library') {
        try {
          const track = await timed('library_music', () => downloadMusicTrack(snapshot.musicTrackPath!))
          bytes = await timed('add_music', () => addMusicToVideo(bytes, track))
        } catch (error) {
          console.warn('Library music was unavailable; the video stays silent', { postId, error: error instanceof Error ? error.message : 'unknown' })
        }
        return
      }
      if (!videoMusicConfigured()) return
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
          aiMusic = music.audio
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
    const review = async () => {
      try {
        const result = await timed('quality_review', () => reviewVideoQuality({
          photograph: snapshot.source,
          extraPhotographs: extraFitted,
          frames,
          caption: snapshot.caption,
          brandName: snapshot.brandName,
          locale: snapshot.locale,
          reasonLocale: snapshot.reasonLocale,
          verifiedFacts: snapshot.verifiedFacts,
          targetChannel: snapshot.channel,
          context: {
            businessBrain: snapshot.businessBrain,
            guardrails: snapshot.director.guardrails,
            approvedCopy: snapshot.approvedCopy,
            storyboard: storyboard || undefined,
          },
        }))
        quality = result.quality
        reviewCostUsd = result.costUsd
      } catch (error) {
        console.warn('Video QA was unavailable; the review stays pending', { postId, error: error instanceof Error ? error.message : 'unknown' })
      }
    }
    // Both read the same frames of the video before its music, so neither
    // waits for the other.
    await Promise.all([addMusic(), review()])
    const folder = assetStorageFolder(snapshot.business.slug, snapshot.business.id)
    const path = `${folder}/video-${postId}-${randomUUID()}.mp4`
    failureReason = 'storage_failed'
    await timed('upload', () => uploadBinaryAsset(path, bytes, 'video/mp4'))
    uploadedPaths.push(path)
    const aiMusicPath = aiMusic ? `${folder}/music-${postId}-${randomUUID()}.mp3` : null
    if (aiMusic && aiMusicPath) {
      await timed('upload_music', () => uploadBinaryAsset(aiMusicPath, aiMusic!, 'audio/mpeg'))
      uploadedPaths.push(aiMusicPath)
    }
    // The AI track of the video this render replaces, removed once the new
    // one is recorded.
    let replacedAiMusicPath: string | undefined
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
      const finished = await client.query(
        "UPDATE video_renders SET status='ready',storage_path=$1,size_bytes=$2,duration_seconds=$3,composed=true,completed_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$4 AND business_id=$5 AND lease_owner=$6",
        [path, bytes.length, Math.round(motionSeconds), snapshot.renderId, business.id, job.leaseOwner],
      )
      // A run that lost its lease settles nothing; the charge above rolls back.
      if (!finished.rowCount) throw createError({ statusCode: 409, message: 'server.VIDEO_JOB_NOT_CREATED' })
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
        replacedAiMusicPath = currentPost.video.aiMusicPath
        if (aiMusicPath) currentPost.video.aiMusicPath = aiMusicPath
        else delete currentPost.video.aiMusicPath
        if (storyboard) currentPost.video.storyboard = storyboard
        else delete currentPost.video.storyboard
        if (quality) {
          currentPost.video.quality = quality
          currentPost.video.qualityContentVersion = snapshot.contentVersion
          currentPost.policy = 'warn'
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
    if (replacedAiMusicPath)
      await removeAsset(replacedAiMusicPath).catch((error) =>
        console.error('Failed to remove the AI music of a replaced video', { storagePath: replacedAiMusicPath, error }))
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
    await failClaimedRender(job, failureReason)
    throw error
  }
}

/**
 * Records a claimed render as failed and gives back everything held for it,
 * since nothing was delivered. Fenced by the lease, so only the run that holds
 * the render settles it, and only once.
 */
async function failClaimedRender(job: ClaimedVideoRender, failureReason: string) {
  await withBusinessTransaction(job.requestedBy, async (client, business) => {
    const failed = await client.query<{ reserved_credits: number | null }>(
      "UPDATE video_renders SET status='failed',failure_reason=$1,completed_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$2 AND business_id=$3 AND lease_owner=$4 RETURNING reserved_credits",
      [failureReason, job.id, business.id, job.leaseOwner],
    )
    if (!failed.rowCount) return
    const held = failed.rows[0]!.reserved_credits || 0
    if (held > 0)
      await releaseReservedCredits(client, { organizationId: business.id, credits: held, usageKind: 'generation', referenceType: 'video', referenceId: job.id, idempotencyKey: `video-release:${job.id}` })
    await markPostVideoFailed(client, business.id, job.postId, { code: failureReason })
  })
}

/**
 * Settles a render whose run was stopped before it finished: its lease has
 * expired, so the run is gone. Nothing was delivered, so what was held goes
 * back and the business can start it again from the editor.
 */
export async function failStoppedRender(render: { id: string; postId: string; actorId: string; staleAfterSeconds: number }) {
  await withBusinessTransaction(render.actorId, async (client, business) => {
    // A render from before the queue holds no recorded reservation, so only
    // its status is settled.
    const failed = await client.query<{ reserved_credits: number | null }>(
      `UPDATE video_renders SET status='failed',failure_reason='render_stopped',completed_at=now(),lease_owner=NULL,lease_until=NULL
        WHERE id=$1 AND business_id=$2 AND status='rendering'
          AND COALESCE(lease_until, created_at + make_interval(secs => $3)) < now()
        RETURNING reserved_credits`,
      [render.id, business.id, render.staleAfterSeconds],
    )
    if (!failed.rowCount) return
    const held = failed.rows[0]!.reserved_credits || 0
    if (held > 0)
      await releaseReservedCredits(client, { organizationId: business.id, credits: held, usageKind: 'generation', referenceType: 'video', referenceId: render.id, idempotencyKey: `video-release:${render.id}` })
    await markPostVideoFailed(client, business.id, render.postId, { code: 'render_stopped' })
  })
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
