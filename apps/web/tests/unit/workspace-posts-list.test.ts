import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { createDemo } from '../fixtures/workspace'
import { workspacePostListQuerySchema } from '../../shared/schemas/workspace-resources'
import { listWorkspacePosts } from '../../server/utils/workspace-posts'

const userId = randomUUID()
const businessId = randomUUID()
const post = { ...createDemo().posts[0]!, id: randomUUID() }

describe('workspace post list query contract', () => {
  it('defaults pagination and leaves filters absent', () => {
    expect(workspacePostListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })

  it('accepts pagination, status, channel and an inclusive time interval', () => {
    const input = {
      page: '3',
      pageSize: '50',
      status: 'scheduled',
      channel: 'Instagram',
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    }
    expect(workspacePostListQuerySchema.parse(input)).toEqual({
      ...input,
      page: 3,
      pageSize: 50,
    })
  })

  it.each([
    { page: '0' },
    { pageSize: '51' },
    { status: 'unknown' },
    { channel: 'TikTok' },
    { from: '2026-09-01' },
    { to: 'tomorrow' },
    { from: '2026-10-01T00:00:00Z', to: '2026-09-01T00:00:00Z' },
    { extra: 'field' },
  ])('rejects invalid post filters %j', (input) => {
    expect(workspacePostListQuerySchema.safeParse(input).success).toBe(false)
  })
})

describe('workspace post list service', () => {
  it('scopes count and page queries to one business with stable ordering', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 41 }] })
      .mockResolvedValueOnce({ rows: [{ payload: post }] })
    const result = await listWorkspacePosts({ query } as never, businessId, {
      page: 2,
      pageSize: 20,
      status: 'scheduled',
      channel: 'Instagram',
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    })

    expect(query).toHaveBeenCalledTimes(2)
    const [countSql, countValues] = query.mock.calls[0]!
    const [pageSql, pageValues] = query.mock.calls[1]!
    expect(countSql).toContain('p.business_id=$1')
    expect(countSql).toContain("p.payload->>'status'=$2")
    expect(countSql).toContain("p.payload->>'channel'=$3")
    expect(countSql).toContain('calendar_at >= $4::timestamptz')
    expect(countSql).toContain('calendar_at <= $5::timestamptz')
    expect(countValues).toEqual([
      businessId,
      'scheduled',
      'Instagram',
      '2026-09-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    ])
    expect(pageSql).toContain('ORDER BY p.created_at DESC, p.id')
    expect(pageSql).toContain('LIMIT $6 OFFSET $7')
    expect(pageValues).toEqual([...countValues, 20, 20])
    expect(result).toEqual({ items: [post], page: 2, pageSize: 20, total: 41, hasNext: true })
  })

  it('binds absent filters as null and reports the last page', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ payload: post }] })
    const result = await listWorkspacePosts({ query } as never, businessId, {
      page: 1,
      pageSize: 20,
    })
    expect(query.mock.calls[0]![1]).toEqual([businessId, null, null, null, null])
    expect(result).toMatchObject({ total: 1, hasNext: false })
  })

  it('rejects corrupt persisted post payloads', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ payload: { id: 'incomplete' } }] })
    await expect(
      listWorkspacePosts({ query } as never, businessId, { page: 1, pageSize: 20 }),
    ).rejects.toBeDefined()
  })
})

describe('workspace post list HTTP endpoint', () => {
  const setHeader = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
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
      .mockResolvedValueOnce({ rows: [{ payload: post }] })
    const client = { query }
    const transaction = vi.fn(
      async (
        receivedUserId: string,
        work: (client: typeof client, business: { id: string }) => Promise<unknown>,
      ) => {
        expect(receivedUserId).toBe(userId)
        return work(client, { id: businessId })
      },
    )
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/index.get')

    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId },
      query: { page: '1', pageSize: '20', status: 'review' },
    })

    expect(result).toEqual({ items: [post], page: 1, pageSize: 20, total: 1, hasNext: false })
    expect(transaction).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]![1]).toEqual([businessId, 'review', null, null, null])
    expect(setHeader).toHaveBeenCalledWith(expect.anything(), 'Cache-Control', 'private, no-store')
  })

  it('rejects invalid filters before opening a transaction', async () => {
    const transaction = vi.fn()
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/index.get')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        query: { pageSize: '51' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('hides a valid workspace belonging to another tenant', async () => {
    const otherBusinessId = randomUUID()
    const query = vi.fn()
    vi.stubGlobal(
      'withBusinessTransaction',
      async (
        _userId: string,
        work: (client: { query: typeof query }, business: { id: string }) => Promise<unknown>,
      ) => work({ query }, { id: otherBusinessId }),
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/index.get')
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
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/index.get')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({ params: { id: 'invalid' }, query: {} }),
    ).rejects.toMatchObject({ statusCode: 404 })
    vi.stubGlobal('requireUser', async () => {
      throw createError({ statusCode: 401 })
    })
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({ params: { id: businessId }, query: {} }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(transaction).not.toHaveBeenCalled()
  })
})
