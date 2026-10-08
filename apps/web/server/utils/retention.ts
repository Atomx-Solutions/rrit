import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { expireCustomPackages } from './custom-packages'
import { runPackageExpiryReminderBatch } from './package-expiry-reminders'

const retentionPolicySchema = z.object({
  oauth_state_days: z.number().int().min(1).max(90),
  ai_generation_days: z.number().int().min(30).max(730),
  ai_usage_days: z.number().int().min(30).max(1000),
  trial_claim_days: z.number().int().min(30).max(1000),
  validation_days: z.number().int().min(30).max(1000),
  social_post_days: z.number().int().min(30).max(3650),
})

export async function retentionPolicy(db: Pool | PoolClient = database()) {
  const result = await db.query("SELECT value FROM app_settings WHERE key='retention'")
  const policy = retentionPolicySchema.safeParse(result.rows[0]?.value)
  if (!policy.success)
    throw createError({ statusCode: 503, message: 'server.RETENTION_POLICY_NOT_CONFIGURED' })
  return policy.data
}

// An invitation that was never accepted stops working at its expiry; closing it
// keeps the superadmin list from offering a link the database would refuse.
async function expireOrganizationInvitations(client: PoolClient) {
  const result = await client.query<{ closed: number }>(
    'SELECT public.expire_organization_invitations() AS closed',
  )
  return result.rows[0]?.closed || 0
}

// An organization opened for an invitation that was never accepted has no
// member, no business and no package. Left alone it would accumulate in every
// superadmin list, so it is removed once its invitation has been closed for a
// while and nothing was ever attached to it.
async function removeAbandonedInvitedOrganizations(client: PoolClient) {
  const result = await client.query<{ removed: number }>(
    'SELECT public.remove_abandoned_invited_organizations() AS removed',
  )
  return result.rows[0]?.removed || 0
}

export async function runRetentionBatch(db: Pool = database()) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rrit-retention'))")
    const policy = await retentionPolicy(client)
    await client.query(
      "INSERT INTO maintenance_runs(name,last_started_at,failure) VALUES('retention',now(),NULL) ON CONFLICT(name) DO UPDATE SET last_started_at=now(),failure=NULL",
    )
    const statements: [string, number][] = [
      [
        "DELETE FROM meta_oauth_states WHERE expires_at<now()-make_interval(days => $1::int)",
        policy.oauth_state_days,
      ],
      [
        "DELETE FROM ai_generations WHERE created_at<now()-make_interval(days => $1::int)",
        policy.ai_generation_days,
      ],
      [
        "DELETE FROM ai_daily_usage WHERE usage_day<(now() AT TIME ZONE 'UTC')::date-$1::int",
        policy.ai_usage_days,
      ],
      [
        "DELETE FROM trial_claims WHERE claimed_at<now()-make_interval(days => $1::int)",
        policy.trial_claim_days,
      ],
      [
        "DELETE FROM post_validations WHERE created_at<now()-make_interval(days => $1::int)",
        policy.validation_days,
      ],
      [
        "DELETE FROM social_posts WHERE published_at<now()-make_interval(days => $1::int)",
        policy.social_post_days,
      ],
    ]
    const keys = [
      'oauthStates',
      'aiGenerations',
      'aiUsageDays',
      'trialClaims',
      'validations',
      'socialPosts',
    ]
    const removed: Record<string, number> = {}
    for (const [index, statement] of statements.entries()) {
      const result = await client.query(statement[0], [statement[1]])
      removed[keys[index]!] = result.rowCount || 0
    }
    removed.expiredCustomPackages = await expireCustomPackages(client)
    removed.expiredInvitations = await expireOrganizationInvitations(client)
    removed.abandonedOrganizations = await removeAbandonedInvitedOrganizations(client)
    await client.query(
      "UPDATE maintenance_runs SET last_completed_at=now(),result=$1,failure=NULL WHERE name='retention'",
      [JSON.stringify(removed)],
    )
    await client.query('COMMIT')
    const reminders = await runPackageExpiryReminderBatch(db)
    return { ...removed, packageExpiryReminders: reminders.sent }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
