import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { workspaceAssetListQuerySchema } from '../../shared/schemas/workspace-resources'
import { listWorkspaceAssets } from '../../server/utils/workspace-assets'

const userId = randomUUID()
const businessId = randomUUID()
const assetId = randomUUID()
const assetRow = {
  id: assetId,
  name: 'Kafe e mëngjesit',
  tags: ['kafe', 'produkt'],
  rights: true,
  generated: false,
  size: '12345',
}

describe('workspace asset list query contract', () => {
  it('defaults pagination and leaves filters absent', () => {
    expect(workspaceAssetListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })

  it('accepts bounded pagination, trimmed search and boolean rights', () => {
    expect(
      workspaceAssetListQuerySchema.parse({
        page: '2',
        pageSize: '50',
        search: '  kafe  ',
        rights: 'false',
      }),
    ).toEqual({ page: 2, pageSize: 50, search: 'kafe', rights: false })
    expect(workspaceAssetListQuerySchema.parse({ rights: true })).toMatchObject({ rights: true })
  })

  it.each([
    { page: '0' },
    { pageSize: '51' },
    { search: '' },
    { search: 'x'.repeat(101) },
    { rights: 'yes' },
    { rights: '0' },
    { extra: 'field' },
  ])('rejects invalid asset filters %j', (input) => {
    expect(workspaceAssetListQuerySchema.safeParse(input).success).toBe(false)
  })
})

describe('workspace asset list service', () => {
  it('scopes count and page queries to one business with stable ordering and filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 41 }] })
      .mockResolvedValueOnce({ rows: [assetRow] })
    const result = await listWorkspaceAssets({ query } as never, businessId, {
      page: 2,
      pageSize: 20,
      search: 'kafe',
      rights: true,
    })

    expect(query).toHaveBeenCalledTimes(2)
    const [countSql, countValues] = query.mock.calls[0]!
    const [pageSql, pageValues] = query.mock.calls[1]!
    expect(countSql).toContain('a.business_id=$1')
    expect(countSql).toContain('a.name ILIKE $2')
    expect(countSql).toContain('jsonb_array_elements_text')
    expect(countSql).toContain('a.rights=$3')
    expect(countValues).toEqual([businessId, '%kafe%', true])
    expect(pageSql).toContain('ORDER BY a.created_at DESC, a.id')
    expect(pageSql).toContain('LIMIT $4 OFFSET $5')
    expect(pageValues).toEqual([businessId, '%kafe%', true, 20, 20])
    expect(result).toEqual({
      items: [
        {
          id: assetId,
          name: assetRow.name,
          tags: assetRow.tags,
          rights: true,
          generated: false,
          size: 12345,
          kind: 'photo',
          url: `/api/media/${assetId}`,
        },
      ],
      page: 2,
      pageSize: 20,
      total: 41,
      hasNext: true,
    })
  })

  it('binds absent filters as null and reports the last page', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [assetRow] })
    const result = await listWorkspaceAssets({ query } as never, businessId, {
      page: 1,
      pageSize: 20,
    })
    expect(query.mock.calls[0]![1]).toEqual([businessId, null, null])
    expect(result).toMatchObject({ total: 1, hasNext: false })
  })

  it('escapes search wildcards so search remains literal', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
    await listWorkspaceAssets({ query } as never, businessId, {
      page: 1,
      pageSize: 20,
      search: '50%_off',
    })
    expect(query.mock.calls[0]![1]).toEqual([businessId, '%50\\%\\_off%', null])
  })
})

describe('workspace asset list HTTP endpoint', () => {
  const setHeader = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('requireUser', async () => ({ id: userId }))
    vi.stubGlobal(
      'getRouterParam',
      (event: { params: Record<string, string> }, key: string) => event.params[key],
    )
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
    vi.stubGlobal('setHeader', setHeader)
    vi.stubGlobal('createError', createError)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns one validated page through the authenticated business transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [assetRow] })
    vi.stubGlobal(
      'withBusinessTransaction',
      async (
        receivedUserId: string,
        work: (client: { query: typeof query }, business: { id: string }) => Promise<unknown>,
      ) => {
        expect(receivedUserId).toBe(userId)
        return work({ query }, { id: businessId })
      },
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.get')
    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId },
      query: { page: '1', pageSize: '20', search: 'kafe', rights: 'true' },
    })

    expect(result).toMatchObject({ items: [{ id: assetId }], total: 1, hasNext: false })
    expect(query.mock.calls[0]![1]).toEqual([businessId, '%kafe%', true])
    expect(setHeader).toHaveBeenCalledWith(expect.anything(), 'Cache-Control', 'private, no-store')
  })

  it('rejects invalid filters before opening a transaction', async () => {
    const transaction = vi.fn()
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.get')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        query: { pageSize: '51' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('hides a valid workspace belonging to another tenant', async () => {
    const query = vi.fn()
    vi.stubGlobal(
      'withBusinessTransaction',
      async (
        _userId: string,
        work: (client: { query: typeof query }, business: { id: string }) => Promise<unknown>,
      ) => work({ query }, { id: randomUUID() }),
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.get')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        query: {},
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires authentication and a valid workspace UUID', async () => {
    const transaction = vi.fn()
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.get')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({ params: { id: 'invalid' }, query: {} }),
    ).rejects.toMatchObject({ statusCode: 404 })
    vi.stubGlobal('requireUser', async () => {
      throw createError({ statusCode: 401 })
    })
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        query: {},
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(transaction).not.toHaveBeenCalled()
  })
})
