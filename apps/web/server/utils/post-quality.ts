import type { Pool, PoolClient } from 'pg'
import { postSchema } from '../../shared/schemas/workspace'
import { qualitySchema } from '../../shared/schemas/monthly-plan'
import { factIsUsable } from '../../shared/schemas/business-brain'
import { setTenantContext, type TenantContext } from './database'
import {
  localPostChecks,
  postContentVersion,
  postFingerprint,
  postContentSnapshot,
} from './post-validation'
import { monthlyProviderCall } from './monthly-ai'
import { PlannerFailure } from './monthly-planner-domain'
import {
  qualityBrandHash,
  qualityReviewKey,
  qualityReviewDay,
  reviewedQuality,
} from './post-quality-domain'

async function tenantTransaction<T>(
  db: Pool,
  tenant: TenantContext,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, tenant)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
export async function reviewPostQuality(
  db: Pool,
  tenant: TenantContext,
  postId: string,
  version: number,
) {
  const snapshot = await tenantTransaction(db, tenant, async (client) => {
    const result = await client.query(
      'SELECT p.payload,b.state FROM posts p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1 AND p.business_id=$2 AND b.owner_id=$3',
      [postId, tenant.organizationId, tenant.userId],
    )
    if (!result.rows[0]) throw new PlannerFailure('POST_NOT_FOUND')
    const post = postSchema.parse(result.rows[0].payload)
    if (!post.aiProvenance || !['draft', 'review'].includes(post.status))
      throw new PlannerFailure('POST_NOT_EDITABLE')
    if (postContentVersion(post) !== version) throw new PlannerFailure('POST_CHANGED')
    const checks = await localPostChecks(post, tenant.organizationId, client)
    if (checks.some((check) => check.key !== 'ai_quality' && !check.passed))
      throw new PlannerFailure('CONTENT_CHECKS_REQUIRED')
    const brand = result.rows[0].state.brand
    const timezone = result.rows[0].state.preferences.timezone
    const day = qualityReviewDay(post, timezone)
    const assets = await client.query(
      'SELECT id,bytes FROM assets WHERE business_id=$1 AND id=ANY($2::uuid[]) AND rights=true',
      [tenant.organizationId, [post.image.replace('/api/media/', ''), post.aiProvenance.assetId]],
    )
    const original = assets.rows.find((asset) => asset.id === post.aiProvenance!.assetId)
    const current = assets.rows.find((asset) => `/api/media/${asset.id}` === post.image)
    if (!original || !current) throw new PlannerFailure('EVIDENCE_CHANGED')
    return {
      post,
      brand,
      day,
      language: (result.rows[0].state.preferences.locale === 'en-US' ? 'en' : 'sq') as 'en' | 'sq',
      original: original.bytes as Buffer,
      image: current.bytes as Buffer,
    }
  })
  const fingerprint = postFingerprint(snapshot.post)
  const brandHash = qualityBrandHash(snapshot.brand)
  const raw = await monthlyProviderCall(db, {
    tenant,
    businessId: tenant.organizationId,
    planId: snapshot.post.aiProvenance!.planId,
    stageKey: qualityReviewKey(
      snapshot.post,
      fingerprint,
      snapshot.brand,
      snapshot.day,
      snapshot.language,
    ),
    capability: 'quality',
    language: snapshot.language,
    schema: qualitySchema,
    maxOutput: 2000,
    input: {
      brand: {
        ...snapshot.brand,
        facts: snapshot.brand.facts.filter((fact: Parameters<typeof factIsUsable>[0]) =>
          factIsUsable(fact, snapshot.day),
        ),
      },
      content: postContentSnapshot(snapshot.post),
      intendedDay: snapshot.day,
      brief: snapshot.post.aiProvenance!.rationale,
      imageOrder: ['Current edited creative', 'Original owned photograph'],
    },
    images: [snapshot.image, snapshot.original].map(
      (bytes) => `data:image/jpeg;base64,${bytes.toString('base64')}`,
    ),
  })
  const quality = reviewedQuality(raw)
  return tenantTransaction(db, tenant, async (client) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [tenant.organizationId])
    const current = await client.query(
      'SELECT p.payload,b.state FROM posts p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1 AND p.business_id=$2',
      [postId, tenant.organizationId],
    )
    const post = current.rows[0] && postSchema.parse(current.rows[0].payload)
    if (
      !post ||
      postContentVersion(post) !== version ||
      postFingerprint(post) !== fingerprint ||
      qualityBrandHash(current.rows[0].state.brand) !== brandHash ||
      qualityReviewDay(post, current.rows[0].state.preferences.timezone) !== snapshot.day ||
      !['draft', 'review'].includes(post.status)
    )
      throw new PlannerFailure('POST_CHANGED')
    const checks = await localPostChecks(post, tenant.organizationId, client)
    if (checks.some((check) => check.key !== 'ai_quality' && !check.passed))
      throw new PlannerFailure('EVIDENCE_CHANGED')
    const language = current.rows[0].state.preferences.locale === 'en-US' ? 'en' : 'sq'
    const policyReason =
      quality.reasons.join(' ') ||
      (language === 'en'
        ? 'Review the facts and design before approval.'
        : 'Kontrollo faktet dhe dizajnin përpara miratimit.')
    await client.query(
      "UPDATE posts SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{policy}',to_jsonb($1::text)),'{policyReason}',to_jsonb($2::text)),'{aiProvenance,quality}',$5::jsonb) WHERE id=$3 AND business_id=$4",
      [
        quality.factuality ? 'warn' : 'block',
        policyReason,
        postId,
        tenant.organizationId,
        JSON.stringify(quality),
      ],
    )
    await client.query(
      "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'post.quality_reviewed','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
      [tenant.organizationId, tenant.userId, postId],
    )
    return { quality, contentVersion: version, fingerprint }
  })
}

