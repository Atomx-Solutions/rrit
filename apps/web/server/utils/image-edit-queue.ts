import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import { contentLocaleForPreferences, postSchema, type Post } from '../../shared/schemas/workspace'
import { channelCanvas } from '../../shared/schemas/channel-format'
import { audienceLanguageFromResearch } from './audience-language'
import { normalizeGeneratedCreative } from './image-processing'
import { monthlyImageCall, postImageEditPrompt } from './monthly-ai'
import { loadBrandLogo } from './brand-assets'
import { monthlyWorkerDatabase } from './monthly-planner'
import {
  evidenceHash,
  imageEditQueueSettings,
  PlannerFailure,
  plannerMessageKey,
  plannerRunSettings,
  runClaimedJobs,
} from './monthly-planner-domain'
import { postContentVersion, postContentSnapshot, postFingerprint } from './post-validation'
import { assetStorageFolder, assetStoragePath, downloadAsset, removeAsset, uploadAsset } from './asset-storage'

function warnQueue(message: string, error: unknown) {
  console.warn(message, {
    error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
  })
}

function sourceAssetIdOf(post: Post) {
  const parsed = z.uuid().safeParse(post.image.replace('/api/media/', ''))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.PHOTO_MUST_BE_SAVED_FIRST' })
  return parsed.data
}

/**
 * Queue an "Edit with AI" of a post's photo. Everything that can refuse the
 * edit is checked here, so the business is told at once; the image model is
 * called later by a planner run, as many at once as IMAGE_EDIT_CONCURRENCY.
 */
