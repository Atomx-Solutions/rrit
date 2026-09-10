import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import type { Post } from '../../shared/schemas/workspace'
import { channelFormatCapability } from '../../shared/utils/content-formats'
import {
  connectedMeta,
  decryptMetaToken,
  graphRequest,
  MetaFailure,
  metaConfigured,
} from './meta'

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
export type PostCheck = { key: string; passed: boolean; message: string }
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
  return [
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
    "SELECT decision FROM post_approval_records WHERE post_id=$1 AND business_id=$2 AND content_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [post.id, businessId, postContentVersion(post)],
  )
  if (approval.rows[0]?.decision !== 'approved')
    throw createError({
      statusCode: 422,
      message: 'Mirato versionin aktual të përmbajtjes përpara planifikimit.',
    })
}
