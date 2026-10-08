import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remainingMonthlyPosts, requestedPlannerPosts } from '../../server/utils/monthly-planner-domain'
import { postsCountedForLimit, recordTrialPostUsage, trialStatus } from '../../server/utils/trials'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('monthly post allowance', () => {
  it('accepts a selected quantity only within the remaining allowance', () => {
    expect(requestedPlannerPosts(2, 3)).toBe(2)
    expect(() => requestedPlannerPosts(4, 3)).toThrow('QUANTITY_EXCEEDS_REMAINING')
  })
  it('blocks the 15th post on Pako 1 after 14 generated posts', () => {
    expect(remainingMonthlyPosts(14, 13)).toBe(1)
    expect(remainingMonthlyPosts(14, 14)).toBe(0)
    expect(remainingMonthlyPosts(14, 15)).toBe(0)
  })

  it.each([
    [3, 0, 3],
    [30, 10, 20],
    [60, 59, 1],
  ])('allows %i posts per month with %i created: %i remaining', (limit, created, remaining) => {
    expect(remainingMonthlyPosts(limit, created)).toBe(remaining)
  })
})

describe('trial post allowance', () => {
  it('reads durable trial usage instead of surviving post rows', async () => {
    const query = vi.fn(async () => ({ rows: [{ count: 3 }] }))
    await expect(
      postsCountedForLimit(
        { query } as never,
        '00000000-0000-4000-8000-000000000001',
        '2026-09',
        false,
      ),
    ).resolves.toBe(3)
    expect(query.mock.calls[0]?.[0]).toContain('posts_used')
  })

  it('counts a custom package across its exact billing period, not by calendar month', async () => {
    const query = vi.fn(async () => ({ rows: [{ count: 14 }] }))

    await expect(
      postsCountedForLimit(
        { query } as never,
        '00000000-0000-4000-8000-000000000001',
        '2026-08',
        true,
        {
          startsAt: new Date('2026-07-25T00:00:00.000Z'),
          endsAt: new Date('2026-08-25T00:00:00.000Z'),
        },
      ),
    ).resolves.toBe(14)

    expect(query.mock.calls[0]?.[0]).toContain('created_at>=$2')
    expect(query.mock.calls[0]?.[0]).toContain('created_at<$3')
    expect(query.mock.calls[0]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001',
      new Date('2026-07-25T00:00:00.000Z'),
      new Date('2026-08-25T00:00:00.000Z'),
    ])
  })

  it('records positive trial usage atomically', async () => {
    const query = vi.fn(async () => ({ rows: [{ posts_used: 3 }] }))
    await expect(
      recordTrialPostUsage(
        { query } as never,
        '00000000-0000-4000-8000-000000000001',
        1,
      ),
    ).resolves.toBe(3)
    await expect(
      recordTrialPostUsage(
        { query } as never,
        '00000000-0000-4000-8000-000000000001',
        0,
      ),
    ).rejects.toThrow('positive integer')
  })

  it('follows the Free Trial package instead of the legacy trial setting', async () => {
    vi.stubGlobal('createError', createError)
    const query = vi.fn(async () => ({ rows: [{
      trial_starts_at: new Date('2026-09-17T10:00:00.000Z'),
      trial_expires_at: new Date('2026-09-20T10:00:00.000Z'),
      trial_status: 'granted',
      trial_seconds_remaining: 3600,
      trial_posts_per_month: 3,
      policy: { duration_hours: 72, features: ['posts', 'ai'], device_retention_days: 365, limits: {
        posts_per_month: 12, ai_requests_per_day: 200, media_storage_bytes: 5368709120, social_accounts: 2, members: 1,
      } },
      paid_features: null,
      custom_name: null,
    }] }))

    const access = await trialStatus('00000000-0000-4000-8000-000000000001', { query } as never)

    expect(access.paid).toBe(false)
    expect(access.limits.posts_per_month).toBe(3)
  })

  it('loads trial access in one database round trip', async () => {
    vi.stubGlobal('createError', createError)
    const query = vi.fn(async () => ({ rows: [{
      trial_starts_at: new Date('2026-09-17T10:00:00.000Z'),
      trial_expires_at: new Date('2026-09-20T10:00:00.000Z'),
      trial_status: 'granted',
      trial_seconds_remaining: 3600,
      policy: {
        duration_hours: 72,
        features: ['posts', 'ai'],
        device_retention_days: 365,
        limits: { posts_per_month: 12, ai_requests_per_day: 200, media_storage_bytes: 5368709120, social_accounts: 2, members: 1 },
      },
      trial_posts_per_month: 3,
      paid_features: null,
      custom_name: null,
    }] }))

    const access = await trialStatus('00000000-0000-4000-8000-000000000001', { query } as never)

    expect(access.state).toBe('active')
    expect(access.limits.posts_per_month).toBe(3)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('passes the active custom package period to downstream usage tracking', async () => {
    vi.stubGlobal('createError', createError)
    const startsAt = new Date('2026-09-25T00:00:00.000Z')
    const endsAt = new Date('2026-09-30T00:00:00.000Z')
    const query = vi.fn(async () => ({ rows: [{
      trial_status: null,
      custom_name: 'Paketa 25-30',
      custom_posts_included: 3,
      custom_starts_at: startsAt,
      custom_ends_at: endsAt,
      policy: { duration_hours: 72, features: ['posts', 'ai'], device_retention_days: 365, limits: {
        posts_per_month: 12, ai_requests_per_day: 200, media_storage_bytes: 5368709120, social_accounts: 2, members: 1,
      } },
      paid_features: null,
    }] }))

    const access = await trialStatus('00000000-0000-4000-8000-000000000001', { query } as never)

    expect(access.quotaPeriod).toEqual({ startsAt, endsAt })
  })
})