export function queueImageEdit(userId: string, postId: string, input: { contentVersion: number; instruction: string }) {
  return withBusinessTransaction(userId, async (client, business) => {
    await requireEntitlement(business.id, 'posts', client)
    await requireEntitlement(business.id, 'media', client)
    await requireEntitlement(business.id, 'ai', client)
    const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [postId, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (!post.aiProvenance || !['draft', 'review'].includes(post.status))
      throw createError({ statusCode: 422, message: 'server.REOPEN_AS_DRAFT' })
    // A video post's photo is its video's opening frame; the video is edited
    // through "Edit video with AI" instead.
    if (post.video)
      throw createError({ statusCode: 409, message: 'server.CREATIVE_EDIT_UNAVAILABLE_FOR_VIDEO' })
    if (postContentVersion(post) !== input.contentVersion)
      throw createError({ statusCode: 409, message: 'server.POST_CHANGED' })
    const source = await client.query(
      'SELECT 1 FROM assets WHERE business_id=$1 AND id=$2 AND rights=true',
      [business.id, sourceAssetIdOf(post)],
    )
    if (!source.rowCount)
      throw createError({ statusCode: 422, message: 'server.PHOTO_RIGHTS_EXPIRED' })
    const edit = await client.query<{ id: string }>(
      `INSERT INTO image_edits(business_id,post_id,requested_by,instruction,content_version,status)
       VALUES($1,$2,$3,$4,$5,'queued') RETURNING id`,
      [business.id, postId, userId, input.instruction, input.contentVersion],
    ).catch((error: unknown) => {
      // One edit at a time for a post: a second request finds the first.
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
        throw createError({ statusCode: 409, message: 'server.IMAGE_EDIT_IN_PROGRESS' })
      throw error
    })
    return { editId: edit.rows[0]!.id, status: 'queued' as const }
  })
}

/** A queued edit a planner run has claimed, with the lease that fences it. */
export type ClaimedImageEdit = {
  id: string
  postId: string
  businessId: string
  requestedBy: string
  instruction: string
  contentVersion: number
  leaseOwner: string
}

/**
 * Takes the oldest queued edit, unless IMAGE_EDIT_CONCURRENCY edits already
 * hold a live lease. A business with `perBusiness` edits under way is passed
 * over for the next business in line. Claims are taken one at a time, so two
 * runs can never both read room for one more edit and both take it.
 */
export async function claimImageEdit(
  db: Pool,
  leaseOwner: string,
  leaseUntil: Date,
  concurrency: number,
  perBusiness = imageEditQueueSettings().perBusiness,
): Promise<ClaimedImageEdit | undefined> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('image_edits.claim'))")
    const active = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM image_edits WHERE status='editing' AND lease_until>now()",
    )
    if ((active.rows[0]?.count || 0) >= concurrency) {
      await client.query('COMMIT')
      return undefined
    }
    const claimed = await client.query<{
      id: string
      post_id: string
      business_id: string
      requested_by: string
      instruction: string
      content_version: number
    }>(
      `UPDATE image_edits SET status='editing',lease_owner=$1,lease_until=$2
        WHERE id=(
          SELECT queued.id FROM image_edits AS queued
           WHERE queued.status='queued'
             AND (
               SELECT count(*) FROM image_edits AS active
                WHERE active.business_id=queued.business_id
                  AND active.status='editing' AND active.lease_until>now()
             ) < $3
           ORDER BY queued.created_at,queued.id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id,post_id,business_id,requested_by,instruction,content_version`,
      [leaseOwner, leaseUntil, perBusiness],
    )
    await client.query('COMMIT')
    const row = claimed.rows[0]
    return row && {
      id: row.id,
      postId: row.post_id,
      businessId: row.business_id,
      requestedBy: row.requested_by,
      instruction: row.instruction,
      contentVersion: row.content_version,
      leaseOwner,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function failureKey(error: unknown) {
  if (error instanceof PlannerFailure) return plannerMessageKey(error.code, 'planner.creativeFailed')
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
  return /^server\.[A-Z0-9_]+$/.test(message) ? message : 'creative.error'
}

async function failImageEdit(db: Pool, job: ClaimedImageEdit, reason: string) {
  await db.query(
    `UPDATE image_edits SET status='failed',failure_reason=$3,completed_at=now(),lease_owner=NULL,lease_until=NULL
      WHERE id=$1 AND lease_owner=$2 AND status='editing'`,
    [job.id, job.leaseOwner, reason],
  )
}

/** Makes a claimed edit and saves it on the post, or records why it failed. */
export async function runClaimedImageEdit(job: ClaimedImageEdit, db: Pool = monthlyWorkerDatabase()) {
  try {
    await editImage(job)
  } catch (error) {
    warnQueue('A photo edit failed', error)
    await failImageEdit(db, job, failureKey(error))
  }
}

async function editImage(job: ClaimedImageEdit) {
  const snapshot = await withBusinessTransaction(job.requestedBy, async (client, business) => {
    if (business.id !== job.businessId)
      throw createError({ statusCode: 409, message: 'server.BUSINESS_CHANGED' })
    const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [job.postId, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (!post.aiProvenance || post.video || postContentVersion(post) !== job.contentVersion)
      throw createError({ statusCode: 409, message: 'server.POST_CHANGED' })
    const sourceAssetId = sourceAssetIdOf(post)
    const source = await client.query(
      'SELECT storage_path,bytes,mime FROM assets WHERE business_id=$1 AND id=$2 AND rights=true',
      [business.id, sourceAssetId],
    )
    if (!source.rowCount)
      throw createError({ statusCode: 422, message: 'server.PHOTO_RIGHTS_EXPIRED' })
    const { workspace, slug } = await loadWorkspace(client, business.id, job.requestedBy)
    const planResearch = await client.query<{ research: unknown }>(
      'SELECT research FROM monthly_plans WHERE id=$1 AND business_id=$2',
      [post.aiProvenance.planId, business.id],
    )
    return {
      post,
      workspace,
      workspaceSlug: slug,
      language: audienceLanguageFromResearch(
        planResearch.rows[0]?.research,
        contentLocaleForPreferences(workspace.preferences),
        post.aiProvenance.locale,
      ),
      sourceAssetId,
      sourceBytes: source.rows[0].storage_path
        ? await downloadAsset(source.rows[0].storage_path)
        : (source.rows[0].bytes as Buffer),
      sourceMime: source.rows[0].mime as string,
      brandLogo: await loadBrandLogo(client, business.id),
    }
  })
  const provenance = snapshot.post.aiProvenance!
  const prompt = postImageEditPrompt({
    brand: snapshot.workspace.brand,
    post: {
      channel: snapshot.post.channel,
      title: snapshot.post.title,
      caption: snapshot.post.caption,
      pillar: snapshot.post.pillar,
      creative: provenance.creative,
      rationale: provenance.rationale,
    },
    instruction: job.instruction,
    language: snapshot.language,
    logoAvailable: Boolean(snapshot.brandLogo),
    video: false,
  })
  const { generated, bytes } = await (async () => {
    try {
      const generated = await monthlyImageCall(database(), {
        planId: provenance.planId,
        businessId: job.businessId,
        stageKey: `user-image-edit:${job.postId}:${job.contentVersion}:${evidenceHash({ sourceAssetId: snapshot.sourceAssetId, instruction: job.instruction })}`,
        prompt,
        channel: snapshot.post.channel,
        reference: snapshot.sourceBytes,
        referenceMime: ['image/jpeg', 'image/png', 'image/webp'].includes(snapshot.sourceMime)
          ? (snapshot.sourceMime as 'image/jpeg' | 'image/png' | 'image/webp')
          : 'image/jpeg',
        allowPaused: true,
        tenant: { userId: job.requestedBy, organizationId: job.businessId },
      })
      return {
        generated,
        bytes: await normalizeGeneratedCreative(generated.bytes, snapshot.post.channel, snapshot.brandLogo?.bytes),
      }
    } finally {
      snapshot.brandLogo?.bytes.fill(0)
    }
  })()
  const assetId = randomUUID()
  const storagePath = assetStoragePath(
    assetStorageFolder(snapshot.workspaceSlug, job.businessId),
    `${snapshot.post.title}-${assetId}`,
  )
  await uploadAsset(storagePath, bytes)
  try {
    await withBusinessTransaction(job.requestedBy, async (client, business) => {
      if (business.id !== job.businessId)
        throw createError({ statusCode: 409, message: 'server.BUSINESS_CHANGED' })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
      // Fenced by the lease: a run that lost this edit to another saves nothing.
      const owned = await client.query(
        "UPDATE image_edits SET status='ready',completed_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND status='editing'",
        [job.id, job.leaseOwner],
      )
      if (!owned.rowCount) throw createError({ statusCode: 409, message: 'server.IMAGE_EDIT_LEASE_LOST' })
      const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [job.postId, business.id])
      const previous = row.rows[0] ? postSchema.parse(row.rows[0].payload) : null
      if (!previous?.aiProvenance || postContentVersion(previous) !== job.contentVersion || previous.image !== snapshot.post.image)
        throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_GENERATION' })
      await requireQuota(business.id, 'media_storage_bytes', bytes.length, client)
      const createdAt = new Date().toISOString()
      const post = postSchema.parse({
        ...previous,
        image: `/api/media/${assetId}`,
        status: 'draft',
        policy: 'warn',
        policyReason: 'server.PHOTO_AI_REDESIGNED',
        scheduledAt: null,
        publicationMode: 'manual',
        version: previous.version + 1,
        contentVersion: postContentVersion(previous) + 1,
        history: [...previous.history, { version: previous.version, caption: previous.caption, at: createdAt }],
        aiProvenance: {
          ...previous.aiProvenance,
          reasoning: previous.aiProvenance.reasoning ? {
            ...previous.aiProvenance.reasoning,
            design: `${previous.aiProvenance.reasoning.design}\nRidizajnim origjinal me AI: ${job.instruction}`,
          } : undefined,
          imageGeneration: { model: generated.model, quality: generated.quality, promptHash: generated.promptHash },
          revision: { instruction: job.instruction, sourceAssetId: snapshot.sourceAssetId, createdAt },
        },
      })
      const canvas = channelCanvas(snapshot.post.channel)
      await client.query(
        `INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height,creative_provenance)
         VALUES($1,$2,$3,'["monthly-creative","ai-edited"]',true,'image/jpeg',NULL,$4,$5,$6,$7,$8)`,
        [assetId, business.id, post.title, storagePath, bytes.length, canvas.width, canvas.height, JSON.stringify({ ...post.aiProvenance, editedBy: job.requestedBy, editSourceAssetId: snapshot.sourceAssetId })],
      )
      await client.query('UPDATE posts SET payload=$1,content_version=$2,updated_at=now() WHERE id=$3 AND business_id=$4', [JSON.stringify(post), postContentVersion(post), post.id, business.id])
      await client.query(
        "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,$3,$4,$5,'editor',$6)",
        [post.id, business.id, postContentVersion(post), postFingerprint(post), JSON.stringify(postContentSnapshot(post)), job.requestedBy],
      )
      await client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [business.id])
      await client.query(
        "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'creative.ai_edited','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
        [business.id, job.requestedBy, job.postId],
      )
    })
  } catch (error) {
    await removeAsset(storagePath).catch((cleanupError: unknown) =>
      console.error('Failed to clean up AI-edited asset after rollback', { storagePath, error: cleanupError }))
    throw error
  }
}

