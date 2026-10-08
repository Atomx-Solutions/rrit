import { describe, expect, it, vi } from 'vitest'
import { usageSnapshot, type TrialStatus } from '../../server/utils/trials'

describe('usage snapshot', () => {
  it('uses the supplied access status without repeating its database lookups', async () => {
    const access: TrialStatus = {
      state: 'active', startsAt: null, expiresAt: null, secondsRemaining: 3600,
      durationHours: 72, paid: false, features: ['posts'], plan: null,
      limits: { posts_per_month: 3, ai_requests_per_day: 10, media_storage_bytes: 1000, social_accounts: 1, members: 1 },
    }
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes('AS posts_per_month')) throw new Error(`Unexpected query: ${sql}`)
      return { rows: [{ posts_per_month: 0, trial_posts_used: 1, media_storage_bytes: 0, ai_requests_per_day: 0, social_accounts: 0 }] }
    })

    const usage = await usageSnapshot('business-1', { query } as never, access)

    expect(usage.posts_per_month).toEqual({ current: 1, limit: 3 })
    expect(query).toHaveBeenCalledTimes(1)
  })
})
