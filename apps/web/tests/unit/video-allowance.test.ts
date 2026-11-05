import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { videosCountedForLimit } from '../../server/utils/trials'

// A database that answers with how many renders are not failed, as the query
// asks, so the test reads what the count leaves out.
function fakeDatabase(statuses: string[]) {
  const asked: string[] = []
  const db = {
    async query(sql: string) {
      asked.push(sql)
      const counted = sql.includes("status<>'failed'") ? statuses.filter((status) => status !== 'failed') : statuses
      return { rows: [{ count: counted.length }] }
    },
  }
  return { db: db as unknown as Pool, asked }
}

describe('the package allowance for videos', () => {
  it('leaves out a video that could not be made, so trying again uses no extra video', async () => {
    const { db } = fakeDatabase(['ready', 'failed', 'failed', 'rendering', 'queued'])
    expect(await videosCountedForLimit(db, 'business-1')).toBe(3)
    const period = { startsAt: new Date('2026-11-01'), endsAt: new Date('2026-12-01') }
    expect(await videosCountedForLimit(fakeDatabase(['ready', 'failed']).db, 'business-1', period)).toBe(1)
  })
})
