import { randomUUID } from 'node:crypto'
import pg, { type Pool, type PoolClient } from 'pg'
import {
  generatedPostSchema,
  qualitySchema,
  editorialPlanSchema,
  researchSchema,
} from '../../shared/schemas/monthly-plan'
import { postSchema } from '../../shared/schemas/workspace'
import { factIsUsable, sameFactContent } from '../../shared/schemas/business-brain'
import { zonedToIso } from '../../shared/utils/format'
import { loadWorkspace } from './workspaces'
import { paidAccessForPlanningMonth, trialStatus } from './trials'
import { setTenantContext } from './database'
import { postContentSnapshot, postFingerprint } from './post-validation'
import { normalizeQualityReview } from './post-quality-domain'
import { assetContactSheet, normalizeGeneratedCreative } from './image-processing'
import {
  monthlyAiConfigured,
  monthlyAutomaticStageKey,
  monthlyImageCall,
  monthlyImagePrompt,
  monthlyProviderCall,
  monthlyPromptVersion,
  researchFromResponse,
  responseText,
} from './monthly-ai'
import {
  PlannerFailure,
  evidenceHash,
  earliestPlanningDate,
  normalizeEditorialPlanResponse,
  parsePersistedEditorialPlan,
  plannerEvidence,
  planningMonth,
  validateEditorialPlan,
  type PlannerEvidence,
} from './monthly-planner-domain'

let workerPool: Pool | undefined
function workerStatementTimeout() {
  const configured = Number(process.env.WORKER_DATABASE_STATEMENT_TIMEOUT_MS || 60000)
  return Number.isFinite(configured) && configured >= 10000 ? Math.floor(configured) : 60000
}

export function monthlyWorkerDatabase() {
  if (!process.env.WORKER_DATABASE_URL) throw new PlannerFailure('CONFIGURATION_REQUIRED')
  if (!workerPool) {
    workerPool = new pg.Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      keepAlive: true,
      // Supabase may need more than the API timeout while reading original image
      // bytes or persisting a generated derivative. Provider calls do not hold a
      // database connection, so this only protects legitimate worker queries.
      statement_timeout: workerStatementTimeout(),
    })
    // PostgreSQL pools emit idle-client failures as events. Registering a safe
    // handler keeps a transient Supavisor reset from becoming an uncaught error.
    workerPool.on('error', (error) => {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code).slice(0, 64)
          : undefined
      console.warn('Monthly planner discarded an interrupted idle database connection.', {
        code,
      })
    })
  }
  return workerPool
}

export async function closeMonthlyWorkerDatabase() {
  const pool = workerPool
  workerPool = undefined
  if (pool) await pool.end()
}

