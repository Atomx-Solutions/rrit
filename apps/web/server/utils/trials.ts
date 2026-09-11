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
  await client.query(
    'INSERT INTO trial_grants (business_id, expires_at, status, reason) VALUES ($1, now() + make_interval(hours => $2), $3, $4) ON CONFLICT (business_id) DO NOTHING',
    [
      businessId,
      policy.duration_hours,
      duplicate ? 'blocked' : 'granted',
      duplicate ? 'identity_previously_used' : null,
    ],
  )
}
export async function claimSocialTrialIdentities(
  client: PoolClient,
  businessId: string,
  identities: { kind: IdentityKind; value: string }[],
) {
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
  if (duplicate)
    await client.query(
      "UPDATE trial_grants SET status = 'revoked', reason = 'social_identity_previously_used' WHERE business_id = $1 AND status = 'granted'",
      [businessId],
    )
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
  const paidAccess = paid.rows[0]
  const paidFeatures = entitlementFeatureSchema.array().safeParse(paidAccess?.features)
  const paidLimits = planLimitsSchema.safeParse(paidAccess?.limits)
  if (paidAccess && (!paidFeatures.success || !paidLimits.success))
    throw createError({ statusCode: 503, message: 'Plani aktiv nuk është konfiguruar saktë.' })
  return {
    state,
    startsAt: row?.starts_at?.toISOString() || null,
    expiresAt: row?.expires_at?.toISOString() || null,
    secondsRemaining: row?.seconds_remaining || 0,
    durationHours: policy.duration_hours,
    paid: !!paid.rows.length,
    features: paidFeatures.success ? paidFeatures.data : state === 'active' ? policy.features : [],
    limits: paidLimits.success ? paidLimits.data : policy.limits,
    plan:
      paidAccess?.plan_name && paidAccess?.plan_version
        ? { name: paidAccess.plan_name as string, version: paidAccess.plan_version as number }
        : null,
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

export async function usageSnapshot(
  businessId: string,
  db: Pool | PoolClient = database(),
): Promise<UsageSnapshot> {
  const access = await trialStatus(businessId, db)
  const counters = await db.query(
    `SELECT
      (SELECT count(*)::integer FROM posts WHERE business_id=$1 AND created_at>=date_trunc('month',now())) AS posts_per_month,
      (SELECT COALESCE(sum(COALESCE(size_bytes, octet_length(bytes))),0)::bigint FROM assets WHERE business_id=$1) AS media_storage_bytes,
      (SELECT COALESCE(requests,0)::integer FROM ai_daily_usage WHERE business_id=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date) AS ai_requests_per_day,
      (SELECT CASE WHEN instagram_id IS NOT NULL THEN 2 ELSE 1 END FROM meta_connections WHERE business_id=$1 AND status='connected') AS social_accounts`,
    [businessId],
  )
  const row = counters.rows[0]
  const current: Record<QuotaKey, number> = {
    posts_per_month: Number(row.posts_per_month || 0),
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
