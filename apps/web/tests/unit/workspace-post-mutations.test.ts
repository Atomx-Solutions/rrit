import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { createDemo } from '../fixtures/workspace'
import type { Post } from '../../shared/schemas/workspace'
import { createWorkspacePost, updateWorkspacePost } from '../../server/utils/workspace-posts'
import * as trials from '../../server/utils/trials'

vi.mock('../../server/utils/trials', () => ({
  requireQuota: vi.fn(async () => undefined),
  requireEntitlement: vi.fn(async () => undefined),
}))
vi.mock('../../server/utils/publishing', () => ({
  requirePublishingWorker: vi.fn(async () => undefined),
  queuePublication: vi.fn(async () => undefined),
}))

const businessId = randomUUID()
const userId = randomUUID()
const assetId = randomUUID()
const image = `/api/media/${assetId}`

function draft(): Post {
  return {
    ...createDemo().posts[3]!,
    id: randomUUID(),
    image,
    status: 'draft',
    version: 7,
    contentVersion: 4,
    history: [],
  }
}

function databaseDouble(
  options: {
    revision?: number
    post?: Post
    postBelongsToBusiness?: boolean
  } = {},
) {
  let revision = options.revision ?? 5
  let storedPost = options.post
  const statements: { sql: string; values: unknown[] }[] = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values })
    if (sql.startsWith('SELECT revision FROM businesses'))
      return { rows: [{ revision }], rowCount: 1 }
    if (sql.startsWith('SELECT payload FROM posts') && sql.includes('FOR UPDATE'))
      return {
        rows:
          storedPost && options.postBelongsToBusiness !== false ? [{ payload: storedPost }] : [],
        rowCount: storedPost && options.postBelongsToBusiness !== false ? 1 : 0,
      }
    if (sql.startsWith('SELECT post_id FROM publication_jobs')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT id FROM assets')) return { rows: [{ id: assetId }], rowCount: 1 }
    if (sql.startsWith("SELECT value FROM app_settings WHERE key='post_limits'"))
      return {
        rows: [
          {
            value: {
              caption_characters: 2200,
              image_bytes: 2097152,
              minimum_width: 320,
              maximum_width: 1440,
              minimum_aspect_ratio: 0.8,
              maximum_aspect_ratio: 1.91,
              max_hashtags: 30,
              daily_ai_requests: 20,
            },
          },
        ],
        rowCount: 1,
      }
    if (sql.startsWith('SELECT rights,COALESCE'))
      return {
        rows: [{ rights: true, size: 1000, width: 800, height: 800 }],
        rowCount: 1,
      }
    if (sql.startsWith('INSERT INTO posts ')) {
      storedPost = JSON.parse(values[2] as string) as Post
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('INSERT INTO post_content_versions'))
      return { rows: [{ post_id: storedPost!.id }], rowCount: 1 }
    if (sql.startsWith('SELECT app.record_audit_event'))
      return { rows: [{ record_audit_event: randomUUID() }], rowCount: 1 }
    if (sql.startsWith('UPDATE businesses SET revision=revision+1')) {
      if (values[2] !== revision) return { rows: [], rowCount: 0 }
      revision += 1
      return { rows: [{ revision }], rowCount: 1 }
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  return {
    client: { query } as never,
    statements,
    get post() {
      return storedPost
    },
    get revision() {
      return revision
    },
  }
}

const createInput = {
  workspaceRevision: 5,
  title: 'Kafe e ditës',
  caption: 'Ejani për një kafe të freskët.',
  channel: 'Instagram' as const,
  format: 'static' as const,
  image,
  pillar: 'Produkti',
}

describe('individual workspace post persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates only one server-owned draft and advances the workspace revision', async () => {
    const db = databaseDouble()
    const result = await createWorkspacePost(db.client, {
      businessId,
      userId,
      input: createInput,
    })

    expect(result.workspaceRevision).toBe(6)
    expect(result.post).toMatchObject({
      title: createInput.title,
      status: 'draft',
      version: 1,
      contentVersion: 1,
      history: [],
    })
    expect(result.post.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(trials.requireQuota).toHaveBeenCalledWith(businessId, 'posts_per_month', 1, db.client)
    expect(db.statements.filter(({ sql }) => sql.startsWith('INSERT INTO posts '))).toHaveLength(1)
  })

  it('updates only the requested caption and increments post/content/workspace versions', async () => {
    const current = draft()
    const db = databaseDouble({ post: current })
    const result = await updateWorkspacePost(db.client, {
      businessId,
      userId,
      postId: current.id,
      input: { workspaceRevision: 5, postVersion: 7, caption: 'Caption i përditësuar.' },
    })

    expect(result.workspaceRevision).toBe(6)
    expect(result.post).toMatchObject({
      id: current.id,
      title: current.title,
      caption: 'Caption i përditësuar.',
      status: 'draft',
      version: 8,
      contentVersion: 5,
    })
    expect(result.post.history).toEqual([
      expect.objectContaining({ version: 7, caption: current.caption }),
    ])
  })

  it('rejects a stale workspace revision before writing the post', async () => {
    const db = databaseDouble({ revision: 6, post: draft() })
    await expect(
      updateWorkspacePost(db.client, {
        businessId,
        userId,
        postId: db.post!.id,
        input: { workspaceRevision: 5, postVersion: 7, caption: 'Ndryshim' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.statements.some(({ sql }) => sql.startsWith('INSERT INTO posts '))).toBe(false)
  })

  it('rejects a stale post version before writing the post', async () => {
    const current = draft()
    const db = databaseDouble({ post: current })
    await expect(
      updateWorkspacePost(db.client, {
        businessId,
        userId,
        postId: current.id,
        input: { workspaceRevision: 5, postVersion: 6, caption: 'Ndryshim' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.statements.some(({ sql }) => sql.startsWith('INSERT INTO posts '))).toBe(false)
  })

  it('returns 404 when the post id belongs to another tenant', async () => {
    const current = draft()
    const db = databaseDouble({ post: current, postBelongsToBusiness: false })
    await expect(
      updateWorkspacePost(db.client, {
        businessId,
        userId,
        postId: current.id,
        input: { workspaceRevision: 5, postVersion: 7, caption: 'Ndryshim' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('individual workspace post HTTP endpoints', () => {
  const transaction = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('requireSameOrigin', vi.fn())
    vi.stubGlobal('requireUser', async () => ({ id: userId }))
    vi.stubGlobal(
      'getRouterParam',
      (event: { params: Record<string, string> }, key: string) => event.params[key],
    )
    vi.stubGlobal('boundedBody', async (event: { body: unknown }) => event.body)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('withBusinessTransaction', transaction)
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['POST', '../../server/api/workspaces/[id]/posts/index.post'],
    ['PUT', '../../server/api/workspaces/[id]/posts/[postId].put'],
  ] as const)(
    '%s rejects server-owned fields before opening a transaction',
    async (method, path) => {
      const { default: handler } = await import(path)
      const body =
        method === 'POST'
          ? { ...createInput, publishedAt: '2026-01-01T00:00:00Z' }
          : {
              workspaceRevision: 5,
              postVersion: 7,
              caption: 'Ndryshim',
              providerPostId: 'forged',
            }
      await expect(
        (handler as (event: unknown) => Promise<unknown>)({
          params: { id: businessId, postId: randomUUID() },
          body,
        }),
      ).rejects.toMatchObject({ statusCode: 422 })
      expect(transaction).not.toHaveBeenCalled()
    },
  )

  it('accepts a post-only create request without workspace posts or assets arrays', async () => {
    const db = databaseDouble()
    transaction.mockImplementation(
      async (
        receivedUserId: string,
        work: (client: typeof db.client, business: { id: string }) => Promise<unknown>,
      ) => {
        expect(receivedUserId).toBe(userId)
        return work(db.client, { id: businessId })
      },
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/index.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId },
      body: createInput,
    })
    expect(result).toMatchObject({ workspaceRevision: 6, post: { status: 'draft' } })
  })

  it('accepts a caption-only update and hides another workspace', async () => {
    const current = draft()
    const db = databaseDouble({ post: current })
    transaction.mockImplementation(
      async (
        _userId: string,
        work: (client: typeof db.client, business: { id: string }) => Promise<unknown>,
      ) => work(db.client, { id: businessId }),
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/posts/[postId].put')
    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId, postId: current.id },
      body: { workspaceRevision: 5, postVersion: 7, caption: 'Vetëm caption.' },
    })
    expect(result).toMatchObject({
      workspaceRevision: 6,
      post: { id: current.id, caption: 'Vetëm caption.' },
    })

    transaction.mockImplementationOnce(
      async (
        _userId: string,
        work: (client: typeof db.client, business: { id: string }) => Promise<unknown>,
      ) => work(db.client, { id: randomUUID() }),
    )
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId, postId: current.id },
        body: { workspaceRevision: 6, postVersion: 8, caption: 'Jo' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