export async function plannerAccess(
  businessId: string,
  month: string,
  timezone: string,
  db: Pool | PoolClient,
) {
  const currentMonth = planningMonth(timezone)
  if (month === currentMonth) return trialStatus(businessId, db)
  const nextMonth = new Date(`${currentMonth}-01T12:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  if (month !== nextMonth.toISOString().slice(0, 7)) return null
  const currentAccess = await trialStatus(businessId, db)
  if (!currentAccess.paid) return null
  return paidAccessForPlanningMonth(businessId, month, db)
}

export async function ensureMonthlyPlan(
  client: PoolClient,
  businessId: string,
  ownerId: string,
  month?: string,
  options: { requeueCancelled?: boolean } = {},
) {
  if (!monthlyAiConfigured()) throw new PlannerFailure('CONFIGURATION_REQUIRED')
  await plannerStep('ensure.business_lock', () =>
    client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId]),
  )
  const { workspace } = await plannerStep('ensure.workspace', () =>
    loadWorkspace(client, businessId, ownerId),
  )
  const currentMonth = planningMonth(workspace.preferences.timezone)
  const nextMonth = new Date(`${currentMonth}-01T12:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  month ||= currentMonth
  if (![currentMonth, nextMonth.toISOString().slice(0, 7)].includes(month))
    throw new PlannerFailure('INVALID_MONTH')
  const prior = await plannerStep('ensure.existing_plan', () =>
    client.query('SELECT id,status FROM monthly_plans WHERE business_id=$1 AND month=$2::date', [
      businessId,
      `${month}-01`,
    ]),
  )
  if (prior.rows[0] && (prior.rows[0].status !== 'cancelled' || !options.requeueCancelled))
    return prior.rows[0] as { id: string; status: string }
  const settings = await plannerStep('ensure.settings', () =>
    client.query(
      'SELECT enabled,photo_mode,preferred_asset_ids,configured_at FROM monthly_planner_settings WHERE business_id=$1',
      [businessId],
    ),
  )
  if (settings.rows[0]?.enabled === false) throw new PlannerFailure('PLANNER_PAUSED')
  if (!settings.rows[0]?.configured_at) throw new PlannerFailure('PHOTO_PREFERENCE_REQUIRED')
  const access = await plannerStep('ensure.access', () =>
    plannerAccess(businessId, month, workspace.preferences.timezone, client),
  )
  if (!access?.features.includes('ai') || !access.features.includes('posts'))
    throw new PlannerFailure('ENTITLEMENT_REQUIRED')
  const existing = await plannerStep('ensure.post_count', () =>
    client.query(
      'SELECT count(*)::integer AS count FROM posts WHERE business_id=$1 AND quota_month=$2::date',
      [businessId, `${month}-01`],
    ),
  )
  const target = Math.min(access.limits.posts_per_month, 100) - existing.rows[0].count
  if (target < 1) throw new PlannerFailure('QUOTA_EXCEEDED')
  const photoSelection = {
    mode: settings.rows[0].photo_mode as 'auto' | 'selected',
    selectedAssetIds: (settings.rows[0].preferred_asset_ids || []) as string[],
  }
  if (photoSelection.selectedAssetIds.length > target)
    throw new PlannerFailure('TOO_MANY_SELECTED_PHOTOS')
  const evidence = plannerEvidence(workspace, new Date(), month, photoSelection)
  const values = [
    businessId,
    `${month}-01`,
    target,
    JSON.stringify(evidence),
    evidenceHash(evidence),
    JSON.stringify({ plan: access.plan, limits: access.limits, paid: access.paid }),
  ]
  const created = await plannerStep('ensure.plan_insert', () =>
    prior.rows[0]
      ? client.query(
          `UPDATE monthly_plans
              SET status='queued',stage='research',target_count=$3,completed_count=0,
                  evidence=$4,evidence_hash=$5,entitlement_snapshot=$6,research=NULL,
                  editorial_plan=NULL,error_code=NULL,next_run_at=now(),updated_at=now()
            WHERE id=$7 AND business_id=$1 AND month=$2::date RETURNING id,status`,
          [...values, prior.rows[0].id],
        )
      : client.query(
          `INSERT INTO monthly_plans(business_id,month,target_count,evidence,evidence_hash,entitlement_snapshot)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status`,
          values,
        ),
  )
  await plannerStep('ensure.audit_insert', () =>
    client.query(
      "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) VALUES($1,$1,$2,'monthly_plan.queued','monthly_plan',$3,'succeeded',$4)",
      [businessId, ownerId, created.rows[0].id, workspace.revision],
    ),
  )
  return created.rows[0] as { id: string; status: string }
}

// A blocked plan with no drafts can be rebuilt from the current Business Brain.
// Completed provider runs deliberately remain as cost/audit records; the changed
// evidence hash in every new stage key prevents their reuse.
export async function restartMonthlyPlan(
  client: PoolClient,
  businessId: string,
  ownerId: string,
  month: string,
) {
  if (!monthlyAiConfigured()) throw new PlannerFailure('CONFIGURATION_REQUIRED')
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
  const { workspace } = await loadWorkspace(client, businessId, ownerId)
  const currentMonth = planningMonth(workspace.preferences.timezone)
  const nextMonth = new Date(`${currentMonth}-01T12:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  if (![currentMonth, nextMonth.toISOString().slice(0, 7)].includes(month))
    throw new PlannerFailure('INVALID_MONTH')
  const plan = await client.query<{
    id: string
    status: string
    stage: string
    completed_count: number
    error_code: string | null
    has_research: boolean
    has_editorial_plan: boolean
  }>(
    `SELECT id,status,stage,completed_count,error_code,
            research IS NOT NULL AS has_research,
            editorial_plan IS NOT NULL AS has_editorial_plan
       FROM monthly_plans WHERE business_id=$1 AND month=$2::date FOR UPDATE`,
    [businessId, `${month}-01`],
  )
  const prior = plan.rows[0]
  if (!prior || prior.status !== 'blocked') throw new PlannerFailure('PLAN_NOT_RESTARTABLE')
  const resumeContent =
    prior.stage === 'content' &&
    prior.has_research &&
    prior.has_editorial_plan &&
    !['EVIDENCE_CHANGED', 'BUDGET_ESTIMATE_EXCEEDED', 'PROVIDER_RETRY_EXHAUSTED'].includes(
      prior.error_code || '',
    )
  if (prior.completed_count > 0 && !resumeContent) throw new PlannerFailure('PLAN_HAS_DRAFTS')
  // An explicit user restart is allowed after an interrupted provider call. A
  // fresh evidence capture creates new stage keys while the ambiguous run stays
  // retained for cost/audit reconciliation. Estimated-cost overruns still need
  // platform review before another paid request can be made.
  if (['BUDGET_ESTIMATE_EXCEEDED', 'PROVIDER_RETRY_EXHAUSTED'].includes(prior.error_code || ''))
    throw new PlannerFailure('PLAN_RECONCILIATION_REQUIRED')
  const settings = await client.query(
    'SELECT enabled,photo_mode,preferred_asset_ids,configured_at FROM monthly_planner_settings WHERE business_id=$1',
    [businessId],
  )
  if (settings.rows[0]?.enabled === false) throw new PlannerFailure('PLANNER_PAUSED')
  if (!settings.rows[0]?.configured_at) throw new PlannerFailure('PHOTO_PREFERENCE_REQUIRED')
  const access = await plannerAccess(businessId, month, workspace.preferences.timezone, client)
  if (!access?.features.includes('ai') || !access.features.includes('posts'))
    throw new PlannerFailure('ENTITLEMENT_REQUIRED')
  const existing = await client.query(
    'SELECT count(*)::integer AS count FROM posts WHERE business_id=$1 AND quota_month=$2::date',
    [businessId, `${month}-01`],
  )
  const target = Math.min(access.limits.posts_per_month, 100) - existing.rows[0].count
  if (target < 1) throw new PlannerFailure('QUOTA_EXCEEDED')
  if (resumeContent) {
    await client.query(
      "UPDATE monthly_plans SET status='queued',error_code=NULL,next_run_at=now(),updated_at=now() WHERE id=$1 AND business_id=$2",
      [prior.id, businessId],
    )
    await client.query(
      "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) VALUES($1,$1,$2,'monthly_plan.resumed','monthly_plan',$3,'succeeded',$4)",
      [businessId, ownerId, prior.id, workspace.revision],
    )
    return { id: prior.id, status: 'queued' as const }
  }
  const photoSelection = {
    mode: settings.rows[0].photo_mode as 'auto' | 'selected',
    selectedAssetIds: (settings.rows[0].preferred_asset_ids || []) as string[],
  }
  if (photoSelection.selectedAssetIds.length > target)
    throw new PlannerFailure('TOO_MANY_SELECTED_PHOTOS')
  const evidence = plannerEvidence(workspace, new Date(), month, photoSelection)
  await client.query(
    `UPDATE monthly_plans
      SET status='queued',stage='research',target_count=$1,completed_count=0,evidence=$2,evidence_hash=$3,
          entitlement_snapshot=$4,research=NULL,editorial_plan=NULL,error_code=NULL,next_run_at=now(),updated_at=now()
      WHERE id=$5 AND business_id=$6`,
    [
      target,
      JSON.stringify(evidence),
      evidenceHash(evidence),
      JSON.stringify({ plan: access.plan, limits: access.limits, paid: access.paid }),
      prior.id,
      businessId,
    ],
  )
  await client.query(
    "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) VALUES($1,$1,$2,'monthly_plan.restarted','monthly_plan',$3,'succeeded',$4)",
    [businessId, ownerId, prior.id, workspace.revision],
  )
  return { id: prior.id, status: 'queued' as const }
}

export async function resetMonthlyPlan(
  client: PoolClient,
  businessId: string,
  ownerId: string,
  month: string,
) {
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
  const plan = await client.query<{ id: string }>(
    `SELECT id FROM monthly_plans
      WHERE business_id=$1 AND month=$2::date FOR UPDATE`,
    [businessId, `${month}-01`],
  )
  if (!plan.rows[0]) return { status: 'cancelled' as const, removedPosts: 0 }
  const planId = plan.rows[0].id
  const unsafe = await client.query(
    `SELECT count(*)::integer AS count FROM posts
      WHERE business_id=$1 AND monthly_plan_id=$2
        AND COALESCE(payload->>'status','draft') NOT IN ('draft','review')`,
    [businessId, planId],
  )
  if (unsafe.rows[0].count > 0) throw new PlannerFailure('PLAN_RESET_UNSAFE')
  const removed = await client.query(
    'DELETE FROM posts WHERE business_id=$1 AND monthly_plan_id=$2 RETURNING id',
    [businessId, planId],
  )
  await client.query(
    `DELETE FROM assets
      WHERE business_id=$1 AND creative_provenance->>'planId'=$2`,
    [businessId, planId],
  )
  await client.query(
    `UPDATE monthly_plans
      SET status='cancelled',stage='research',completed_count=0,research=NULL,
          editorial_plan=NULL,error_code=NULL,next_run_at=now(),updated_at=now()
      WHERE id=$1 AND business_id=$2`,
    [planId, businessId],
  )
  await client.query(
    `UPDATE monthly_planner_settings
      SET configured_at=NULL,photo_mode='auto',preferred_asset_ids='{}',updated_at=now()
      WHERE business_id=$1`,
    [businessId],
  )
  await client.query(
    "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'monthly_plan.reset','monthly_plan',$3,'succeeded',revision FROM businesses WHERE id=$1",
    [businessId, ownerId, planId],
  )
  return { status: 'cancelled' as const, removedPosts: removed.rowCount || 0 }
}
interface PlanRow {
  id: string
  business_id: string
  owner_id: string
  month_key: string
  stage: 'research' | 'planning' | 'content'
  target_count: number
  completed_count: number
  evidence: PlannerEvidence
  evidence_hash: string
  research: unknown
  editorial_plan: unknown
}
async function transaction<T>(db: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original failure. A broken connection is discarded by pg
      // when released and the next worker tick resumes from persisted state.
    }
    throw error
  } finally {
    client.release()
  }
}

async function plannerStep<T>(stage: string, work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      Object.isExtensible(error) &&
      !('plannerStage' in error)
    ) {
      Object.defineProperty(error, 'plannerStage', {
        configurable: true,
        enumerable: false,
        value: stage,
      })
    }
    throw error
  }
}
async function assertCurrentEvidence(db: Pool | PoolClient, plan: PlanRow) {
  const { workspace } = await loadWorkspace(db, plan.business_id, plan.owner_id)
  const selectedAssetIds = plan.evidence.photoSelection?.selectedAssetIds || []
  if (
    selectedAssetIds.some(
      (id) => !workspace.assets.some((asset) => asset.id === id && asset.rights && !asset.generated),
    )
  )
    throw new PlannerFailure('PHOTO_SELECTION_CHANGED')
  const current = workspace.brand.facts.filter((fact) => fact.verified)
  if (
    plan.evidence.brand.facts.some(
      (fact) => !current.some((item) => item.id === fact.id && sameFactContent(item, fact)),
    )
  )
    throw new PlannerFailure('EVIDENCE_CHANGED')
  if (
    JSON.stringify(workspace.brand.guardrails || []) !==
    JSON.stringify(plan.evidence.brand.guardrails || [])
  )
    throw new PlannerFailure('EVIDENCE_CHANGED')
  if (
    JSON.stringify(workspace.brand.researchSources || []) !==
    JSON.stringify(plan.evidence.brand.researchSources || [])
  )
    throw new PlannerFailure('EVIDENCE_CHANGED')
  if (
    ['name', 'voice', 'audience', 'industry', 'description', 'city', 'color'].some(
      (key) =>
        workspace.brand[key as keyof typeof workspace.brand] !==
        plan.evidence.brand[key as keyof typeof plan.evidence.brand],
    )
  )
    throw new PlannerFailure('EVIDENCE_CHANGED')
  return workspace
}
async function advanceMonthlyPlan(db: Pool, plan: PlanRow) {
  await plannerStep('advance.evidence', () => assertCurrentEvidence(db, plan))
  const access = await plannerAccess(plan.business_id, plan.month_key, plan.evidence.timezone, db)
  if (!access?.features.includes('ai') || !access.features.includes('posts'))
    throw new PlannerFailure('ENTITLEMENT_REQUIRED')
  if (plan.stage === 'content') {
    const current = await db.query(
      'SELECT count(*)::integer AS count FROM posts WHERE business_id=$1 AND quota_month=$2::date',
      [plan.business_id, `${plan.month_key}-01`],
    )
    if (current.rows[0].count >= access.limits.posts_per_month)
      throw new PlannerFailure('QUOTA_EXCEEDED')
  }
  const common = {
    planId: plan.id,
    businessId: plan.business_id,
    // Preserve the verified owner/organization pair on every short provider
    // ledger transaction, even though the dedicated worker has a narrowly
    // scoped cross-tenant RLS policy for queue discovery.
    tenant: { userId: plan.owner_id, organizationId: plan.business_id },
  }
  if (plan.stage === 'research') {
    const response = await monthlyProviderCall(db, {
      ...common,
      stageKey: monthlyAutomaticStageKey('research', plan.evidence_hash),
      capability: 'research',
      maxOutput: 6000,
      input: { brand: plan.evidence.brand, month: plan.month_key, asOf: plan.evidence.capturedAt },
    })
    const research = researchFromResponse(response)
    await db.query(
      "UPDATE monthly_plans SET research=$1,stage='planning',updated_at=now() WHERE id=$2",
      [JSON.stringify(research), plan.id],
    )
    return
  }
  const research = researchSchema.parse(plan.research)
  if (plan.stage === 'planning') {
    const earliestPublishableDate = earliestPlanningDate(
      plan.evidence.timezone,
      plan.evidence.capturedAt,
    )
    const planningAssets = await db.query<{ id: string; bytes: Buffer }>(
      'SELECT id,bytes FROM assets WHERE business_id=$1 AND id=ANY($2::uuid[]) AND rights=true AND bytes IS NOT NULL ORDER BY id',
      [plan.business_id, plan.evidence.assets.map((asset) => asset.id)],
    )
    if (!planningAssets.rows.length) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
    const planningContactSheet = await assetContactSheet(planningAssets.rows)
    // Plan the complete month once. A stable key makes every later worker tick
    // reuse the same audited response instead of paying for another attempt.
    const response = await monthlyProviderCall(db, {
        ...common,
        stageKey: monthlyAutomaticStageKey('planning', plan.evidence_hash, plan.target_count),
        capability: 'planning',
        maxOutput: Math.min(30000, 3000 + plan.target_count * 350),
        schema: editorialPlanSchema,
        input: {
          evidence: plan.evidence,
          research,
          month: plan.month_key,
          count: plan.target_count,
          earliestPublishableDate,
          contactSheet: planningAssets.rows.map((asset, index) => ({
            photo: index + 1,
            ...plan.evidence.assets.find((item) => item.id === asset.id),
            selectedByUser: (plan.evidence.photoSelection?.selectedAssetIds || []).includes(asset.id),
          })),
        },
        images: [`data:image/jpeg;base64,${planningContactSheet.toString('base64')}`],
    })
    const editorial = validateEditorialPlan(
          normalizeEditorialPlanResponse(
            JSON.parse(responseText(response)),
            plan.evidence,
            research,
            plan.target_count,
          ),
          plan.evidence,
          research,
          plan.month_key,
          plan.target_count,
    )
    await db.query(
      "UPDATE monthly_plans SET editorial_plan=$1,stage='content',updated_at=now() WHERE id=$2",
      [JSON.stringify(editorial), plan.id],
    )
    return
  }
  const editorial = parsePersistedEditorialPlan(plan.editorial_plan)
  const slot = editorial.slots[plan.completed_count]
  if (!slot) throw new PlannerFailure('INVALID_SLOT_COUNT')
  const slotDay = `${plan.month_key}-${String(slot.day).padStart(2, '0')}`
  if (
    !slot.factIds.every((id) => {
      const fact = plan.evidence.brand.facts.find((item) => item.id === id)
      return !!fact && factIsUsable(fact, slotDay)
    })
  )
    throw new PlannerFailure('EVIDENCE_CHANGED')
  const assets = await db.query<{ id: string; bytes: Buffer }>(
    'SELECT id,bytes FROM assets WHERE business_id=$1 AND id=ANY($2::uuid[]) AND rights=true AND bytes IS NOT NULL ORDER BY id',
    [plan.business_id, plan.evidence.assets.map((asset) => asset.id)],
  )
  if (!assets.rows.length) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
  const contactSheet = await assetContactSheet(assets.rows)
  const earlier = await db.query<{
    caption: string
    title: string
    headline: string | null
    layout: string | null
    asset_id: string | null
  }>(
    `SELECT payload->>'caption' AS caption,payload->>'title' AS title,
      payload#>>'{aiProvenance,creative,headline}' AS headline,
      payload#>>'{aiProvenance,creative,layout}' AS layout,
      payload#>>'{aiProvenance,assetId}' AS asset_id
    FROM posts WHERE monthly_plan_id=$1 ORDER BY monthly_slot`,
    [plan.id],
  )
  const assetUsage = new Map<string, number>()
  for (const post of earlier.rows) {
    if (post.asset_id) assetUsage.set(post.asset_id, (assetUsage.get(post.asset_id) || 0) + 1)
  }
  const futureRequiredAssetIds = new Set(
    editorial.slots
      .slice(plan.completed_count + 1)
      .map((item) => item.requiredAssetId)
      .filter((id): id is string => !!id),
  )
  let content: ReturnType<typeof generatedPostSchema.parse> | undefined
  let original: { id: string; bytes: Buffer } | undefined
  let creative: Buffer | undefined
  let imageGeneration: Awaited<ReturnType<typeof monthlyImageCall>> | undefined
  let quality: ReturnType<typeof qualitySchema.parse> | undefined
  const revisionFeedback: string[] = []
  // One content, one image and one independent review per calendar slot. The
  // first result is persisted as a draft even when QA recommends refinement.
  for (let attempt = 0; attempt < 1; attempt++) {
    const response = await monthlyProviderCall(db, {
      ...common,
      stageKey: monthlyAutomaticStageKey('content', plan.evidence_hash, plan.completed_count),
      capability: 'content',
      maxOutput: 3000,
      schema: generatedPostSchema,
      input: {
        evidence: plan.evidence,
        slot,
        strategy: editorial.objective,
        research: { sources: research.sources },
        previousPosts: earlier.rows,
        contactSheet: assets.rows.map((asset, index) => ({
          photo: index + 1,
          ...plan.evidence.assets.find((item) => item.id === asset.id),
          usageCount: assetUsage.get(asset.id) || 0,
          usedMostRecently: earlier.rows.at(-1)?.asset_id === asset.id,
          requiredForThisPost: slot.requiredAssetId === asset.id,
          reservedForLater: futureRequiredAssetIds.has(asset.id),
        })),
      },
      images: [`data:image/jpeg;base64,${contactSheet.toString('base64')}`],
    })
    let rawContent: unknown
    try {
      rawContent = JSON.parse(responseText(response))
    } catch {
      throw new PlannerFailure('UNGROUNDED_CONTENT', [
        'Ofruesi nuk ktheu objektin e strukturuar të kërkuar.',
      ])
    }
    const parsedContent = generatedPostSchema.safeParse(rawContent)
    if (!parsedContent.success) {
      throw new PlannerFailure('UNGROUNDED_CONTENT', [
        `Përgjigjja nuk përmbushi kontratën: ${parsedContent.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}.`,
      ])
    }
    const requestedAsset = assets.rows.find((asset) => asset.id === parsedContent.data.assetId)
    const preferredAssets = assets.rows
      .filter((asset) => !futureRequiredAssetIds.has(asset.id))
      .sort((left, right) =>
        (assetUsage.get(left.id) || 0) - (assetUsage.get(right.id) || 0),
      )
    const selectedAssetId =
      slot.requiredAssetId ||
      (requestedAsset && !futureRequiredAssetIds.has(requestedAsset.id)
        ? requestedAsset.id
        : preferredAssets[0]?.id) ||
      assets.rows[0]!.id
    // Repair only machine-verifiable references locally. This is free and keeps
    // the provider's concept/copy while guaranteeing owned media, verified facts
    // and the layout already approved by the monthly strategy.
    content = {
      ...parsedContent.data,
      assetId: selectedAssetId,
      factIds: slot.factIds,
      creative: { ...parsedContent.data.creative, layout: slot.visualLayout },
    }
    original = assets.rows.find((asset) => asset.id === selectedAssetId)!
    const imagePrompt = monthlyImagePrompt({
      brand: plan.evidence.brand,
      slot,
      creative: content.creative,
      revisionFeedback,
    })
    imageGeneration = await monthlyImageCall(db, {
      ...common,
      stageKey: monthlyAutomaticStageKey('image', plan.evidence_hash, plan.completed_count),
      prompt: imagePrompt,
      reference: original.bytes,
    })
    // The provider result is the complete design. Local processing is limited to
    // format, dimensions and compression; it adds no template or visual element.
    creative = await normalizeGeneratedCreative(imageGeneration.bytes)
    const qualityResponse = await monthlyProviderCall(db, {
      ...common,
      stageKey: monthlyAutomaticStageKey('quality', plan.evidence_hash, plan.completed_count),
      capability: 'quality',
      maxOutput: 2000,
      schema: qualitySchema,
      input: {
        brand: plan.evidence.brand,
        slot,
        content,
        revisionAttempt: attempt,
        imageOrder: ['Finished AI creative', 'Original owned photograph'],
      },
      images: [
        `data:image/jpeg;base64,${creative.toString('base64')}`,
        `data:image/jpeg;base64,${original.bytes.toString('base64')}`,
      ],
    })
    quality = normalizeQualityReview(qualitySchema.parse(JSON.parse(responseText(qualityResponse))))
    break
  }
  if (!content || !original || !creative || !imageGeneration || !quality)
    throw new PlannerFailure('GENERATION_FAILED')
  await plannerStep('content.persist', () =>
    transaction(db, async (client) => {
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [plan.business_id])
      const locked = await client.query(
        'SELECT completed_count,status FROM monthly_plans WHERE id=$1 FOR UPDATE',
        [plan.id],
      )
      if (
        locked.rows[0]?.completed_count !== plan.completed_count ||
        locked.rows[0]?.status !== 'running'
      )
        return
      const settings = await client.query(
        'SELECT enabled FROM monthly_planner_settings WHERE business_id=$1',
        [plan.business_id],
      )
      if (settings.rows[0]?.enabled === false) throw new PlannerFailure('PLANNER_PAUSED')
      // Recheck evidence, ownership and entitlements immediately before writing.
      await plannerStep('content.persist.evidence', () => assertCurrentEvidence(client, plan))
      const { workspace } = await loadWorkspace(client, plan.business_id, plan.owner_id)
      if (
        plan.evidence.brand.facts.some(
          (fact) =>
            !workspace.brand.facts.some(
              (current) =>
                current.verified && current.id === fact.id && sameFactContent(current, fact),
            ),
        )
      )
        throw new PlannerFailure('EVIDENCE_CHANGED')
      const currentAccess = await plannerAccess(
        plan.business_id,
        plan.month_key,
        plan.evidence.timezone,
        client,
      )
      if (!currentAccess?.features.includes('ai') || !currentAccess.features.includes('posts'))
        throw new PlannerFailure('ENTITLEMENT_REQUIRED')
      await plannerStep('content.persist.rights', async () => {
        // Asset-rights mutations also lock this business row first. The lock held
        // above therefore serializes this recheck without requiring the planner
        // worker to have UPDATE privileges on customer-owned source assets.
        const rights = await client.query(
          'SELECT id FROM assets WHERE business_id=$1 AND id=$2 AND rights=true',
          [plan.business_id, content.assetId],
        )
        if (!rights.rowCount) throw new PlannerFailure('EVIDENCE_CHANGED')
      })
      const usage = await plannerStep('content.persist.usage', () =>
        client.query(
          'SELECT (SELECT count(*)::integer FROM posts WHERE business_id=$1 AND quota_month=$2::date) AS posts,(SELECT COALESCE(sum(size_bytes),0)::bigint FROM assets WHERE business_id=$1) AS bytes',
          [plan.business_id, `${plan.month_key}-01`],
        ),
      )
      if (
        usage.rows[0].posts >= currentAccess.limits.posts_per_month ||
        Number(usage.rows[0].bytes) + creative.length > currentAccess.limits.media_storage_bytes
      )
        throw new PlannerFailure('QUOTA_EXCEEDED')
      const assetId = randomUUID(),
        postId = randomUUID()
      const provenance = {
        planId: plan.id,
        slot: plan.completed_count,
        evidenceHash: plan.evidence_hash,
        factIds: content.factIds,
        sourceUrls: slot.sourceUrls,
        rationale: `${content.reasoning.concept}\n${content.reasoning.copy}\n${content.reasoning.design}\n${content.reasoning.hashtags}\n${slot.platformRationale}\n${slot.timingRationale}\n${content.assetReason}`,
        hashtags: content.hashtags,
        reasoning: {
          ...content.reasoning,
          photo: content.assetReason,
          platform: slot.platformRationale,
          timing: slot.timingRationale,
        },
        assetId: content.assetId,
        creative: content.creative,
        imageGeneration: {
          model: imageGeneration.model,
          quality: imageGeneration.quality,
          promptHash: imageGeneration.promptHash,
        },
        quality,
        promptVersion: monthlyPromptVersion,
      }
      const post = await plannerStep('content.persist.post_schema', async () =>
        postSchema.parse({
          id: postId,
          title: content.title,
          caption: `${content.caption}\n\n${content.hashtags.join(' ')}`,
          channel: slot.channel,
          format: 'static',
          image: `/api/media/${assetId}`,
          pillar: slot.pillar,
          status: 'draft',
          version: 1,
          contentVersion: 1,
          history: [],
          scheduledAt: null,
          proposedAt: zonedToIso(
            `${plan.month_key}-${String(slot.day).padStart(2, '0')}T${slot.time}`,
            plan.evidence.timezone,
          ),
          publicationMode: 'manual',
          // Subjective QA findings remain user-reviewable; only a concrete
          // factual-safety failure prevents approval without correction.
          policy: quality.factuality ? 'warn' : 'block',
          policyReason:
            quality.reasons.join(' ') || 'Kontrollo faktet dhe dizajnin përpara miratimit.',
          aiProvenance: provenance,
        }),
      )
      await plannerStep('content.persist.asset_insert', () =>
        client.query(
          "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height,creative_provenance) VALUES($1,$2,$3,$4,true,'image/jpeg',$5,1080,1350,$6)",
          [
            assetId,
            plan.business_id,
            content.title,
            JSON.stringify(['monthly-creative', slot.pillar]),
            creative,
            JSON.stringify({
              ...provenance,
              checksum: evidenceHash(creative.toString('base64')),
            }),
          ],
        ),
      )
      await plannerStep('content.persist.post_insert', () =>
        client.query(
          'INSERT INTO posts(id,business_id,payload,content_version,monthly_plan_id,monthly_slot,quota_month) VALUES($1,$2,$3,1,$4,$5,$6)',
          [
            postId,
            plan.business_id,
            JSON.stringify(post),
            plan.id,
            plan.completed_count,
            `${plan.month_key}-01`,
          ],
        ),
      )
      await plannerStep('content.persist.version_insert', () =>
        client.query(
          "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,1,$3,$4,'monthly_planner',$5)",
          [
            postId,
            plan.business_id,
            postFingerprint(post),
            JSON.stringify(postContentSnapshot(post)),
            plan.owner_id,
          ],
        ),
      )
      const complete = plan.completed_count + 1 === plan.target_count
      await plannerStep('content.persist.plan_update', () =>
        client.query(
          'UPDATE monthly_plans SET completed_count=completed_count+1,status=$1,stage=$2,error_code=NULL,updated_at=now() WHERE id=$3',
          [complete ? 'review' : 'running', complete ? 'complete' : 'content', plan.id],
        ),
      )
      await plannerStep('content.persist.business_update', () =>
        client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [
          plan.business_id,
        ]),
      )
      await plannerStep('content.persist.audit_insert', () =>
        client.query(
          "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,owner_id,'monthly_plan.draft_created','post',$2,'succeeded',revision FROM businesses WHERE id=$1",
          [plan.business_id, postId],
        ),
      )
    }),
  )
}

// A renewable database lease spans the provider call without holding an SQL
// connection. It expires after process loss; reserved stages prevent double spend.
export async function runMonthlyPlannerTick(
  db: Pool = monthlyWorkerDatabase(),
  options: { discover?: boolean } = {},
) {
  if (!monthlyAiConfigured()) return
  const leaseOwner = randomUUID()
  const acquired = await plannerStep('lease.acquire', () =>
    db.query(
      `INSERT INTO worker_heartbeats(name,last_seen_at,lease_owner,lease_until)
        VALUES('monthly_planner',now(),$1,now()+interval '10 minutes')
        ON CONFLICT(name) DO UPDATE
          SET last_seen_at=now(),lease_owner=EXCLUDED.lease_owner,lease_until=EXCLUDED.lease_until
        WHERE worker_heartbeats.lease_until IS NULL
          OR worker_heartbeats.lease_until<now()
        RETURNING name`,
      [leaseOwner],
    ),
  )
  if (!acquired.rowCount) return
  const heartbeat = setInterval(() => {
    void db
      .query(
        `UPDATE worker_heartbeats
          SET last_seen_at=now(),lease_until=now()+interval '10 minutes'
          WHERE name='monthly_planner' AND lease_owner=$1`,
        [leaseOwner],
      )
      .catch((error: unknown) => {
        const code =
          typeof error === 'object' && error && 'code' in error
            ? String(error.code).slice(0, 64)
            : undefined
        console.warn('Monthly planner heartbeat refresh was interrupted.', { code })
      })
  }, 30000)
  heartbeat.unref()
  try {
    // Scan in stable rotation so businesses missing prerequisites do not starve others.
    const candidates = await plannerStep('discovery', () =>
      db.query(
        `SELECT b.id,b.owner_id,b.state FROM businesses b
        LEFT JOIN monthly_planner_settings s ON s.business_id=b.id
        WHERE COALESCE(s.enabled,true) AND s.configured_at IS NOT NULL AND $1::boolean
        ORDER BY COALESCE(s.updated_at,b.created_at),b.id LIMIT 10`,
        [options.discover !== false],
      ),
    )
    for (const business of candidates.rows) {
      try {
        await plannerStep('candidate.ensure', () =>
          transaction(db, async (client) => {
            // An editor/API transaction may already be changing this workspace.
            // Skip it for this rotation instead of starving every other tenant.
            const available = await client.query(
              'SELECT id FROM businesses WHERE id=$1 FOR UPDATE SKIP LOCKED',
              [business.id],
            )
            if (!available.rowCount) return
            await setTenantContext(client, {
              userId: business.owner_id,
              organizationId: business.id,
            })
            await ensureMonthlyPlan(client, business.id, business.owner_id)
            const zone = business.state.preferences?.timezone || 'Europe/Tirane'
            const localDate = new Intl.DateTimeFormat('en-CA', {
              timeZone: zone,
              day: '2-digit',
            }).format(new Date())
            if (Number(localDate) >= 24) {
              const upcoming = new Date(`${planningMonth(zone)}-01T12:00:00Z`)
              upcoming.setUTCMonth(upcoming.getUTCMonth() + 1)
              // Use a savepoint: unavailable future access must not roll back this month.
              await client.query('SAVEPOINT next_month')
              try {
                await ensureMonthlyPlan(
                  client,
                  business.id,
                  business.owner_id,
                  upcoming.toISOString().slice(0, 7),
                )
              } catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT next_month')
                if (!(error instanceof PlannerFailure)) throw error
              }
            }
          }),
        )
      } catch (error) {
        if (!(error instanceof PlannerFailure)) throw error
      }
      await plannerStep('candidate.rotate', () =>
        db.query(
          'INSERT INTO monthly_planner_settings(business_id,enabled) VALUES($1,true) ON CONFLICT(business_id) DO UPDATE SET updated_at=now()',
          [business.id],
        ),
      )
    }
    const jobs = await plannerStep('jobs.read', () =>
      db.query<PlanRow>(`SELECT p.*,to_char(p.month,'YYYY-MM') AS month_key,b.owner_id
        FROM monthly_plans p JOIN businesses b ON b.id=p.business_id
        LEFT JOIN monthly_planner_settings s ON s.business_id=p.business_id
        WHERE p.status IN ('queued','running') AND p.next_run_at<=now() AND COALESCE(s.enabled,true)
        ORDER BY p.updated_at,p.id LIMIT 1`),
    )
    const plan = jobs.rows[0]
    if (!plan) return
    await plannerStep('jobs.claim', () =>
      db.query(
        "UPDATE monthly_plans SET status='running',error_code=NULL,updated_at=now() WHERE id=$1",
        [plan.id],
      ),
    )
    try {
      await plannerStep('jobs.advance', () => advanceMonthlyPlan(db, plan))
    } catch (error) {
      const code = error instanceof PlannerFailure ? error.code : 'GENERATION_FAILED'
      const rawStage =
        typeof error === 'object' && error && 'plannerStage' in error
          ? String(error.plannerStage)
          : undefined
      const stage = rawStage && /^[a-z0-9_.-]{1,64}$/i.test(rawStage) ? rawStage : undefined
      const database =
        typeof error === 'object' && error
          ? Object.fromEntries(
              ['code', 'schema', 'table', 'column', 'constraint'].flatMap((field) => {
                if (!(field in error)) return []
                const rawValue = error[field as keyof typeof error]
                if (typeof rawValue !== 'string' || !/^[a-z0-9_.-]{1,128}$/i.test(rawValue))
                  return []
                return [[field, rawValue]]
              }),
            )
          : undefined
      if (stage)
        console.warn('Monthly planner paused the current tick at a validated stage.', {
          code,
          stage,
          database,
          ...(error instanceof PlannerFailure
            ? { details: error.details.slice(0, 5) }
            : {
                errorName:
                  typeof error === 'object' && error && 'name' in error
                    ? String(error.name).slice(0, 80)
                    : typeof error,
                errorMessage:
                  typeof error === 'object' && error && 'message' in error
                    ? String(error.message).slice(0, 500)
                    : 'Unknown generation failure',
              }),
        })
      // Never turn a failed automatic stage into another paid attempt. The plan
      // remains resumable, but only an explicit user action may continue it.
      await db.query(
        `UPDATE monthly_plans
          SET status='blocked',error_code=$1,next_run_at=NULL,updated_at=now()
          WHERE id=$2`,
        [code, plan.id],
      )
    }
  } finally {
    clearInterval(heartbeat)
    try {
      await db.query(
        "UPDATE worker_heartbeats SET lease_owner=NULL,lease_until=NULL,last_seen_at=now() WHERE name='monthly_planner' AND lease_owner=$1",
        [leaseOwner],
      )
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code).slice(0, 64)
          : undefined
      console.warn('Monthly planner lease will recover automatically after release failure.', {
        code,
      })
    }
  }
}
