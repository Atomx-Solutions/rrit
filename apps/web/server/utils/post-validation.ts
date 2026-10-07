import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import type { Post } from '../../shared/schemas/workspace'
import { factIsUsable, sameFactContent, type BrandFact } from '../../shared/schemas/business-brain'
import { dayInZone } from '../../shared/utils/calendar'
import { channelFormatCapability } from '../../shared/utils/content-formats'
import { qualityBrandHash, qualityReviewKey, reviewedQuality } from './post-quality-domain'
import { connectedMeta, decryptMetaToken, graphRequest, MetaFailure, metaConfigured } from './meta'

const limitsSchema = z.object({
  caption_characters: z.number().int().positive().max(2200),
  image_bytes: z.number().int().positive().max(2097152),
  minimum_width: z.number().int().positive(),
  maximum_width: z.number().int().positive().max(1440),
  minimum_aspect_ratio: z.number().positive(),
  maximum_aspect_ratio: z.number().positive(),
  max_hashtags: z.number().int().nonnegative(),
  daily_ai_requests: z.number().int().positive(),
})
export type PostCheck = { key: string; passed: boolean; message: string; advisory?: boolean }
export function blockingPostChecks(checks: PostCheck[]) {
  return checks.filter((check) => !check.advisory)
}
export function postContentVersion(post: Post) {
  return post.contentVersion ?? 1
}
export function postContentSnapshot(post: Post) {
  return {
    contentVersion: postContentVersion(post),
    title: post.title,
    caption: post.caption,
    channel: post.channel,
    format: post.format,
    image: post.image,
    pillar: post.pillar,
  }
}
export async function postLimits(db: Pool | PoolClient = database()) {
  const row = await db.query("SELECT value FROM app_settings WHERE key='post_limits'")
  const result = limitsSchema.safeParse(row.rows[0]?.value)
  if (!result.success)
    throw createError({ statusCode: 503, message: 'server.POST_LIMITS_NOT_CONFIGURED' })
  return result.data
}
export async function decodePhoto(bytes: Buffer) {
  try {
    // Decode all pixels and strip EXIF, location and other embedded metadata.
    const result = await sharp(bytes, {
      limitInputPixels: 16000000,
      failOn: 'warning',
      animated: false,
    })
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
    if (result.info.width < 100 || result.info.height < 100 || result.data.length > 2097152)
      throw new Error('Image dimensions or size')
    return result
  } catch {
    throw createError({
      statusCode: 422,
      message:
        'server.PHOTO_UNREADABLE',
    })
  }
}
export async function decodeBrandLogo(bytes: Buffer) {
  try {
    const result = await sharp(bytes, {
      limitInputPixels: 16000000,
      failOn: 'warning',
      animated: false,
    })
      .rotate()
      .ensureAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true })
    if (result.info.width < 100 || result.info.height < 100 || result.data.length > 2097152)
      throw new Error('Logo dimensions or size')
    return result
  } catch {
    throw createError({
      statusCode: 422,
      message:
        'server.LOGO_UNREADABLE',
    })
  }
}
export function postFingerprint(post: Post) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        post.id,
        post.title,
        post.caption,
        post.channel,
        post.format,
        post.image,
        post.pillar,
      ]),
    )
    .digest('hex')
}
export async function localPostChecks(
  post: Post,
  businessId: string,
  db: Pool | PoolClient = database(),
): Promise<PostCheck[]> {
  const limits = await postLimits(db)
  const match = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(post.image)
  const asset = match
    ? (
        await db.query(
          'SELECT rights,COALESCE(size_bytes, octet_length(bytes))::integer AS size,width,height FROM assets WHERE id=$1 AND business_id=$2',
          [match[1], businessId],
        )
      ).rows[0]
    : null
  const ratio = asset?.width && asset?.height ? asset.width / asset.height : 0
  // What reaches the channel for a video post is the rendered file, not the
  // still, so publishing one before the render finished would send nothing.
  const render = post.video
    ? (
        await db.query(
          "SELECT status FROM video_renders WHERE post_id=$1 AND business_id=$2 AND storage_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
          [post.id, businessId],
        )
      ).rows[0]
    : null
  const aiChecks: PostCheck[] = []
  if (post.aiProvenance) {
    const provenance = post.aiProvenance
    const source = await db.query(
      `SELECT p.evidence,b.state,
      (SELECT snapshot FROM post_content_versions v WHERE v.business_id=p.business_id AND v.post_id=$4 AND v.content_version=1) AS initial_content,
      EXISTS(SELECT 1 FROM assets a WHERE a.business_id=p.business_id AND a.id=$3 AND a.rights=true) AS original_rights
      FROM monthly_plans p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1 AND p.business_id=$2`,
      [provenance.planId, businessId, provenance.assetId, post.id],
    )
    const row = source.rows[0]
    const originalFacts = (row?.evidence?.brand?.facts || []) as BrandFact[]
    const currentFacts = (row?.state?.brand?.facts || []) as BrandFact[]
    const intendedDay = dayInZone(
      post.scheduledAt || post.proposedAt || new Date(),
      row?.state?.preferences?.timezone || 'Europe/Belgrade',
    )
    const today = dayInZone(new Date(), row?.state?.preferences?.timezone || 'Europe/Belgrade')
    // Delayed publication cannot keep an expired offer valid by its old schedule.
    const useDay = intendedDay > today ? intendedDay : today
    aiChecks.push({
      key: 'ai_evidence',
      // Provenance drift is a warning for the human approver, not a veto over
      // their explicit confirmation. Technical media and format checks below
      // remain blocking.
      advisory: true,
      passed:
        !!row?.original_rights &&
        provenance.factIds.every((id) => {
          const original = originalFacts.find((fact) => fact.id === id)
          return (
            !!original &&
            currentFacts.some(
              (fact) =>
                fact.id === id && factIsUsable(fact, useDay) && sameFactContent(fact, original),
            )
          )
        }),
      message: 'server.SOURCE_MATERIAL_CHANGED',
    })
    let quality = null
    if (row?.state?.brand) {
      const language = (row.state.preferences?.locale === 'en-US' ? 'en' : 'sq') as 'en' | 'sq'
      const review = await db.query(
        "SELECT result FROM monthly_ai_runs WHERE business_id=$1 AND plan_id=$2 AND stage_key=$3 AND status='completed' AND actual_cost_micro_eur<=reserved_cost_micro_eur",
        [
          businessId,
          provenance.planId,
          qualityReviewKey(post, postFingerprint(post), row.state.brand, useDay, language),
        ],
      )
      if (review.rows[0]) {
        try {
          quality = reviewedQuality(review.rows[0].result)
        } catch {
          /* Malformed reviews fail closed. */
        }
      } else if (
        postContentVersion(post) === 1 &&
        row.initial_content &&
        postFingerprint({ ...post, ...row.initial_content }) === postFingerprint(post) &&
        qualityBrandHash({
          ...row.state.brand,
          facts: currentFacts.filter((fact) =>
            originalFacts.some((original) => original.id === fact.id),
          ),
        }) === qualityBrandHash(row.evidence.brand)
      ) {
        quality = provenance.quality
      }
    }
    aiChecks.push({
      key: 'ai_quality',
      passed:
        !!quality &&
        quality.factuality &&
        quality.brandFit &&
        quality.visualQuality,
      // AI quality is guidance for the human approver. Keep the finding
      // visible, but do not block approval or scheduling when it is missing
      // or negative.
      advisory: true,
      message:
        quality?.reasons.join(' ') ||
        'server.AI_QUALITY_REVIEW_NEEDED',
    })
  }
  return [
    ...aiChecks,
    {
      key: 'caption',
      passed: !!post.caption.trim() && [...post.caption].length <= limits.caption_characters,
      message: 'server.CAPTION_LENGTH',
      params: { max: limits.caption_characters },
    },
    {
      key: 'placeholders',
      passed:
        !/\{\{[^}]+\}\}|\[(?:emri|produkti|çmimi|cmimi|oferta|data|orari|biznesi|përshkrimi|pershkrimi)[^\]]*\]/iu.test(
          post.caption,
        ),
      message: 'server.REPLACE_TEMPLATE_FIELDS',
    },
    {
      key: 'rights',
      passed: !!asset?.rights,
      message: 'server.BUSINESS_PHOTO_RIGHTS_REQUIRED',
    },
    {
      key: 'image',
      passed: !!asset?.width && asset.size <= limits.image_bytes,
      message: 'server.PHOTO_READABLE_SIZE_REQUIRED',
    },
    {
      key: 'format',
      passed: channelFormatCapability(post.channel, post.format).supported,
      message: 'server.SINGLE_PHOTO_PER_POST',
    },
    ...(post.video
      ? [
          {
            key: 'video_render',
            passed: render?.status === 'ready',
            message: 'server.VIDEO_REQUIRED_FOR_PUBLISHING',
          },
        ]
      : []),
    {
      key: 'instagram_size',
      passed:
        // A video post publishes its 9:16 render, so the 4:5 still it was
        // composed from is not what Instagram has to accept.
        post.channel !== 'Instagram' ||
        !!post.video ||
        (!!asset &&
          asset.width >= limits.minimum_width &&
          asset.width <= limits.maximum_width &&
          ratio >= limits.minimum_aspect_ratio &&
          ratio <= limits.maximum_aspect_ratio),
      message: 'server.INSTAGRAM_DIMENSIONS',
      params: { minW: limits.minimum_width, maxW: limits.maximum_width, minAR: limits.minimum_aspect_ratio, maxAR: limits.maximum_aspect_ratio },
    },
    {
      key: 'hashtags',
      passed:
        post.channel !== 'Instagram' ||
        (post.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length <= limits.max_hashtags,
      message: 'server.INSTAGRAM_HASHTAG_LIMIT',
      params: { max: limits.max_hashtags },
    },
  ]
}
export async function providerPostChecks(
  post: Post,
  businessId: string,
  options: { throwProviderFailure?: boolean; db?: Pool | PoolClient } = {},
): Promise<PostCheck[]> {
  try {
    const connection = await connectedMeta(businessId, options.db)
    const permission =
      post.channel === 'Instagram' ? 'instagram_content_publish' : 'pages_manage_posts'
    if (!connection.scopes.includes(permission))
      return [
        {
          key: 'meta_permission',
          passed: false,
          message: 'server.RECONNECT_WITH_PUBLISH_PERMISSION',
        },
      ]
    const token = decryptMetaToken(connection.page_token_ciphertext, businessId)
    const page = await graphRequest<{ id: string; instagram_business_account?: { id: string } }>(
      connection.page_id,
      token,
      { fields: 'id,instagram_business_account' },
    )
    if (
      page.id !== connection.page_id ||
      (post.channel === 'Instagram' &&
        (!connection.instagram_id ||
          page.instagram_business_account?.id !== connection.instagram_id))
    )
      return [
        {
          key: 'meta_identity',
          passed: false,
          message: 'server.LINKED_PROFILE_CHANGED',
        },
      ]
    if (post.channel === 'Instagram') {
      const quota = await graphRequest<{
        data: { quota_usage: number; config: { quota_total: number } }[]
      }>(`${connection.instagram_id}/content_publishing_limit`, token, {
        fields: 'quota_usage,config',
      })
      const limit = quota.data?.[0]
      if (
        !limit ||
        !Number.isFinite(limit.config?.quota_total) ||
        limit.quota_usage >= limit.config.quota_total
      )
        return [
          {
            key: 'meta_quota',
            passed: false,
            message: 'server.INSTAGRAM_RATE_LIMIT',
          },
        ]
    }
    return [
      { key: 'meta', passed: true, message: 'server.META_CONFIRMED_ACCESS' },
    ]
  } catch (error) {
    if (error instanceof MetaFailure && error.code === 190)
      await (options.db || database()).query(
        "UPDATE meta_connections SET status='expired',updated_at=now() WHERE business_id=$1",
        [businessId],
      )
    if (error instanceof MetaFailure && options.throwProviderFailure) throw error
    return [
      {
        key: 'meta',
        passed: false,
        message: metaConfigured()
          ? 'Meta nuk konfirmoi qasjen. Kontrollo lidhjen dhe provo sërish.'
          : 'Lidhja me Meta ende nuk është aktivizuar nga platforma.',
      },
    ]
  }
}
export async function requireFreshValidation(
  post: Post,
  businessId: string,
  db: Pool | PoolClient,
  scope: 'content' | 'publication' = 'content',
) {
  const valid = await db.query(
    "SELECT id FROM post_validations WHERE post_id=$1 AND business_id=$2 AND content_version=$3 AND fingerprint=$4 AND result->>'passed'='true' AND ($5='content' OR COALESCE(result->>'scope','publication')='publication') AND created_at>now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1",
    [post.id, businessId, postContentVersion(post), postFingerprint(post), scope],
  )
  if (!valid.rows.length)
    throw createError({
      statusCode: 422,
      message:
        scope === 'publication'
          ? 'Kontrollo lidhjen me Meta përpara publikimit. Kontrolli duhet të jetë i suksesshëm dhe i freskët.'
          : 'Rikontrollo përmbajtjen përpara miratimit. Nuk kërkohet lidhje me Meta.',
    })
}

export async function requireCurrentApproval(
  post: Post,
  businessId: string,
  db: Pool | PoolClient,
) {
  const approval = await db.query(
    'SELECT decision FROM post_approval_records WHERE post_id=$1 AND business_id=$2 AND content_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
    [post.id, businessId, postContentVersion(post)],
  )
  if (approval.rows[0]?.decision !== 'approved')
    throw createError({
      statusCode: 422,
      message: 'server.APPROVE_CONTENT_BEFORE_SCHEDULING',
    })
}
