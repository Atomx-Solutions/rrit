import { createError } from 'h3'
import { expect, it, vi } from 'vitest'
import { loadWorkspace } from '../../server/utils/workspaces'
import { createDemo } from '../fixtures/workspace'

it('reuses an already authorized business row without reading it again', async () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const owner = '00000000-0000-4000-8000-000000000002'
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM posts') || sql.includes('FROM assets')) return { rows: [] }
    throw new Error(`Unexpected duplicate business read: ${sql}`)
  })

  const result = await loadWorkspace({ query } as never, id, owner, {
    id,
    owner_id: owner,
    slug: 'test-business',
    state: createDemo(),
    revision: 7,
  })

  expect(result.id).toBe(id)
  expect(result.slug).toBe('test-business')
  expect(result.workspace.revision).toBe(7)
  expect(result.workspace.posts).toEqual([])
  expect(result.workspace.assets).toEqual([])
  expect(query).toHaveBeenCalledTimes(2)
})

it('rejects a preloaded business belonging to another owner', async () => {
  vi.stubGlobal('createError', createError)
  const query = vi.fn()
  await expect(loadWorkspace(
    { query } as never,
    'business-1',
    'owner-1',
    { id: 'business-1', owner_id: 'owner-2', slug: 'other', state: createDemo(), revision: 1 },
  )).rejects.toMatchObject({ statusCode: 404 })
  expect(query).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('reports post and asset query timings without changing the workspace data', async () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const owner = '00000000-0000-4000-8000-000000000002'
  const phases: string[] = []
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM posts') || sql.includes('FROM assets')) return { rows: [] }
    throw new Error(`Unexpected query: ${sql}`)
  })

  const result = await loadWorkspace(
    { query } as never,
    id,
    owner,
    { id, owner_id: owner, slug: 'test-business', state: createDemo(), revision: 7 },
    (phase, duration) => {
      expect(duration).toBeGreaterThanOrEqual(0)
      phases.push(phase)
    },
  )

  expect(phases).toEqual(['posts', 'assets'])
  expect(result.workspace.posts).toEqual([])
  expect(result.workspace.assets).toEqual([])
  expect(query).toHaveBeenCalledTimes(2)
})