// Reads only a completed review whose cache key still describes the exact
// current draft. It never calls the provider or exposes an older review as
// authorization for edited content.
export async function currentPostQuality(
  db: Pool,
  tenant: TenantContext,
  postId: string,
) {
  return tenantTransaction(db, tenant, async (client) => {
    const result = await client.query(
      'SELECT p.payload,b.state FROM posts p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1 AND p.business_id=$2 AND b.owner_id=$3',
      [postId, tenant.organizationId, tenant.userId],
    )
    if (!result.rows[0]) throw new PlannerFailure('POST_NOT_FOUND')
    const post = postSchema.parse(result.rows[0].payload)
    const contentVersion = postContentVersion(post)
    if (!post.aiProvenance)
      return { contentVersion, quality: null, reviewedAt: null as string | null }
    const timezone = result.rows[0].state.preferences.timezone
    const language = (result.rows[0].state.preferences.locale === 'en-US' ? 'en' : 'sq') as
      | 'en'
      | 'sq'
    const day = qualityReviewDay(post, timezone)
    const review = await client.query(
      "SELECT result,completed_at FROM monthly_ai_runs WHERE business_id=$1 AND plan_id=$2 AND stage_key=$3 AND status='completed' AND actual_cost_micro_eur<=reserved_cost_micro_eur",
      [
        tenant.organizationId,
        post.aiProvenance.planId,
        qualityReviewKey(
          post,
          postFingerprint(post),
          result.rows[0].state.brand,
          day,
          language,
        ),
      ],
    )
    if (!review.rows[0]) return { contentVersion, quality: null, reviewedAt: null as string | null }
    try {
      return {
        contentVersion,
        quality: reviewedQuality(review.rows[0].result),
        reviewedAt: new Date(review.rows[0].completed_at as string | Date).toISOString(),
      }
    } catch {
      // Corrupt or incomplete provider data is never presented as a passing review.
      return { contentVersion, quality: null, reviewedAt: null as string | null }
    }
  })
}
