import type { PoolClient } from 'pg'
import { contentLocaleForPreferences, postSchema, type Post } from '../../shared/schemas/workspace'
import { editorialPlanSchema, researchSchema } from '../../shared/schemas/monthly-plan'
import { audienceLanguageFromResearch } from './audience-language'
import { downloadAsset } from './asset-storage'
import { brainForSlot, plannerBrainOf } from './monthly-planner-domain'
import { extractVideoFrames } from './video-compose'
import { reviewVideoQuality } from './video-subject-check'

/**
 * What a video is made and reviewed against: the verified facts, research and
 * Business Brain commitments of the monthly slot it came from, exactly as the
 * still image of a post is. A video prepared by hand has no slot, so it has
 * none of them.
 */
export async function videoPostEvidence(
  client: PoolClient,
  businessId: string,
  post: Post,
  row: { monthly_plan_id: string | null; monthly_slot: number | null },
) {
  const provenance = post.aiProvenance
  let verifiedFacts: string[] = []
  let researchFindings = ''
  let researchSources: string[] = provenance?.sourceUrls || []
  let businessBrain = ''
  let planResearch: unknown
  if (row.monthly_plan_id) {
    const planResult = await client.query<{ evidence: unknown; research: unknown; editorial_plan: unknown; month_key: string }>(
      "SELECT evidence,research,editorial_plan,to_char(month,'YYYY-MM') AS month_key FROM monthly_plans WHERE id=$1 AND business_id=$2",
      [row.monthly_plan_id, businessId],
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
      if (row.monthly_slot !== null && row.monthly_slot !== undefined) {
        const editorial = editorialPlanSchema.safeParse(planRow.editorial_plan)
        if (editorial.success) {
          const slot = editorial.data.slots[row.monthly_slot]
          const evidenceBrain = plannerBrainOf(evidence as never || {})
          if (slot) businessBrain = JSON.stringify(brainForSlot(evidenceBrain, slot, `${planRow.month_key}-${String(slot.day).padStart(2, '0')}`))
        }
      }
    }
  }
  return { verifiedFacts, researchFindings, researchSources, businessBrain, planResearch }
}

/** The approved words a post's video carries over its motion. */
export function approvedVideoCopy(post: Post) {
  const creative = post.aiProvenance?.creative
  return {
    eyebrow: creative?.eyebrow,
    headline: creative?.headline || post.video?.hook,
    cta: creative?.cta || post.video?.cta,
  }
}

/** Review a ready render made before video QA was introduced, without rendering again. */
export async function reviewExistingVideoQuality(userId: string, postId: string) {
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown; monthly_plan_id: string | null; monthly_slot: number | null }>(
      'SELECT payload,monthly_plan_id,monthly_slot FROM posts WHERE id=$1 AND business_id=$2',
      [postId, business.id],
    )
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    if (!post?.video || post.video.status !== 'ready')
      throw createError({ statusCode: 409, message: 'server.VIDEO_REQUIRED_FOR_PUBLISHING' })
    const version = post.contentVersion ?? 1
    if (post.video.quality && post.video.qualityContentVersion === version)
      return { existing: post.video.quality }
    const render = await client.query<{ id: string; storage_path: string }>(
      "SELECT id,storage_path FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [postId, business.id],
    )
    const source = await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
      'SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true',
      [post.video.sourceAssetIds[0], business.id],
    )
    if (!render.rows[0] || !source.rows[0])
      throw createError({ statusCode: 409, message: 'server.ORIGINAL_PHOTO_UNAVAILABLE' })
    const { workspace } = await loadWorkspace(client, business.id, userId)
    const plan = post.aiProvenance
      ? await client.query<{ research: unknown }>(
          'SELECT research FROM monthly_plans WHERE id=$1 AND business_id=$2',
          [post.aiProvenance.planId, business.id],
        )
      : null
    const factIds = new Set(post.aiProvenance?.factIds || [])
    const evidence = await videoPostEvidence(client, business.id, post, result.rows[0]!)
    return {
      context: {
        businessBrain: evidence.businessBrain,
        guardrails: workspace.brand.guardrails || [],
        approvedCopy: approvedVideoCopy(post),
        storyboard: post.video.storyboard,
      },
      version,
      renderId: render.rows[0].id,
      videoPath: render.rows[0].storage_path,
      source: source.rows[0].storage_path
        ? await downloadAsset(source.rows[0].storage_path, 10 * 1024 * 1024)
        : source.rows[0].bytes!,
      caption: post.caption,
      brandName: workspace.brand.name,
      locale: audienceLanguageFromResearch(
        plan?.rows[0]?.research,
        contentLocaleForPreferences(workspace.preferences),
        post.aiProvenance?.locale,
      ),
      verifiedFacts: evidence.verifiedFacts.length
        ? evidence.verifiedFacts
        : workspace.brand.facts.filter((fact) => factIds.has(fact.id)).map((fact) => fact.text),
      targetChannel: post.channel,
    }
  })
  if ('existing' in snapshot) return snapshot.existing
  const video = await downloadAsset(snapshot.videoPath, 100 * 1024 * 1024)
  const { quality } = await reviewVideoQuality({
    photograph: snapshot.source,
    frames: await extractVideoFrames(video, [0.1, 0.4, 0.7, 0.95]),
    caption: snapshot.caption,
    brandName: snapshot.brandName,
    locale: snapshot.locale,
    verifiedFacts: snapshot.verifiedFacts,
    targetChannel: snapshot.targetChannel,
    context: snapshot.context,
  })
  await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [postId, business.id],
    )
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    const render = await client.query<{ id: string }>(
      "SELECT id FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1",
      [postId, business.id],
    )
    if (!post?.video || (post.contentVersion ?? 1) !== snapshot.version || render.rows[0]?.id !== snapshot.renderId)
      throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_VALIDATION' })
    post.video.quality = quality
    post.video.qualityContentVersion = snapshot.version
    // The finding is shown as a warning: the person decides, not the review.
    post.policy = 'warn'
    post.policyReason = quality.reasons.join(' ') || 'validation.aiQualityPassed'
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), postId, business.id])
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
  })
  return quality
}
