import { authCapabilities, authConfiguration } from '../utils/auth-configuration'
import { aiCostConfigured } from '../utils/ai-costs'
export default defineEventHandler(async () => {
  let emailVerificationRequired = true
  try {
    emailVerificationRequired = authConfiguration().requireEmailVerification
  } catch {
    /* Registration remains unavailable without configuration. */
  }
  let durationHours: number | null = null
  let databaseReady = false
  try {
    await database().query('SELECT 1')
    databaseReady = true
    durationHours = (await trialPolicy()).duration_hours
  } catch {
    /* Readiness is explicit when the database is unavailable. */
  }
  const auth = authCapabilities(databaseReady, durationHours !== null && !!process.env.TRIAL_HASH_KEY)
  return {
    ...auth,
    emailVerificationRequired,
    trialHours: durationHours,
    socialImport: metaConfigured(),
    publishing: metaConfigured() && process.env.PUBLISHING_ENABLED === 'true',
    ai: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL && aiCostConfigured()),
    billing: false,
  }
})
