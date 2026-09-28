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
    throw createError({ statusCode: 503, message: 'Kufijtë e postimeve nuk janë konfiguruar.' })
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
        'Fotografia nuk mund të lexohet. Ngarko një JPG të vlefshëm, të paktën 100 × 100 pikselë dhe deri në 2 MB.',
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
        'Logoja nuk mund të lexohet. Ngarko PNG, JPG ose WebP të vlefshëm, të paktën 100 × 100 pikselë dhe deri në 2 MB.',
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
      message: 'Faktet ose të drejtat e materialit burimor kanë ndryshuar. Rishiko përmbajtjen AI.',
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
        'Versioni aktual kërkon rishikim të tekstit dhe dizajnit me AI.',
    })
  }
  return [
    ...aiChecks,
    {
      key: 'caption',
      passed: !!post.caption.trim() && [...post.caption].length <= limits.caption_characters,
      message: `Teksti duhet të ketë 1–${limits.caption_characters} karaktere.`,
    },
    {
      key: 'placeholders',
      passed:
        !/\{\{[^}]+\}\}|\[(?:emri|produkti|çmimi|cmimi|oferta|data|orari|biznesi|përshkrimi|pershkrimi)[^\]]*\]/iu.test(
          post.caption,
        ),
      message: 'Zëvendëso fushat e modelit me informacionin e biznesit.',
    },
    {
      key: 'rights',
      passed: !!asset?.rights,
      message: 'Përdor një fotografi të biznesit me të drejta të konfirmuara.',
    },
    {
      key: 'image',
      passed: !!asset?.width && asset.size <= limits.image_bytes,
      message: 'Fotografia duhet të jetë e lexueshme dhe brenda kufirit të madhësisë.',
    },
    {
      key: 'format',
      passed: channelFormatCapability(post.channel, post.format).supported,
      message: 'Publikimi aktual mbështet një fotografi për postim.',
    },
    {
      key: 'instagram_size',
      passed:
        post.channel !== 'Instagram' ||
        (!!asset &&
          asset.width >= limits.minimum_width &&
          asset.width <= limits.maximum_width &&
          ratio >= limits.minimum_aspect_ratio &&
          ratio <= limits.maximum_aspect_ratio),
      message: `Për Instagram: gjerësi ${limits.minimum_width}–${limits.maximum_width}px dhe raport ${limits.minimum_aspect_ratio}–${limits.maximum_aspect_ratio}. Zgjidh një fotografi katrore ose përshtate paraprakisht.`,
    },
    {
      key: 'hashtags',
      passed:
        post.channel !== 'Instagram' ||
        (post.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length <= limits.max_hashtags,
      message: `Për Instagram lejohen deri në ${limits.max_hashtags} hashtagë sipas konfigurimit të platformës.`,
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
          message: 'Rilidh llogarinë dhe jep lejen për publikimin e postimeve.',
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
          message: 'Profili i lidhur ndryshoi. Zgjidhe përsëri nga lidhjet sociale.',
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
            message: 'Kufiri i publikimeve në Instagram nuk lejon një publikim të ri tani.',
          },
        ]
    }
    return [
      { key: 'meta', passed: true, message: 'Meta konfirmoi llogarinë, lejen dhe qasjen aktuale.' },
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
      message: 'Mirato versionin aktual të përmbajtjes përpara planifikimit.',
    })
}