// Edits whose lease expired belong to runs that were stopped mid-edit. The
// image call settles its own credits the next time its stage is read.
async function settleStoppedEdits(db: Pool) {
  await db.query(
    `UPDATE image_edits SET status='failed',failure_reason='server.IMAGE_EDIT_STOPPED',completed_at=now(),lease_owner=NULL,lease_until=NULL
      WHERE status='editing' AND lease_until<now()`,
  )
}

/**
 * Makes queued photo edits until `deadline` (epoch ms). Up to
 * IMAGE_EDIT_CONCURRENCY run at once, and one is started only while
 * IMAGE_EDIT_MIN_SECONDS of the run are still left. Leases follow the video
 * queue's: with a deadline they end a margin after it, otherwise they are renewed.
 */
export async function runImageEditQueue(
  db: Pool = monthlyWorkerDatabase(),
  options: { deadline?: number; waitWhile?: () => boolean } = {},
) {
  const lease = plannerRunSettings()
  const settings = imageEditQueueSettings()
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY
  const bounded = Number.isFinite(deadline)
  const leaseUntil = () =>
    new Date(bounded ? deadline + lease.leaseMarginMs : Date.now() + lease.leaseMs)
  const leaseOwner = randomUUID()
  const renewal = bounded
    ? undefined
    : setInterval(() => {
        void db
          .query("UPDATE image_edits SET lease_until=$2 WHERE lease_owner=$1 AND status='editing'", [leaseOwner, leaseUntil()])
          .catch((error: unknown) => warnQueue('Photo edit lease renewal was interrupted.', error))
      }, 30000)
  renewal?.unref()
  try {
    await settleStoppedEdits(db)
    await runClaimedJobs<ClaimedImageEdit>({
      concurrency: settings.concurrency,
      deadline,
      minStepMs: settings.minEditMs,
      idleMs: settings.pollMs,
      waitWhile: options.waitWhile,
      claim: () => claimImageEdit(db, leaseOwner, leaseUntil(), settings.concurrency, settings.perBusiness),
      run: (job) => runClaimedImageEdit(job, db),
      onError: (error) => warnQueue('A queued photo edit could not be claimed or made', error),
    })
  } finally {
    if (renewal) clearInterval(renewal)
  }
}
