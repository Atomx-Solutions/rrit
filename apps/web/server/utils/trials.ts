import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { Pool, PoolClient } from 'pg'
import {
  entitlementFeatureSchema,
  planLimitsSchema,
  trialPolicySchema,
  type EntitlementFeature,
  type PlanLimits,
} from '../../shared/schemas/catalog'
import { expireRemainingCredits, grantMonthlyCredits } from './credits'

type IdentityKind = 'email' | 'device' | 'facebook_user' | 'facebook_page' | 'instagram_account'
function trialKey() {
  const key = process.env.TRIAL_HASH_KEY
  if (!key || key.length < 32)
    throw createError({ statusCode: 503, message: 'Trial-i ende nuk është konfiguruar.' })
  return key
}
export function identityHash(kind: IdentityKind, value: string) {
  return createHmac('sha256', trialKey())
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest('hex')
}
export function deviceIdentity(event: H3Event) {
  const cookie = getCookie(event, 'rrit-device') || ''
  const [id, signature] = cookie.split('.')
  if (id && /^[a-f0-9]{48}$/.test(id) && signature && /^[a-f0-9]{64}$/.test(signature)) {
    const expected = identityHash('device', id)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return id
  }
  const value = randomBytes(24).toString('hex')
  setCookie(event, 'rrit-device', `${value}.${identityHash('device', value)}`, {
    httpOnly: true,
    secure: process.env.APP_URL?.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  })
  return value
}
export async function trialPolicy(db: Pool | PoolClient = database()) {
  const result = await db.query('SELECT value FROM app_settings WHERE key = $1', ['trial'])
  const policy = trialPolicySchema.safeParse(result.rows[0]?.value)
  if (!policy.success)
    throw createError({ statusCode: 503, message: 'Konfigurimi i trial-it nuk është i vlefshëm.' })
  return policy.data
}
// Call in the business-creation transaction. Uniqueness is decided by PostgreSQL.
export async function grantTrial(
  client: PoolClient,
  businessId: string,
  email: string,
  device: string,
) {
  const policy = await trialPolicy(client)
  const identities = [
    ['device', identityHash('device', device)],
    ['email', identityHash('email', email)],
  ] as const
  let duplicate = false
  for (const [kind, digest] of identities) {
    const claim = await client.query(
      'INSERT INTO trial_claims (kind, value_hash, business_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING business_id',
      [kind, digest, businessId],
    )
    if (!claim.rows.length) {
      const existing = await client.query(
        'SELECT business_id FROM trial_claims WHERE kind = $1 AND value_hash = $2',
        [kind, digest],
      )
      if (existing.rows[0]?.business_id !== businessId) duplicate = true
    }
  }
  const grant = await client.query<{ starts_at: Date; expires_at: Date; status: string }>(
    'INSERT INTO trial_grants (business_id, expires_at, status, reason) VALUES ($1, now() + make_interval(hours => $2), $3, $4) ON CONFLICT (business_id) DO NOTHING RETURNING starts_at,expires_at,status',
    [
      businessId,
      policy.duration_hours,
      duplicate ? 'blocked' : 'granted',
      duplicate ? 'identity_previously_used' : null,
    ],
  )
  const granted = grant.rows[0]
  if (!granted || granted.status !== 'granted') return
  // Legacy fixtures/records can still exist without the additive organization
  // bridge. Preserve their established trial behavior; the commercial wallet
  // starts once the organization aggregate exists.
  const organization = await client.query('SELECT id FROM organizations WHERE id=$1', [businessId])
  if (!organization.rowCount) return
  // The Free Trial package owns the post allowance, and the credits have to
  // follow the same number. Reading the legacy app_settings limit here is what
  // made a three-post trial arrive with twelve posts' worth of credits.
  const trialPlan = await client.query<{ posts_per_month: number }>(
    'SELECT posts_per_month FROM plans WHERE is_trial=true AND active=true LIMIT 1',
  )
  const trialPosts = Number(trialPlan.rows[0]?.posts_per_month ?? 0)
  // No trial package means no allowance, so there is nothing to fund either.
  if (!trialPosts) return
  // What a post is worth is a platform setting the superadmin edits, the same
  // rate custom packages are priced in. A trial funds its posts at that rate
  // rather than at one written into the application.
  const rate = await client.query<{ credits_per_post: number }>(
    'SELECT public.credits_per_post() AS credits_per_post',
  )
  const creditsPerPost = Number(rate.rows[0]?.credits_per_post ?? 0)
  if (!creditsPerPost) return
  const monthlyCredits = trialPosts * creditsPerPost
  await grantMonthlyCredits(client, {
    organizationId: businessId,
    // A trial has no subscription row, and credit_ledger.subscription_id still
    // references one. The organization owns the grant, so the column stays
    // null; the idempotency key falls back to the organization and keeps the
    // exact value it had when the id was passed here.
    subscriptionId: null,
    monthlyCredits,
    periodStart: granted.starts_at,
    periodEnd: granted.expires_at,
  })
}
export async function claimSocialTrialIdentities(
  client: PoolClient,
  businessId: string,
  identities: { kind: IdentityKind; value: string }[],
) {
  // Only a tenant that actually received a trial may consume a Meta identity.
  // Paid or previously blocked tenants must not burn a page's future trial.
  const trial = await client.query<{ status: string }>(
    'SELECT status FROM trial_grants WHERE business_id=$1 FOR UPDATE',
    [businessId],
  )
  if (trial.rows[0]?.status !== 'granted') return
  let duplicate = false
  for (const identity of identities.sort((a, b) =>
    `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
  )) {
    const digest = identityHash(identity.kind, identity.value)
    const claim = await client.query(
      'INSERT INTO trial_claims (kind, value_hash, business_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING business_id',
      [identity.kind, digest, businessId],
    )
    if (!claim.rows.length) {
      const existing = await client.query(
        'SELECT business_id FROM trial_claims WHERE kind = $1 AND value_hash = $2',
        [identity.kind, digest],
      )
      if (existing.rows[0]?.business_id !== businessId) duplicate = true
    }
  }
  if (!duplicate) return
  // A Meta page or account that already used a trial never grants another:
  // the trial, its subscription and its credits all stop here.
  const revoked = await client.query(
    "UPDATE trial_grants SET status = 'revoked', reason = 'social_identity_previously_used' WHERE business_id = $1 AND status = 'granted' RETURNING business_id",
    [businessId],
  )
  if (!revoked.rowCount) return
  await expireRemainingCredits(client, {
    organizationId: businessId,
    subscriptionId: null,
    idempotencyKey: `trial-revoked:${businessId}`,
  })
}
export interface TrialStatus {
  state: string
  startsAt: string | null
  expiresAt: string | null
  secondsRemaining: number
  durationHours: number
  paid: boolean
  features: EntitlementFeature[]
  limits: PlanLimits
  plan: { name: string; version: number } | null
  // Present only for a custom package, whose negotiated dates define the post
  // quota window rather than a calendar month.
  quotaPeriod?: { startsAt: Date; endsAt: Date }
}
export type PlanningAccess = Pick<
  TrialStatus,
  'paid' | 'features' | 'limits' | 'plan' | 'expiresAt' | 'quotaPeriod'
>

type PaidEntitlementRow = {
  features: unknown
  limits: unknown
  plan_name?: string | null
  plan_version?: number | null
  valid_until?: Date | string | null
}

function paidEntitlementAccess(row: PaidEntitlementRow | undefined): PlanningAccess | null {
  if (!row) return null
  const features = entitlementFeatureSchema.array().safeParse(row.features)
  const limits = planLimitsSchema.safeParse(row.limits)
  if (!features.success || !limits.success)
    throw createError({ statusCode: 503, message: 'Plani aktiv nuk është konfiguruar saktë.' })
  return {
    paid: true,
    features: features.data,
    limits: limits.data,
    plan:
      row.plan_name && row.plan_version ? { name: row.plan_name, version: row.plan_version } : null,
    expiresAt: row.valid_until ? new Date(row.valid_until).toISOString() : null,
  }
}

// A paid PRC-02 subscription is the source of truth for the package. Its post
// allowance comes from the plan; the other operational limits stay shared.
async function customPackageAccess(
  businessId: string,
  coversFrom: Date,
  coversUntil: Date,
  db: Pool | PoolClient,
  allowPartialCoverage = false,
): Promise<PlanningAccess | null> {
  const result = await db.query<{
    name: string
    posts_included: number
    videos_included: number
    starts_at: Date
    ends_at: Date
  }>(
    `SELECT name,posts_included,videos_included,starts_at,ends_at
      FROM custom_packages
      WHERE organization_id=$1
        AND status='active'
        AND ${allowPartialCoverage ? 'starts_at<$3 AND ends_at>$2' : 'starts_at<=$2 AND ends_at>=$3'}
      ORDER BY ends_at DESC LIMIT 1`,
    [businessId, coversFrom, coversUntil],
  )
  const row = result.rows[0]
  if (!row) return null
  const policy = await trialPolicy(db)
  return {
    paid: true,
    features: [...entitlementFeatureSchema.options],
    limits: {
      ...policy.limits,
      posts_per_month: Number(row.posts_included),
      videos_per_month: Number(row.videos_included),
    },
    plan: { name: row.name, version: 1 },
    expiresAt: new Date(row.ends_at).toISOString(),
    quotaPeriod: { startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) },
  }
}

// Future calendars use the entitlement that covers that complete billing
// month, rather than today's trial/package. This prevents drafts beyond an
// expiry date and snapshots the limits that actually govern the target month.
export async function paidAccessForPlanningMonth(
  businessId: string,
  month: string,
  db: Pool | PoolClient = database(),
): Promise<PlanningAccess | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const start = new Date(`${month}-01T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  // A negotiated package may span only part of a calendar month. The planner
  // receives its exact quota window and rejects slots outside it.
  const custom = await customPackageAccess(businessId, start, end, db, true)
  if (custom) return custom
  const paid = await db.query<PaidEntitlementRow>(
    `SELECT features,limits,plan_name,plan_version,valid_until
       FROM entitlements
      WHERE business_id=$1 AND valid_from<=$2::date AND valid_until>=$3::date
      ORDER BY valid_until DESC LIMIT 1`,
    [businessId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
  )
  return paidEntitlementAccess(paid.rows[0])
}

export type QuotaKey = keyof PlanLimits
export type UsageSnapshot = Record<QuotaKey, { current: number; limit: number }>
export async function trialStatus(
  businessId: string,
  db: Pool | PoolClient = database(),
): Promise<TrialStatus> {
  const result = await db.query(
    'SELECT starts_at, expires_at, status, reason, GREATEST(0, EXTRACT(EPOCH FROM (expires_at - now())))::integer AS seconds_remaining FROM trial_grants WHERE business_id = $1',
    [businessId],
  )
  const row = result.rows[0]
  const paid = await db.query(
    'SELECT features,limits,plan_name,plan_version,valid_until FROM entitlements WHERE business_id = $1 AND valid_from <= now() AND valid_until > now()',
    [businessId],
  )
  const policy = await trialPolicy(db)
  const state = row
    ? row.status === 'granted'
      ? row.seconds_remaining > 0
        ? 'active'
        : 'expired'
      : row.status
    : 'unavailable'
  const now = new Date()
  const paidAccess =
    (await customPackageAccess(businessId, now, now, db))
    || paidEntitlementAccess(paid.rows[0])
  // The Free Trial package, rather than the legacy trial setting, owns the post
  // and video allowances. An inactive or missing trial package grants neither.
  const trialPlan = paidAccess || state !== 'active'
    ? undefined
    : (
        await db.query<{ posts_per_month: number; videos_per_month: number }>(
          `SELECT plan.posts_per_month, plan.videos_per_month
             FROM plans plan
            WHERE plan.is_trial=true
              AND plan.active=true
            LIMIT 1`,
        )
      ).rows[0]
  const trialLimits = {
    ...policy.limits,
    posts_per_month: state === 'active' && trialPlan ? Number(trialPlan.posts_per_month) : 0,
    videos_per_month: state === 'active' && trialPlan ? Number(trialPlan.videos_per_month) : 0,
  }
  return {
    state,
    startsAt: row?.starts_at?.toISOString() || null,
    expiresAt: row?.expires_at?.toISOString() || null,
    secondsRemaining: row?.seconds_remaining || 0,
    durationHours: policy.duration_hours,
    paid: !!paidAccess,
    features: paidAccess?.features || (state === 'active' ? policy.features : []),
    limits: paidAccess?.limits || trialLimits,
    plan: paidAccess?.plan || null,
    quotaPeriod: paidAccess?.quotaPeriod,
  }
}
export async function requireEntitlement(
  businessId: string,
  feature: EntitlementFeature,
  db: Pool | PoolClient = database(),
) {
  const access = await trialStatus(businessId, db)
  if (!access.features.includes(feature))
    throw createError({
      statusCode: 402,
      message:
        access.state === 'blocked' || access.state === 'revoked'
          ? 'Trial-i falas është përdorur më parë për këtë identitet ose pajisje. Të dhënat e tua mbeten të disponueshme.'
          : 'Trial-i falas ka përfunduar. Të dhënat e tua mbeten të disponueshme.',
      data: { code: 'ENTITLEMENT_REQUIRED', feature },
    })
}

/**
 * Posts counted against the package allowance. Subscriptions retain their
 * calendar-month allowance, while a custom package supplies its negotiated
 * date window. The trial's allowance never renews, so every post counts.
 */
export async function postsCountedForLimit(
  db: Pool | PoolClient,
  businessId: string,
  month: string,
  paid: boolean,
  quotaPeriod?: { startsAt: Date; endsAt: Date },
) {
  const result = quotaPeriod
    ? await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM posts
          WHERE business_id=$1 AND created_at>=$2 AND created_at<$3
            AND payload->>'channel' <> 'TikTok'`,
        [businessId, quotaPeriod.startsAt, quotaPeriod.endsAt],
      )
    : paid
    ? await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM posts WHERE business_id=$1 AND quota_month=$2::date AND payload->>'channel' <> 'TikTok'",
        [businessId, `${month}-01`],
      )
    : await db.query<{ count: number }>(
        'SELECT COALESCE(posts_used,0)::integer AS count FROM trial_grants WHERE business_id=$1',
        [businessId],
      )
  return Number(result.rows[0]?.count || 0)
}

/**
 * Videos rendered against the allowance. There is no trial grant for videos, so
 * this is only ever the package period or the calendar quota month.
 */
export async function videosCountedForLimit(
  db: Pool | PoolClient,
  businessId: string,
  quotaPeriod?: { startsAt: Date; endsAt: Date },
) {
  const result = quotaPeriod
    ? await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM tiktok_video_renders
          WHERE business_id=$1 AND created_at>=$2 AND created_at<$3`,
        [businessId, quotaPeriod.startsAt, quotaPeriod.endsAt],
      )
    : await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM tiktok_video_renders
          WHERE business_id=$1 AND quota_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`,
        [businessId],
      )
  return Number(result.rows[0]?.count || 0)
}

/** Records a generated/new post against the one-time trial allowance. */
export async function recordTrialPostUsage(
  db: Pool | PoolClient,
  businessId: string,
  increment = 1,
) {
  if (!Number.isInteger(increment) || increment < 1)
    throw new Error('Trial post usage increment must be a positive integer.')
  const result = await db.query<{ posts_used: number }>(
    "UPDATE trial_grants SET posts_used=posts_used+$2 WHERE business_id=$1 AND status='granted' AND NOT EXISTS (SELECT 1 FROM custom_packages WHERE organization_id=$1 AND status='active' AND starts_at<=now() AND ends_at>now()) RETURNING posts_used",
    [businessId, increment],
  )
  return Number(result.rows[0]?.posts_used || 0)
}

export async function usageSnapshot(
  businessId: string,
  db: Pool | PoolClient = database(),
): Promise<UsageSnapshot> {
  const [access, counters] = await Promise.all([
    trialStatus(businessId, db),
    db.query(
      `SELECT
        (SELECT count(*)::integer FROM posts WHERE business_id=$1 AND quota_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date) AS posts_per_month,
        (SELECT COALESCE(posts_used,0)::integer FROM trial_grants WHERE business_id=$1) AS trial_posts_used,
        (
          (SELECT COALESCE(sum(COALESCE(size_bytes, octet_length(bytes))),0)::bigint FROM assets WHERE business_id=$1)
          -- Rendered videos live in the same storage bucket as the photos, so
          -- they are measured against the same allowance. Only rows that
          -- actually hold a file count; a failed render stored nothing.
          + (SELECT COALESCE(sum(size_bytes),0)::bigint FROM tiktok_video_renders WHERE business_id=$1 AND storage_path IS NOT NULL)
        ) AS media_storage_bytes,
        (SELECT COALESCE(requests,0)::integer FROM ai_daily_usage WHERE business_id=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date) AS ai_requests_per_day,
        (SELECT CASE WHEN instagram_id IS NOT NULL THEN 2 ELSE 1 END FROM meta_connections WHERE business_id=$1 AND status='connected') AS social_accounts,
        (SELECT count(*)::integer FROM tiktok_video_renders WHERE business_id=$1 AND quota_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date) AS videos_per_month`,
      [businessId],
    ),
  ])
  const row = counters.rows[0]
  const packagePosts = access.quotaPeriod
    ? await postsCountedForLimit(
        db,
        businessId,
        new Date().toISOString().slice(0, 7),
        true,
        access.quotaPeriod,
      )
    : null
  // Videos follow the post rule: inside a package period they are counted by
  // the period, otherwise by the calendar month they were charged to.
  const packageVideos = access.quotaPeriod
    ? await videosCountedForLimit(db, businessId, access.quotaPeriod)
    : null
  const current: Record<QuotaKey, number> = {
    // Same rule as postsCountedForLimit: the trial allowance never renews.
    posts_per_month: Number(
      (access.paid ? (packagePosts ?? row.posts_per_month) : row.trial_posts_used) || 0,
    ),
    videos_per_month: Number((packageVideos ?? row.videos_per_month) || 0),
    ai_requests_per_day: Number(row.ai_requests_per_day || 0),
    media_storage_bytes: Number(row.media_storage_bytes || 0),
    social_accounts: Number(row.social_accounts || 0),
    members: 1,
  }
  return Object.fromEntries(
    (Object.keys(access.limits) as QuotaKey[]).map((key) => [
      key,
      { current: current[key], limit: access.limits[key] },
    ]),
  ) as UsageSnapshot
}

export async function requireQuota(
  businessId: string,
  key: QuotaKey,
  increment = 1,
  db: Pool | PoolClient = database(),
) {
  const quota = (await usageSnapshot(businessId, db))[key]
  if (key === 'posts_per_month') {
    const reservations = await db.query(
      `SELECT COALESCE(sum(target_count-completed_count),0)::integer AS count
         FROM monthly_plans
        WHERE business_id=$1
          AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
          AND status IN ('queued','running')`,
      [businessId],
    )
    quota.current += Number(reservations.rows[0]?.count || 0)
  }
  if (increment < 0 || quota.current + increment > quota.limit)
    throw createError({
      statusCode: 402,
      message: 'Ke arritur kufirin e planit për këtë veprim.',
      data: {
        code: 'QUOTA_EXCEEDED',
        quota: key,
        current: quota.current,
        limit: quota.limit,
      },
    })
  return quota
}
