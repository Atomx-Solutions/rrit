import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { contentLocaleForPreferences, postSchema } from '../../../../shared/schemas/workspace'
import { channelCanvas } from '../../../../shared/schemas/channel-format'
import { normalizeGeneratedCreative } from '../../../utils/image-processing'
import { monthlyImageCall, postImageEditPrompt } from '../../../utils/monthly-ai'
import { loadBrandLogo } from '../../../utils/brand-assets'
import { evidenceHash, PlannerFailure, plannerMessages } from '../../../utils/monthly-planner-domain'
import { postContentVersion, postContentSnapshot, postFingerprint } from '../../../utils/post-validation'
import {
  assetStorageFolder,
  assetStoragePath,
  downloadAsset,
  removeAsset,
  uploadAsset,
} from '../../../utils/asset-storage'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const input = z.object({
    action: z.literal('ai-edit'),
    contentVersion: z.number().int().positive(),
    instruction: z.string().trim().min(5).max(1200),
  }).safeParse(await boundedBody(event, 4096))
  if (!id.success || !input.success)
    throw createError({ statusCode: 422, message: 'server.DESIGN_DESCRIPTION_REQUIRED' })

  try {
    const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
      await requireEntitlement(business.id, 'posts', client)
      await requireEntitlement(business.id, 'media', client)
      await requireEntitlement(business.id, 'ai', client)
      const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [id.data, business.id])
      if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
      const post = postSchema.parse(row.rows[0].payload)
      if (!post.aiProvenance || !['draft', 'review'].includes(post.status))
        throw createError({ statusCode: 422, message: 'server.REOPEN_AS_DRAFT' })
      // A video post's `image` is the deterministic 9:16 opening frame of its
      // mp4, not an AI creative. Re-running the image AI pipeline here would
      // reintroduce the hidden image-generation call we removed from the
      // planner and would make the gallery poster drift from the actual video.
      // The video re-render flow (POST /api/posts/:id/video-render) is the
      // right path for a video, so this one is rejected outright.
      if (post.video)
        throw createError({ statusCode: 409, message: 'server.CREATIVE_EDIT_UNAVAILABLE_FOR_VIDEO' })
      if (postContentVersion(post) !== input.data.contentVersion)
        throw createError({ statusCode: 409, message: 'server.POST_CHANGED' })
      const sourceAssetId = z.uuid().safeParse(post.image.replace('/api/media/', ''))
      if (!sourceAssetId.success)
        throw createError({ statusCode: 422, message: 'server.PHOTO_MUST_BE_SAVED_FIRST' })
      const source = await client.query(
        'SELECT storage_path,bytes,mime FROM assets WHERE business_id=$1 AND id=$2 AND rights=true',
        [business.id, sourceAssetId.data],
      )
      if (!source.rowCount)
        throw createError({ statusCode: 422, message: 'server.PHOTO_RIGHTS_EXPIRED' })
      const { workspace, slug } = await loadWorkspace(client, business.id, user.id)
      const planResearch = await client.query<{ research: unknown }>(
        'SELECT research FROM monthly_plans WHERE id=$1 AND business_id=$2',
        [post.aiProvenance.planId, business.id],
      )
      const brandLogo = await loadBrandLogo(client, business.id)
      return {
        businessId: business.id,
        post,
        workspace,
        workspaceSlug: slug,
        language: audienceLanguageFromResearch(
          planResearch.rows[0]?.research,
          contentLocaleForPreferences(workspace.preferences),
        ),
        sourceAssetId: sourceAssetId.data,
        sourceBytes: source.rows[0].storage_path
          ? await downloadAsset(source.rows[0].storage_path)
          : (source.rows[0].bytes as Buffer),
        sourceMime: source.rows[0].mime as string,
        brandLogo,
      }
    })
    const prompt = postImageEditPrompt({
      brand: snapshot.workspace.brand,
      post: {
        channel: snapshot.post.channel,
        title: snapshot.post.title,
        caption: snapshot.post.caption,
        pillar: snapshot.post.pillar,
        creative: snapshot.post.aiProvenance!.creative,
        rationale: snapshot.post.aiProvenance!.rationale,
      },
      instruction: input.data.instruction,
      language: snapshot.language,
      logoAvailable: Boolean(snapshot.brandLogo),
      video: Boolean(snapshot.post.video),
    })
    const generatedAndBytes = await (async () => {
      try {
        const generated = await monthlyImageCall(database(), {
          planId: snapshot.post.aiProvenance!.planId,
          businessId: snapshot.businessId,
          stageKey: `user-image-edit:${snapshot.post.id}:${input.data.contentVersion}:${evidenceHash({ sourceAssetId: snapshot.sourceAssetId, instruction: input.data.instruction })}`,
          prompt,
          channel: snapshot.post.channel,
          reference: snapshot.sourceBytes,
          referenceMime: ['image/jpeg', 'image/png', 'image/webp'].includes(snapshot.sourceMime)
            ? (snapshot.sourceMime as 'image/jpeg' | 'image/png' | 'image/webp')
            : 'image/jpeg',
          allowPaused: true,
          tenant: { userId: user.id, organizationId: snapshot.businessId },
        })
        return {
          generated,
          bytes: await normalizeGeneratedCreative(generated.bytes, channelCanvas(snapshot.post.channel), snapshot.brandLogo?.bytes),
        }
      } finally {
        snapshot.brandLogo?.bytes.fill(0)
      }
    })()
    const { generated, bytes } = generatedAndBytes
    const assetId = randomUUID()
    const storagePath = assetStoragePath(
      assetStorageFolder(snapshot.workspaceSlug, snapshot.businessId),
      `${snapshot.post.title}-${assetId}`,
    )
    await uploadAsset(storagePath, bytes)
    try {
      return await withBusinessTransaction(user.id, async (client, business) => {
      if (business.id !== snapshot.businessId)
        throw createError({ statusCode: 409, message: 'server.BUSINESS_CHANGED' })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
      const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id.data, business.id])
      const previous = row.rows[0] ? postSchema.parse(row.rows[0].payload) : null
      if (!previous?.aiProvenance || postContentVersion(previous) !== input.data.contentVersion || previous.image !== snapshot.post.image)
        throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_GENERATION' })
      await requireQuota(business.id, 'media_storage_bytes', bytes.length, client)
      const createdAt = new Date().toISOString()
      const post = postSchema.parse({
        ...previous,
        image: `/api/media/${assetId}`,
        status: 'draft',
        policy: 'warn',
        policyReason: 'Fotografia u redizajnua plotësisht me AI sipas kërkesës tënde. Rishikoje përpara miratimit.',
        scheduledAt: null,
        publicationMode: 'manual',
        version: previous.version + 1,
        contentVersion: postContentVersion(previous) + 1,
        history: [...previous.history, { version: previous.version, caption: previous.caption, at: createdAt }],
        aiProvenance: {
          ...previous.aiProvenance,
          reasoning: previous.aiProvenance.reasoning ? {
            ...previous.aiProvenance.reasoning,
            design: `${previous.aiProvenance.reasoning.design}\nRidizajnim origjinal me AI: ${input.data.instruction}`,
          } : undefined,
          imageGeneration: { model: generated.model, quality: generated.quality, promptHash: generated.promptHash },
          revision: { instruction: input.data.instruction, sourceAssetId: snapshot.sourceAssetId, createdAt },
        },
      })
      const canvas = channelCanvas(snapshot.post.channel)
      await client.query(
        `INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height,creative_provenance)
         VALUES($1,$2,$3,'["monthly-creative","ai-edited"]',true,'image/jpeg',NULL,$4,$5,$6,$7,$8)`,
        [assetId, business.id, post.title, storagePath, bytes.length, canvas.width, canvas.height, JSON.stringify({ ...post.aiProvenance, editedBy: user.id, editSourceAssetId: snapshot.sourceAssetId })],
      )
      await client.query('UPDATE posts SET payload=$1,content_version=$2,updated_at=now() WHERE id=$3 AND business_id=$4', [JSON.stringify(post), postContentVersion(post), post.id, business.id])
      await client.query(
        "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,$3,$4,$5,'editor',$6)",
        [post.id, business.id, postContentVersion(post), postFingerprint(post), JSON.stringify(postContentSnapshot(post)), user.id],
      )
      await client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [business.id])
      await client.query(
        "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'creative.ai_edited','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
        [business.id, user.id, id.data],
      )
      return { business: await loadWorkspace(client, business.id, user.id), image: post.image }
      })
    } catch (error) {
      try {
        await removeAsset(storagePath)
      } catch (cleanupError) {
        console.error('Failed to clean up AI-edited asset after rollback', {
          storagePath,
          error: cleanupError,
        })
      }
      throw error
    }
  } catch (error) {
    if (error instanceof PlannerFailure)
      throw createError({
        statusCode: ['QUOTA_EXCEEDED', 'BUDGET_EXCEEDED'].includes(error.code) ? 429 : 502,
        message: plannerMessages[error.code] || 'Fotografia nuk u rigjenerua. Versioni aktual mbeti i paprekur.',
        data: { code: error.code },
      })
    throw error
  }
})
