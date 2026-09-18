import { randomUUID } from 'node:crypto'
import pg, { type Pool, type PoolClient } from 'pg'
import {
  generatedPostSchema,
  qualitySchema,
  editorialPlanGenerationSchema,
  pageStyleAnalysisSchema,
  researchSchema,
  type PageStyleAnalysis,
} from '../../shared/schemas/monthly-plan'
import { postSchema } from '../../shared/schemas/workspace'
import { factIsUsable, sameFactContent } from '../../shared/schemas/business-brain'
import { zonedToIso } from '../../shared/utils/format'
import { loadWorkspace } from './workspaces'
import {
  paidAccessForPlanningMonth,
  postsCountedForLimit,
  recordTrialPostUsage,
  trialStatus,
} from './trials'
import { setTenantContext } from './database'
import { postContentSnapshot, postFingerprint } from './post-validation'
import { normalizeQualityReview } from './post-quality-domain'
import { assetContactSheet, normalizeGeneratedCreative } from './image-processing'
import {
  assetStorageFolder,
  assetStoragePath,
  downloadAsset,
  MAX_ASSET_BYTES,
  removeAsset,
  uploadAsset,
} from './asset-storage'
import { fetchLatestSocialPosts, syncAllConnectedSocialPosts } from './meta-social-history'
import {
  newestStylePosts,
  STYLE_SNAPSHOT_VERSION,
  styleRevision,
  styleSnapshotIsFresh,
} from './style-snapshots'
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
  remainingMonthlyPosts,
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
    postsCountedForLimit(client, businessId, month, access.paid),
  )
  const target = remainingMonthlyPosts(access.limits.posts_per_month, existing)
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

