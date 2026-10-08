import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireEntitlement } from '../../server/utils/trials'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('entitlement fail-safe behavior', () => {
  it('rejects an unknown entitlement instead of granting access', async () => {
    vi.stubGlobal('createError', createError)

    const db = {
      query: vi.fn(async () => ({ rows: [{
        trial_starts_at: new Date('2026-09-10T10:00:00.000Z'),
        trial_expires_at: new Date('2026-09-13T10:00:00.000Z'),
        trial_status: 'granted',
        trial_seconds_remaining: 3600,
        trial_posts_per_month: 3,
        paid_features: null,
        custom_name: null,
        policy: { duration_hours: 72, features: ['posts'], device_retention_days: 365, limits: {
          posts_per_month: 12, ai_requests_per_day: 0, media_storage_bytes: 268435456, social_accounts: 2, members: 1,
        } },
      }] })),
    }

    await expect(
      requireEntitlement('00000000-0000-4000-8000-000000000001', 'unknown' as never, db as never),
    ).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'ENTITLEMENT_REQUIRED', feature: 'unknown' },
    })
  })
})
