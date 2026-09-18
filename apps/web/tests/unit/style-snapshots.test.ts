import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreviousPageStyle } from '../../server/utils/monthly-planner'
import {
  newestStylePosts,
  STYLE_SNAPSHOT_VERSION,
  styleRevision,
  styleSnapshotIsFresh,
} from '../../server/utils/style-snapshots'

afterEach(() => {
  vi.restoreAllMocks()
})

const now = new Date('2026-09-18T10:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
const fresh = (lastFetchAt: Date | null, isTrial = false, summaryVersion: unknown = STYLE_SNAPSHOT_VERSION) =>
  styleSnapshotIsFresh({ lastFetchAt, summaryVersion, isTrial, now })

describe('monthly style fetch cache', () => {
  it('reuses the cache when the fetch ran 10 days ago', () => {
    expect(fresh(daysAgo(10))).toBe(true)
  })

  it('fetches again once a month has passed', () => {
    expect(fresh(new Date('2026-08-18T10:00:00.000Z'))).toBe(false)
    expect(fresh(new Date('2026-08-18T10:00:01.000Z'))).toBe(true)
  })

  it('fetches when no snapshot exists or its summary format is outdated', () => {
    expect(fresh(null)).toBe(false)
    expect(fresh(daysAgo(1), false, 1)).toBe(false)
  })

  it('fetches the trial posts only once', () => {
    expect(fresh(daysAgo(400), true)).toBe(true)
    expect(fresh(null, true)).toBe(false)
  })
})

describe('cached page style', () => {
  it('uses the snapshot without calling Meta or the AI provider', async () => {
    const summary = {
      version: STYLE_SNAPSHOT_VERSION,
      examples: [{ channel: 'Facebook', caption: 'rent', publishedAt: '2026-09-16T02:43:02.000Z', mediaType: 'POST' }],
      references: [],
      referenceCount: 1,
      platformPublishedCount: 0,
      importedSocialCount: 1,
      historySummary: { totalPosts: 1 },
      profile: { tone: 'clear and friendly' },
    }
    const query = vi.fn(async () => ({
      rows: [
        {
          brand_id: '00000000-0000-4000-8000-000000000002',
          connection_id: '00000000-0000-4000-8000-000000000003',
          style_fetch_post_count: 30,
          is_trial: false,
          snapshot_summary: summary,
          snapshot_revision: 'cached-revision',
          last_style_fetch_at: daysAgo(10),
          contact_sheet_path: null,
        },
      ],
    }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const analyze = vi.fn()

    const style = await loadPreviousPageStyle(
      { query } as never,
      '00000000-0000-4000-8000-000000000001',
      { analyze, now },
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(style.revision).toBe('cached-revision')
    expect(style.profile).toEqual({ tone: 'clear and friendly' })
  })
})

describe('style revision', () => {
  const post = {
    source: 'facebook',
    providerId: '113047871855212_949128424930283',
    publishedAt: '2026-09-16T02:43:02.000Z',
    caption: 'rent',
  }

  it('stays the same when Meta re-signs the media URL of an unchanged post', () => {
    expect(
      styleRevision([{ ...post, mediaUrl: 'https://scontent.example/a.jpg?oh=first' }] as never),
    ).toBe(styleRevision([{ ...post, mediaUrl: 'https://scontent.example/a.jpg?oh=second' }] as never))
  })

  it('changes when a post is edited or a new post is published', () => {
    const original = styleRevision([post])
    expect(styleRevision([{ ...post, caption: 'rent a car' }])).not.toBe(original)
    expect(
      styleRevision([post, { ...post, providerId: 'new', publishedAt: '2026-09-17T00:00:00.000Z' }]),
    ).not.toBe(original)
  })
})

describe('package post allowance', () => {
  const posts = Array.from({ length: 45 }, (_, index) => ({
    publishedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    sortId: `post-${index}`,
  }))

  it.each([
    [10, 10],
    [20, 20],
    [30, 30],
  ])('keeps %i newest posts for a package allowance of %i', (limit, expected) => {
    const selected = newestStylePosts(posts, limit)
    expect(selected).toHaveLength(expected)
    expect(selected[0]!.sortId).toBe('post-44')
  })

  it('keeps every post when the page has fewer than the allowance', () => {
    expect(newestStylePosts(posts.slice(0, 3), 30)).toHaveLength(3)
  })
})