// A blocked plan can resume from its current stage when all earlier stages have
// already produced durable results. Completed provider runs remain as
// cost/audit records and are reused through the stable stage key, so Continue
// preparation does not spend credits on research or planning again.
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
  const resumePlanning =
    prior.stage === 'planning' &&
    prior.has_research &&
    !prior.has_editorial_plan &&
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
  const existing = await postsCountedForLimit(client, businessId, month, access.paid)
  const target = remainingMonthlyPosts(access.limits.posts_per_month, existing)
  if (target < 1) throw new PlannerFailure('QUOTA_EXCEEDED')
  if (resumePlanning || resumeContent) {
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
  // Preserve approved, scheduled, failed and published posts. They are no
  // longer part of the regenerated plan, but they must remain in the workspace.
  await client.query(
    `UPDATE posts
        SET monthly_plan_id=NULL,monthly_slot=NULL
      WHERE business_id=$1 AND monthly_plan_id=$2
        AND COALESCE(payload->>'status','draft') NOT IN ('draft','review')`,
    [businessId, planId],
  )
  const removed = await client.query(
    `DELETE FROM posts
      WHERE business_id=$1 AND monthly_plan_id=$2
        AND COALESCE(payload->>'status','draft') IN ('draft','review')
      RETURNING id`,
    [businessId, planId],
  )
  await client.query(
    `DELETE FROM assets
      WHERE business_id=$1 AND creative_provenance->>'planId'=$2
        AND NOT EXISTS (
          SELECT 1 FROM posts p
          WHERE p.business_id=assets.business_id
            AND p.payload->>'image'='/api/media/' || assets.id::text
        )`,
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
interface PlannerAssetRow {
  id: string
  bytes: Buffer | null
  storage_path: string | null
  size_bytes: number | string | null
}

interface PreviousPageStyleRow {
  provider_id: string
  channel: 'Facebook' | 'Instagram'
  caption: string
  media_url: string | null
  published_at: string
  media_type: string
}

interface PublishedPlatformPostRow {
  post_id: string
  channel: 'Facebook' | 'Instagram'
  caption: string
  published_at: string
  provider_id: string | null
  asset_id: string
}

interface PageStyleReference {
  source: 'facebook' | 'instagram' | 'platform'
  channel: 'Facebook' | 'Instagram'
  postId?: string
  providerId?: string
  assetId?: string
  publishedAt: string
}

interface PageStyleHistorySummary {
  totalPosts: number
  byChannel: { Facebook: number; Instagram: number }
  bySource: { platform: number; facebook: number; instagram: number }
  mediaTypes: Record<string, number>
  captionedPosts: number
  averageCaptionLength: number
  oldestPublishedAt: string | null
  newestPublishedAt: string | null
}

export interface PreviousPageStyle {
  revision: string
  examples: Array<{
    channel: 'Facebook' | 'Instagram'
    caption: string
    publishedAt: string
    mediaType: string
  }>
  references: PageStyleReference[]
  referenceCount: number
  platformPublishedCount: number
  importedSocialCount: number
  historySummary: PageStyleHistorySummary
  // Monthly AI analysis of the page style, cached with the snapshot.
  profile?: PageStyleAnalysis
  contactSheet?: Buffer
}

/** Input of the monthly AI page-style analysis. */
export interface PageStyleEvidence {
  revision: string
  examples: PreviousPageStyle['examples']
  historySummary: PageStyleHistorySummary
  contactSheet?: Buffer
}

type StyleSnapshotSummary = Omit<PreviousPageStyle, 'revision' | 'contactSheet'> & {
  version: number
}
/** The cached monthly page style as stored in style_snapshots.summary. */
export type CachedPageStyle = StyleSnapshotSummary

export interface PlannerAsset {
  id: string
  bytes: Buffer
}

function releasePlannerAssets(assets: PlannerAsset[]) {
  for (const asset of assets) asset.bytes.fill(0)
}

// Source photos can live either in legacy inline bytea or in private Supabase
// Storage. Keep the worker's downstream image contract identical by hydrating
// both forms into short-lived buffers before building model input.
export async function loadPlannerAssets(
  db: Pool | PoolClient,
  businessId: string,
  assetIds: string[],
  download = downloadAsset,
) {
  const result = await db.query<PlannerAssetRow>(
    `SELECT id,bytes,storage_path,size_bytes
       FROM assets
      WHERE business_id=$1
        AND id=ANY($2::uuid[])
        AND rights=true
        AND (bytes IS NOT NULL OR storage_path IS NOT NULL)
      ORDER BY id`,
    [businessId, assetIds],
  )
  const assets: PlannerAsset[] = []
  const downloaded: Buffer[] = []
  try {
    for (const row of result.rows) {
      if (row.bytes) {
        if (row.bytes.length > MAX_ASSET_BYTES) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
        assets.push({ id: row.id, bytes: row.bytes })
        continue
      }
      if (!row.storage_path) continue
      const size = Number(row.size_bytes)
      if (!Number.isFinite(size) || size < 1 || size > MAX_ASSET_BYTES)
        throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
      const bytes = await download(row.storage_path, MAX_ASSET_BYTES)
      if (bytes.length < 1 || bytes.length > MAX_ASSET_BYTES) {
        bytes.fill(0)
        throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
      }
      downloaded.push(bytes)
      assets.push({ id: row.id, bytes })
    }
    return assets
  } catch (error) {
    // Do not retain successfully downloaded source images when a later asset
    // fails. The successful path is intentionally in-memory only; no temp file
    // is created and every temporary buffer is released at this boundary.
    for (const bytes of downloaded) bytes.fill(0)
    throw error
  }
}

const MAX_STYLE_REFERENCES = 8
const MAX_STYLE_REFERENCE_BYTES = 2097152
const MAX_STYLE_CONTACT_SHEET_BYTES = 8388608

function isoTimestamp(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value
}

function normalizeGeneratedHashtags(value: unknown) {
  if (!Array.isArray(value)) return value
  const hashtags = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => {
      const body = item
        .normalize('NFKC')
        .trim()
        .replace(/^#+/u, '')
        .replace(/[^\p{L}\p{N}_]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 50)
      return body.length >= 2 ? `#${body}` : null
    })
    .filter((item): item is string => !!item)
  return [...new Set(hashtags)]
}

// Imported page media is used only as visual style evidence. It is never saved
// as a business asset and it is never treated as a source of business facts.
async function cachedPageStyle(
  summary: StyleSnapshotSummary,
  revision: string,
  contactSheetPath: string | null,
): Promise<PreviousPageStyle> {
  let contactSheet: Buffer | undefined
  if (contactSheetPath) {
    try {
      contactSheet = await downloadAsset(contactSheetPath, MAX_STYLE_CONTACT_SHEET_BYTES)
    } catch {
      // The cached text summary and AI profile remain usable without the sheet.
    }
  }
  return {
    revision,
    examples: summary.examples,
    references: summary.references,
    referenceCount: summary.referenceCount,
    platformPublishedCount: summary.platformPublishedCount,
    importedSocialCount: summary.importedSocialCount,
    historySummary: summary.historySummary,
    ...(summary.profile ? { profile: summary.profile } : {}),
    ...(contactSheet ? { contactSheet } : {}),
  }
}

// The Meta fetch and AI analysis run at most once a month per brand (PRC-04);
// every generation in between reuses the cached style snapshot.
export async function loadPreviousPageStyle(
  db: Pool | PoolClient,
  businessId: string,
  options: {
    analyze?: (evidence: PageStyleEvidence) => Promise<PageStyleAnalysis>
    now?: Date
  } = {},
): Promise<PreviousPageStyle> {
  const now = options.now || new Date()
  const styleScope = await db.query<{
    brand_id: string
    connection_id: string | null
    style_fetch_post_count: number
    is_trial: boolean
    snapshot_summary: StyleSnapshotSummary | null
    snapshot_revision: string | null
    last_style_fetch_at: Date | null
    contact_sheet_path: string | null
  }>(
    `SELECT brand.id AS brand_id,connection.id AS connection_id,plan.style_fetch_post_count,
            plan.is_trial,snapshot.summary AS snapshot_summary,
            snapshot.source_revision AS snapshot_revision,snapshot.last_style_fetch_at,
            snapshot.contact_sheet_path
       FROM brands brand
       JOIN subscriptions subscription
         ON subscription.organization_id=brand.organization_id
        AND subscription.status IN ('trialing','active','past_due')
        AND subscription.current_period_start<=now()
        AND subscription.current_period_end>now()
       JOIN plans plan ON plan.code=subscription.plan_code AND plan.active=true
       LEFT JOIN meta_connections connection
         ON connection.business_id=brand.organization_id
        AND connection.brand_id=brand.id
        AND connection.status='connected'
       LEFT JOIN style_snapshots snapshot ON snapshot.brand_id=brand.id
      WHERE brand.organization_id=$1 AND brand.status='active'
      ORDER BY brand.created_at,brand.id
      LIMIT 1`,
    [businessId],
  )
  const scope = styleScope.rows[0]
  if (
    scope?.snapshot_summary &&
    scope.snapshot_revision &&
    styleSnapshotIsFresh({
      lastFetchAt: scope.last_style_fetch_at,
      summaryVersion: scope.snapshot_summary.version,
      isTrial: scope.is_trial,
      now,
    })
  )
    return cachedPageStyle(scope.snapshot_summary, scope.snapshot_revision, scope.contact_sheet_path)
  // A legacy tenant without a PRC-01 subscription keeps the full-history
  // behavior but does not receive a cached snapshot until it is assigned a plan.
  const fetchLimit = scope?.style_fetch_post_count
  try {
    if (!scope) await syncAllConnectedSocialPosts(db, businessId)
    else if (scope.connection_id) await fetchLatestSocialPosts(db, businessId, fetchLimit!)
  } catch (error) {
    // Cached social history remains usable when Meta is temporarily unavailable.
    console.warn('[monthly-planner] social history sync failed; using cached posts', {
      businessId,
      code:
        typeof error === 'object' && error && 'code' in error
          ? String(error.code).slice(0, 64)
          : undefined,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : typeof error,
    })
  }
  const socialResult = await db.query<PreviousPageStyleRow>(
    `SELECT sp.provider_id,sp.channel,sp.caption,sp.media_url,sp.published_at,sp.media_type
       FROM social_posts sp
      WHERE sp.business_id=$1
        AND ($2::uuid IS NULL OR sp.brand_id=$2)
        AND EXISTS (
          SELECT 1
          FROM meta_connections mc
          WHERE mc.business_id=sp.business_id
            AND mc.status='connected'
            AND ((sp.channel='Facebook' AND sp.source_account_id=mc.page_id)
              OR (sp.channel='Instagram' AND sp.source_account_id=mc.instagram_id))
        )
      ORDER BY sp.published_at DESC,sp.provider_id DESC
      LIMIT COALESCE($3::integer,2147483647)`,
    [businessId, scope?.brand_id || null, fetchLimit || null],
  )
  const platformResult = await db.query<PublishedPlatformPostRow>(
    `SELECT DISTINCT ON (p.id)
        p.id::text AS post_id,
        p.payload->>'channel' AS channel,
        COALESCE(p.payload->>'caption','') AS caption,
        COALESCE(j.updated_at,p.updated_at,p.created_at)::text AS published_at,
        j.provider_post_id AS provider_id,
        replace(p.payload->>'image','/api/media/','') AS asset_id
       FROM posts p
       JOIN publication_jobs j
         ON j.post_id=p.id
        AND j.business_id=p.business_id
        AND j.status='published'
       JOIN assets a
         ON a.business_id=p.business_id
        AND a.id::text=replace(p.payload->>'image','/api/media/','')
        AND a.rights=true
      WHERE p.business_id=$1
        AND p.payload->>'status'='published'
        AND p.payload->>'image' ~ '^/api/media/[0-9a-fA-F-]{36}$'
      ORDER BY p.id,j.updated_at DESC,p.updated_at DESC`,
    [businessId],
  )

  const localProviderIds = new Set(
    platformResult.rows
      .map((row) => row.provider_id)
      .filter((id): id is string => !!id),
  )
  const socialRows = socialResult.rows.filter((row) => !localProviderIds.has(row.provider_id))
  const combinedRows = newestStylePosts([
    ...socialRows.map((row) => ({
      source: row.channel === 'Facebook' ? ('facebook' as const) : ('instagram' as const),
      channel: row.channel,
      postId: undefined,
      providerId: row.provider_id,
      assetId: undefined,
      caption: row.caption,
      mediaUrl: row.media_url,
      publishedAt: isoTimestamp(row.published_at),
      mediaType: row.media_type,
      sortId: row.provider_id,
    })),
    ...platformResult.rows.map((row) => ({
      source: 'platform' as const,
      channel: row.channel,
      postId: row.post_id,
      providerId: row.provider_id || undefined,
      assetId: row.asset_id,
      caption: row.caption,
      mediaUrl: null,
      publishedAt: isoTimestamp(row.published_at),
      mediaType: 'POST',
      sortId: row.post_id,
    })),
  ], fetchLimit)

  const styleRows =
    combinedRows.length <= MAX_STYLE_REFERENCES
      ? combinedRows
      : Array.from(
          { length: MAX_STYLE_REFERENCES },
          (_, index) =>
            combinedRows[
              Math.round((index * (combinedRows.length - 1)) / (MAX_STYLE_REFERENCES - 1))
            ]!,
        )
  const examples = styleRows.map((row) => ({
    channel: row.channel,
    caption: row.caption.slice(0, 700),
    publishedAt: row.publishedAt,
    mediaType: row.mediaType,
  }))
  const revision = styleRevision(combinedRows)
  const references = styleRows.map((row) => ({
    source: row.source,
    channel: row.channel,
    ...(row.postId ? { postId: row.postId } : {}),
    ...(row.providerId ? { providerId: row.providerId } : {}),
    ...(row.assetId ? { assetId: row.assetId } : {}),
    publishedAt: row.publishedAt,
  }))
  const captionLengths = combinedRows
    .map((row) => row.caption.trim().length)
    .filter((length) => length > 0)
  const historySummary: PageStyleHistorySummary = {
    totalPosts: combinedRows.length,
    byChannel: {
      Facebook: combinedRows.filter((row) => row.channel === 'Facebook').length,
      Instagram: combinedRows.filter((row) => row.channel === 'Instagram').length,
    },
    bySource: {
      platform: combinedRows.filter((row) => row.source === 'platform').length,
      facebook: combinedRows.filter((row) => row.source === 'facebook').length,
      instagram: combinedRows.filter((row) => row.source === 'instagram').length,
    },
    mediaTypes: combinedRows.reduce<Record<string, number>>((counts, row) => {
      const mediaType = row.mediaType.trim().toUpperCase() || 'POST'
      counts[mediaType] = (counts[mediaType] || 0) + 1
      return counts
    }, {}),
    captionedPosts: captionLengths.length,
    averageCaptionLength: captionLengths.length
      ? Math.round(captionLengths.reduce((total, length) => total + length, 0) / captionLengths.length)
      : 0,
    oldestPublishedAt: combinedRows.at(-1)?.publishedAt || null,
    newestPublishedAt: combinedRows[0]?.publishedAt || null,
  }
  const referenceImages: PlannerAsset[] = []
  const localStyleAssetIds = styleRows
    .map((row) => row.assetId)
    .filter((id): id is string => !!id)
  const localStyleAssets = localStyleAssetIds.length
    ? await loadPlannerAssets(db, businessId, localStyleAssetIds)
    : []
  const localStyleAssetMap = new Map(localStyleAssets.map((asset) => [asset.id, asset.bytes]))
  for (const [index, row] of styleRows.entries()) {
    if (row.assetId) {
      const bytes = localStyleAssetMap.get(row.assetId)
      if (bytes) referenceImages.push({ id: `platform-post-${row.postId || index + 1}`, bytes })
      continue
    }
    if (!row.mediaUrl) continue
    let url: URL
    try {
      url = new URL(row.mediaUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:') continue
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'image/*' },
      })
      if (!response.ok) continue
      const contentType = response.headers.get('content-type') || ''
      const contentLength = Number(response.headers.get('content-length') || 0)
      if (!contentType.startsWith('image/') || contentLength > MAX_STYLE_REFERENCE_BYTES)
        continue
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length < 1000 || bytes.length > MAX_STYLE_REFERENCE_BYTES) {
        bytes.fill(0)
        continue
      }
      referenceImages.push({ id: `previous-post-${index + 1}`, bytes })
    } catch {
      // A Meta media URL can expire. The text examples remain useful when that happens.
    }
  }
  const baseResult = {
    revision,
    examples,
    references,
    referenceCount: combinedRows.length,
    platformPublishedCount: combinedRows.filter((row) => row.source === 'platform').length,
    importedSocialCount: combinedRows.filter((row) => row.source !== 'platform').length,
    historySummary,
  }
  let contactSheet: Buffer | undefined
  try {
    if (referenceImages.length) contactSheet = await assetContactSheet(referenceImages)
  } finally {
    for (const image of referenceImages) image.bytes.fill(0)
    for (const bytes of localStyleAssets.map((asset) => asset.bytes)) bytes.fill(0)
  }
  const withSheet = contactSheet ? { contactSheet } : {}
  if (!scope || !options.analyze) return { ...baseResult, ...withSheet }

  let profile: PageStyleAnalysis
  try {
    profile = await options.analyze({ revision, examples, historySummary, contactSheet })
  } catch (error) {
    contactSheet?.fill(0)
    throw error
  }
  let contactSheetPath: string | null = null
  if (contactSheet) {
    contactSheetPath = `style-snapshots/${businessId}/${scope.brand_id}/${revision}-${now.getTime()}.jpg`
    try {
      await uploadAsset(contactSheetPath, contactSheet)
    } catch {
      contactSheetPath = null
    }
  }
  const summary: StyleSnapshotSummary = {
    version: STYLE_SNAPSHOT_VERSION,
    examples,
    references,
    referenceCount: baseResult.referenceCount,
    platformPublishedCount: baseResult.platformPublishedCount,
    importedSocialCount: baseResult.importedSocialCount,
    historySummary,
    profile,
  }
  await db.query(
    `INSERT INTO style_snapshots
      (organization_id,brand_id,source_connection_id,summary,source_post_count,source_revision,
       last_style_fetch_at,contact_sheet_path)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
     ON CONFLICT (brand_id) DO UPDATE SET
       source_connection_id=EXCLUDED.source_connection_id,
       summary=EXCLUDED.summary,
       source_post_count=EXCLUDED.source_post_count,
       source_revision=EXCLUDED.source_revision,
       last_style_fetch_at=EXCLUDED.last_style_fetch_at,
       contact_sheet_path=EXCLUDED.contact_sheet_path,
       updated_at=now()`,
    [
      businessId,
      scope.brand_id,
      scope.connection_id,
      JSON.stringify(summary),
      combinedRows.length,
      revision,
      now,
      contactSheetPath,
    ],
  )
  if (scope.contact_sheet_path && scope.contact_sheet_path !== contactSheetPath)
    await removeAsset(scope.contact_sheet_path).catch(() => undefined)
  return { ...baseResult, profile, ...withSheet }
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
      (id) =>
        !workspace.assets.some((asset) => asset.id === id && asset.rights && !asset.generated),
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
function generationAssetIds(evidence: PlannerEvidence) {
  if (evidence.photoSelection?.mode === 'selected')
    return evidence.photoSelection.selectedAssetIds
  return evidence.assets.map((asset) => asset.id)
}
async function advanceMonthlyPlan(db: Pool, plan: PlanRow) {
  const workspace = await plannerStep('advance.evidence', () => assertCurrentEvidence(db, plan))
  const access = await plannerAccess(plan.business_id, plan.month_key, plan.evidence.timezone, db)
  if (!access?.features.includes('ai') || !access.features.includes('posts'))
    throw new PlannerFailure('ENTITLEMENT_REQUIRED')
  if (plan.stage === 'content') {
    const current = await postsCountedForLimit(db, plan.business_id, plan.month_key, access.paid)
    if (!remainingMonthlyPosts(access.limits.posts_per_month, current))
      throw new PlannerFailure('QUOTA_EXCEEDED')
  }
  const common = {
    planId: plan.id,
    businessId: plan.business_id,
    // Preserve the verified owner/organization pair on every short provider
    // ledger transaction, even though the dedicated worker has a narrowly
    // scoped cross-tenant RLS policy for queue discovery.
    tenant: { userId: plan.owner_id, organizationId: plan.business_id },
    language: (workspace.preferences.locale === 'en-US' ? 'en' : 'sq') as 'en' | 'sq',
  }
  // Runs only when the brand's monthly style snapshot is stale (PRC-04).
  const analyzePageStyle = async (evidence: PageStyleEvidence) => {
    const response = await monthlyProviderCall(db, {
      ...common,
      stageKey: monthlyAutomaticStageKey('style', evidence.revision),
      capability: 'style',
      maxOutput: 3000,
      schema: pageStyleAnalysisSchema,
      input: { examples: evidence.examples, historySummary: evidence.historySummary },
      images: evidence.contactSheet
        ? [`data:image/jpeg;base64,${evidence.contactSheet.toString('base64')}`]
        : [],
    })
    return pageStyleAnalysisSchema.parse(JSON.parse(responseText(response)))
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
    const planningAssets = await plannerStep('planning.assets', () =>
      loadPlannerAssets(
        db,
        plan.business_id,
        generationAssetIds(plan.evidence),
      ),
    )
    if (!planningAssets.length) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
    let planningContactSheet: Buffer | undefined
    let previousPageStyle: PreviousPageStyle | undefined
    try {
      planningContactSheet = await assetContactSheet(planningAssets)
      previousPageStyle = await loadPreviousPageStyle(db, plan.business_id, {
        analyze: analyzePageStyle,
      })
      // Plan the complete month once. A stable key makes every later worker tick
      // reuse the same audited response instead of paying for another attempt.
      const response = await monthlyProviderCall(db, {
        ...common,
        stageKey: monthlyAutomaticStageKey(
          'planning',
          plan.evidence_hash,
          `${plan.target_count}:${previousPageStyle.revision}`,
        ),
        capability: 'planning',
        maxOutput: Math.min(30000, 3000 + plan.target_count * 350),
        schema: editorialPlanGenerationSchema,
        input: {
          evidence: plan.evidence,
          research,
          month: plan.month_key,
          count: plan.target_count,
          earliestPublishableDate,
          contactSheet: planningAssets.map((asset, index) => ({
            photo: index + 1,
            ...plan.evidence.assets.find((item) => item.id === asset.id),
            selectedByUser: (plan.evidence.photoSelection?.selectedAssetIds || []).includes(
              asset.id,
            ),
          })),
          previousPageStyle: {
            examples: previousPageStyle.examples,
            referenceCount: previousPageStyle.referenceCount,
            platformPublishedCount: previousPageStyle.platformPublishedCount,
            importedSocialCount: previousPageStyle.importedSocialCount,
            historySummary: previousPageStyle.historySummary,
            ...(previousPageStyle.profile ? { profile: previousPageStyle.profile } : {}),
            styleDimensions: [
              'dominant color palette and saturation',
              'contrast, brightness and recurring color accents',
              'typography family, scale, weight and text density',
              'visual hierarchy, spacing and safe-area discipline',
              'photographic crop, lighting, depth and retouching treatment',
              'recurring brand elements such as logo, border, CTA or icon treatment',
              'caption length, tone, CTA and hashtag patterns by channel',
            ],
          },
        },
        images: [
          `data:image/jpeg;base64,${planningContactSheet.toString('base64')}`,
          ...(previousPageStyle.contactSheet
            ? [`data:image/jpeg;base64,${previousPageStyle.contactSheet.toString('base64')}`]
            : []),
        ],
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
    } finally {
      planningContactSheet?.fill(0)
      previousPageStyle?.contactSheet?.fill(0)
      releasePlannerAssets(planningAssets)
    }
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
  const assets = await plannerStep('content.assets', () =>
    loadPlannerAssets(
      db,
      plan.business_id,
      generationAssetIds(plan.evidence),
    ),
  )
  if (!assets.length) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
  let contactSheet: Buffer | undefined
  let previousPageStyle: PreviousPageStyle | undefined
  let previousGeneratedAssets: PlannerAsset[] = []
  let previousGeneratedContactSheet: Buffer | undefined
  try {
    contactSheet = await assetContactSheet(assets)
    previousPageStyle = await loadPreviousPageStyle(db, plan.business_id, {
      analyze: analyzePageStyle,
    })
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
    const previousGeneratedAssetIds = earlier.rows
      .map((post) => post.asset_id)
      .filter((id): id is string => !!id)
    if (previousGeneratedAssetIds.length) {
      previousGeneratedAssets = await loadPlannerAssets(
        db,
        plan.business_id,
        previousGeneratedAssetIds,
      )
      if (previousGeneratedAssets.length)
        previousGeneratedContactSheet = await assetContactSheet(previousGeneratedAssets)
    }
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
    // Keep one paid generation per calendar slot. The page-style references and
    // distinctness instructions are applied before generation; QA reports a
    // warning for human review instead of spending credits on a second attempt.
    for (let attempt = 0; attempt < 1; attempt++) {
      const response = await monthlyProviderCall(db, {
        ...common,
        stageKey: monthlyAutomaticStageKey(
          'content',
          plan.evidence_hash,
          `${plan.completed_count}:${previousPageStyle.revision}`,
        ),
        capability: 'content',
        maxOutput: 3000,
        schema: generatedPostSchema,
        input: {
          evidence: plan.evidence,
          slot,
          strategy: editorial.objective,
          research: { sources: research.sources },
          previousPosts: earlier.rows,
          previousGeneratedPostCount: previousGeneratedAssets.length,
          styleProfile: previousPageStyle.profile || editorial.styleProfile,
          previousPageStyle: {
            examples: previousPageStyle.examples,
            historySummary: previousPageStyle.historySummary,
            styleDimensions: [
              'dominant color palette and saturation',
              'contrast, brightness and recurring color accents',
              'typography family, scale, weight and text density',
              'visual hierarchy, spacing and safe-area discipline',
              'photographic crop, lighting, depth and retouching treatment',
              'recurring brand elements such as logo, border, CTA or icon treatment',
              'caption length, tone, CTA and hashtag patterns by channel',
            ],
          },
          contactSheet: assets.map((asset, index) => ({
            photo: index + 1,
            ...plan.evidence.assets.find((item) => item.id === asset.id),
            usageCount: assetUsage.get(asset.id) || 0,
            usedMostRecently: earlier.rows.at(-1)?.asset_id === asset.id,
            requiredForThisPost: slot.requiredAssetId === asset.id,
            reservedForLater: futureRequiredAssetIds.has(asset.id),
          })),
        },
        images: [
          `data:image/jpeg;base64,${contactSheet.toString('base64')}`,
          ...(previousPageStyle.contactSheet
            ? [`data:image/jpeg;base64,${previousPageStyle.contactSheet.toString('base64')}`]
            : []),
          ...(previousGeneratedContactSheet
            ? [`data:image/jpeg;base64,${previousGeneratedContactSheet.toString('base64')}`]
            : []),
        ],
      })
      let rawContent: unknown
      try {
        rawContent = JSON.parse(responseText(response))
      } catch {
        throw new PlannerFailure('UNGROUNDED_CONTENT', [
          'Ofruesi nuk ktheu objektin e strukturuar të kërkuar.',
        ])
      }
      const normalizedContent =
        rawContent && typeof rawContent === 'object'
          ? { ...(rawContent as Record<string, unknown>), hashtags: normalizeGeneratedHashtags((rawContent as Record<string, unknown>).hashtags) }
          : rawContent
      const parsedContent = generatedPostSchema.safeParse(normalizedContent)
      if (!parsedContent.success) {
        throw new PlannerFailure('UNGROUNDED_CONTENT', [
          `Përgjigjja nuk përmbushi kontratën: ${parsedContent.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}.`,
        ])
      }
      const requestedAsset = assets.find((asset) => asset.id === parsedContent.data.assetId)
      const preferredAssets = assets
        .filter((asset) => !futureRequiredAssetIds.has(asset.id))
        .sort((left, right) => (assetUsage.get(left.id) || 0) - (assetUsage.get(right.id) || 0))
      const selectedAssetId =
        slot.requiredAssetId ||
        (requestedAsset && !futureRequiredAssetIds.has(requestedAsset.id)
          ? requestedAsset.id
          : preferredAssets[0]?.id) ||
        assets[0]!.id
      // Repair only machine-verifiable references locally. This is free and keeps
      // the provider's concept/copy while guaranteeing owned media, verified facts
      // and the layout already approved by the monthly strategy.
      content = {
        ...parsedContent.data,
        assetId: selectedAssetId,
        factIds: slot.factIds,
        creative: { ...parsedContent.data.creative, layout: slot.visualLayout },
      }
      original = assets.find((asset) => asset.id === selectedAssetId)!
      const imagePrompt = monthlyImagePrompt({
        brand: plan.evidence.brand,
        slot,
        creative: content.creative,
        styleProfile: previousPageStyle.profile || editorial.styleProfile,
        previousPageStyle: previousPageStyle.contactSheet
          ? {
              exampleCount: previousPageStyle.examples.length,
              dimensions: [
                'the dominant palette and recurring accent colors',
                'the typography scale and density',
                'the spacing and hierarchy',
                'the photographic crop and treatment',
                'the recurring brand elements without copying their exact layout',
              ],
            }
          : undefined,
        previousGeneratedPostCount: previousGeneratedAssets.length,
        revisionFeedback,
      })
      imageGeneration = await monthlyImageCall(db, {
        ...common,
        stageKey: monthlyAutomaticStageKey(
          'image',
          plan.evidence_hash,
          `${plan.completed_count}:${previousPageStyle.revision}`,
        ),
        prompt: imagePrompt,
        reference: original.bytes,
        styleReferences: previousPageStyle.contactSheet
          ? [
              { bytes: previousPageStyle.contactSheet },
              ...(previousGeneratedContactSheet
                ? [{ bytes: previousGeneratedContactSheet }]
                : []),
            ]
          : previousGeneratedContactSheet
            ? [{ bytes: previousGeneratedContactSheet }]
            : undefined,
      })
      // The provider result is the complete design. Local processing is limited to
      // format, dimensions and compression; it adds no template or visual element.
      creative = await normalizeGeneratedCreative(imageGeneration.bytes)
      const qualityResponse = await monthlyProviderCall(db, {
        ...common,
        stageKey: monthlyAutomaticStageKey(
          'quality',
          plan.evidence_hash,
          `${plan.completed_count}:${previousPageStyle.revision}`,
        ),
        capability: 'quality',
        maxOutput: 2000,
        schema: qualitySchema,
        input: {
          brand: plan.evidence.brand,
          slot,
          content,
          previousPosts: earlier.rows,
          previousGeneratedPostCount: previousGeneratedAssets.length,
          styleProfile: previousPageStyle.profile || editorial.styleProfile,
          previousPageStyle: {
            examples: previousPageStyle.examples,
            referenceCount: previousPageStyle.referenceCount,
            platformPublishedCount: previousPageStyle.platformPublishedCount,
            importedSocialCount: previousPageStyle.importedSocialCount,
            historySummary: previousPageStyle.historySummary,
          },
          revisionAttempt: attempt,
          imageOrder: [
            'Finished AI creative',
            'Original owned photograph',
            ...(previousPageStyle.contactSheet ? ['Previous page style references'] : []),
            ...(previousGeneratedContactSheet ? ['Earlier generated post references'] : []),
          ],
        },
        images: [
          `data:image/jpeg;base64,${creative.toString('base64')}`,
          `data:image/jpeg;base64,${original.bytes.toString('base64')}`,
          ...(previousPageStyle.contactSheet
            ? [`data:image/jpeg;base64,${previousPageStyle.contactSheet.toString('base64')}`]
            : []),
          ...(previousGeneratedContactSheet
            ? [`data:image/jpeg;base64,${previousGeneratedContactSheet.toString('base64')}`]
            : []),
        ],
      })
      quality = normalizeQualityReview(
        qualitySchema.parse(JSON.parse(responseText(qualityResponse))),
      )
      break
    }
    if (!content || !original || !creative || !imageGeneration || !quality)
      throw new PlannerFailure('GENERATION_FAILED')
    const business = await plannerStep('content.persist.business', () =>
      db.query<{ slug: string }>('SELECT slug FROM businesses WHERE id=$1', [plan.business_id]),
    )
    const businessSlug = business.rows[0]?.slug
    if (!businessSlug) throw new PlannerFailure('GENERATION_FAILED')
    const assetId = randomUUID()
    const storagePath = assetStoragePath(
      assetStorageFolder(businessSlug, plan.business_id),
      `${content.title}-${assetId}`,
    )
    await plannerStep('content.persist.storage', () => uploadAsset(storagePath, creative))
    try {
      const committed = await plannerStep('content.persist', () =>
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
        const countedPosts = await plannerStep('content.persist.post_usage', () =>
          postsCountedForLimit(client, plan.business_id, plan.month_key, currentAccess.paid),
        )
        const usage = await plannerStep('content.persist.usage', () =>
          client.query<{ bytes: number }>(
            'SELECT COALESCE(sum(size_bytes),0)::bigint AS bytes FROM assets WHERE business_id=$1',
            [plan.business_id],
          ),
        )
        if (
          !remainingMonthlyPosts(currentAccess.limits.posts_per_month, countedPosts) ||
          Number(usage.rows[0]?.bytes || 0) + creative.length >
            currentAccess.limits.media_storage_bytes
        )
          throw new PlannerFailure('QUOTA_EXCEEDED')
        const postId = randomUUID()
        if (!previousPageStyle) throw new PlannerFailure('GENERATION_FAILED')
        const provenance = {
          planId: plan.id,
          slot: plan.completed_count,
          evidenceHash: plan.evidence_hash,
          factIds: content.factIds,
          sourceUrls: slot.sourceUrls,
          styleReferenceRevision: previousPageStyle.revision,
          styleReferences: previousPageStyle.references,
          styleReferenceCount: previousPageStyle.referenceCount,
          platformPublishedStyleCount: previousPageStyle.platformPublishedCount,
          importedSocialStyleCount: previousPageStyle.importedSocialCount,
          pageStyleHistory: previousPageStyle.historySummary,
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
            "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height,creative_provenance) VALUES($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,1080,1350,$7)",
            [
              assetId,
              plan.business_id,
              content.title,
              JSON.stringify(['monthly-creative', slot.pillar]),
              storagePath,
              creative.length,
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
        if (!currentAccess.paid)
          await plannerStep('content.persist.trial_usage', () =>
            recordTrialPostUsage(client, plan.business_id),
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
        return true
        }),
      )
      if (!committed) await removeAsset(storagePath)
    } catch (error) {
      try {
        await removeAsset(storagePath)
      } catch (cleanupError) {
        console.error('Failed to clean up generated planner asset after rollback', {
          storagePath,
          error: cleanupError,
        })
      }
      throw error
    }
  } finally {
    contactSheet?.fill(0)
    previousPageStyle?.contactSheet?.fill(0)
    previousGeneratedContactSheet?.fill(0)
    releasePlannerAssets(previousGeneratedAssets)
    releasePlannerAssets(assets)
  }
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
          SET status='blocked',error_code=$1,next_run_at=now(),updated_at=now()
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
