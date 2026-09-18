import { evidenceHash } from './monthly-planner-domain'
import { addMonths } from './subscriptions'

// Bump when the cached summary shape changes; older snapshots are refetched.
export const STYLE_SNAPSHOT_VERSION = 2

/**
 * The page-style fetch (Meta + AI analysis) runs at most once a month per
 * brand. A trial fetches its posts only once. Callers cannot force an earlier
 * refresh: every caller, automatic or manual, goes through this check.
 */
export function styleSnapshotIsFresh(input: {
  lastFetchAt: Date | null
  summaryVersion: unknown
  isTrial: boolean
  now: Date
}) {
  if (!input.lastFetchAt || input.summaryVersion !== STYLE_SNAPSHOT_VERSION) return false
  if (input.isTrial) return true
  return input.lastFetchAt > addMonths(input.now, -1)
}

/**
 * Identifies the fetched posts by their stable identity and content. Meta
 * media URLs are signed and change on every fetch, so they are excluded:
 * unchanged posts keep the same revision, and every paid stage keyed by it
 * is reused instead of being generated and charged again.
 */
export function styleRevision(
  rows: Array<{
    source: string
    postId?: string
    providerId?: string
    assetId?: string
    publishedAt: string
    caption: string
  }>,
) {
  return evidenceHash(
    rows.map((row) => [
      row.source,
      row.postId || null,
      row.providerId || null,
      row.assetId || null,
      row.publishedAt,
      row.caption,
    ]),
  )
}

/** Keeps the package allowance of newest posts (10 / 20 / 30). */
export function newestStylePosts<T extends { publishedAt: string; sortId: string }>(
  rows: T[],
  limit: number | undefined,
) {
  const sorted = [...rows].sort((left, right) => {
    const dateOrder = Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    return dateOrder || right.sortId.localeCompare(left.sortId)
  })
  return limit ? sorted.slice(0, limit) : sorted
}
