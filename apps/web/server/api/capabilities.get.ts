import { authCapabilities, authConfiguration } from '../utils/auth-configuration'
import { aiCostConfigured } from '../utils/ai-costs'
import { aiProviderConfigured, aiProviderModelConfigured } from '../utils/ai-provider'
export default defineEventHandler(async () => {
  let emailVerificationRequired = true
  try {
    emailVerificationRequired = authConfiguration().requireEmailVerification
  } catch {
    /* Registration remains unavailable without configuration. */
  }
  let durationHours: number | null = null
  let trialPosts: number | null = null
  let databaseReady = false
  try {
    const db = database()
    await db.query('SELECT 1')
    databaseReady = true
    durationHours = (await trialPolicy(db)).duration_hours
    const trialPlan = await db.query<{ posts_per_month: number }>(
      'SELECT posts_per_month FROM plans WHERE is_trial=true AND active=true LIMIT 1',
    )
    trialPosts = Number(trialPlan.rows[0]?.posts_per_month ?? 0)
  } catch {
    /* Readiness is explicit when the database is unavailable. */
  }
  const auth = authCapabilities(databaseReady, durationHours !== null && !!process.env.TRIAL_HASH_KEY)
  return {
    ...auth,
    emailVerificationRequired,
    trialHours: durationHours,
    trialPosts,
    socialImport: metaConfigured(),
    publishing: (metaConfigured() || tiktokConfigured()) && process.env.PUBLISHING_ENABLED === 'true',
    ai:
      aiProviderConfigured() && aiProviderModelConfigured('OPENAI_MODEL') && aiCostConfigured(),
    billing: false,
  }
})
