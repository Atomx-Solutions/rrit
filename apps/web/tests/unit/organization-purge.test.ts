import { describe, expect, it, vi } from 'vitest'

const removeAssets = vi.fn(async (_paths: string[]) => {})
vi.mock('../../server/utils/asset-storage', () => ({ removeAssets: (paths: string[]) => removeAssets(paths) }))

const { runOrganizationPurgeBatch, storagePathBatches } = await import('../../server/utils/organization-purge')

function fakePool(due: string[], purge: (id: string) => string[] | Error) {
  const statements: string[] = []
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      statements.push(sql)
      if (sql.includes('purge_closed_organization')) {
        const outcome = purge(params![0] as string)
        if (outcome instanceof Error) throw outcome
        return { rows: [{ purge: { storage_paths: outcome } }] }
      }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  const pool = {
    query: vi.fn(async () => ({ rows: due.map(id => ({ id })) })),
    connect: vi.fn(async () => client),
  }
  return { pool, client, statements }
}

describe('purging closed organizations', () => {
  it('splits Storage removals into bounded batches', () => {
    expect(storagePathBatches(Array.from({ length: 250 }, (_, i) => `f${i}`)).map(b => b.length)).toEqual([100, 100, 50])
    expect(storagePathBatches([])).toEqual([])
  })

  it('commits each purge before removing its files, and keeps going after a failure', async () => {
    removeAssets.mockClear()
    const { pool, statements } = fakePool(['a', 'b'], id => (id === 'a' ? new Error('boom') : ['b/one.jpg', 'b/two.mp4']))
    const result = await runOrganizationPurgeBatch(pool as never)
    expect(result).toEqual({ purged: 1, failed: 1 })
    expect(statements).toContain('ROLLBACK')
    expect(statements.filter(s => s === 'COMMIT')).toHaveLength(1)
    expect(removeAssets).toHaveBeenCalledTimes(1)
    expect(removeAssets).toHaveBeenCalledWith(['b/one.jpg', 'b/two.mp4'])
  })

  it('counts a purge as done even when Storage keeps a file', async () => {
    removeAssets.mockClear()
    removeAssets.mockRejectedValueOnce(new Error('storage down'))
    const { pool } = fakePool(['c'], () => ['c/one.jpg'])
    await expect(runOrganizationPurgeBatch(pool as never)).resolves.toEqual({ purged: 1, failed: 0 })
  })
})
