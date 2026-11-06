import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { runPackageExpiry } from '../../server/utils/custom-packages'

// A database that answers the expiry round's queries and records them.
function fakeDatabase(options: { lockFree?: boolean; expired?: number; failExpiry?: boolean } = {}) {
  const asked: string[] = []
  const release = vi.fn()
  const client = {
    async query(sql: string) {
      asked.push(sql)
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: options.lockFree ?? true }] }
      if (sql.includes('app.expire_custom_packages')) {
        if (options.failExpiry) throw new Error('lock timeout')
        return { rows: [{ expired: options.expired ?? 0 }] }
      }
      return { rows: [] }
    },
    release,
  }
  return { db: { connect: async () => client } as unknown as Pool, asked, release }
}

describe('a round of package expiry', () => {
  it('ends the packages that are over in one short transaction', async () => {
    const { db, asked, release } = fakeDatabase({ expired: 2 })
    await expect(runPackageExpiry(db)).resolves.toEqual({ expired: 2, trialCreditsExpired: 0, abandonedRunsSettled: 0 })
    expect(asked[0]).toBe('BEGIN')
    // A row another session holds is given up on, not waited for.
    expect(asked[1]).toMatch(/SET LOCAL lock_timeout/)
    expect(asked.at(-1)).toBe('COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })

  it('leaves the work to a round already under way instead of waiting for it', async () => {
    const { db, asked } = fakeDatabase({ lockFree: false })
    await expect(runPackageExpiry(db)).resolves.toEqual({ skipped: true })
    expect(asked.some((sql) => sql.includes('app.expire_custom_packages'))).toBe(false)
  })

  it('rolls back and lets the connection go when the round fails', async () => {
    const { db, asked, release } = fakeDatabase({ failExpiry: true })
    await expect(runPackageExpiry(db)).rejects.toThrow('lock timeout')
    expect(asked.at(-1)).toBe('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
