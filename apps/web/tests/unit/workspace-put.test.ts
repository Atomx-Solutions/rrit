import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createError } from 'h3'
import { createDemo } from '../fixtures/workspace'
import { workspaceSchema, type Workspace, type Post } from '../../shared/schemas/workspace'
import { loadWorkspace } from '../../server/utils/workspaces'
import * as validation from '../../server/utils/post-validation'
import * as trials from '../../server/utils/trials'
import * as publishing from '../../server/utils/publishing'
import { uploadAsset, removeAsset } from '../../server/utils/asset-storage'

// Only external boundaries and unrelated domain work are replaced. The PUT,
// extracted services, transitions, versions, approvals and audit logic run for real.
vi.mock('../../server/utils/trials', () => ({
  requireQuota: vi.fn(async () => undefined),
  requireEntitlement: vi.fn(async () => undefined),
}))
vi.mock('../../server/utils/publishing', () => ({
  requirePublishingWorker: vi.fn(async () => undefined),
  queuePublication: vi.fn(async () => undefined),
}))
vi.mock('../../server/utils/asset-storage', async (original) => ({
  ...(await original<typeof import('../../server/utils/asset-storage')>()),
  uploadAsset: vi.fn(async () => undefined),
  removeAsset: vi.fn(async () => undefined),
}))
vi.mock('../../server/utils/business-brain', async (original) => ({
  ...(await original<typeof import('../../server/utils/business-brain')>()),
  syncBusinessBrain: vi.fn(async (_db, _business, _user, brand) => brand),
}))

const businessId = randomUUID()
const userId = randomUUID()
const brandId = randomUUID()
const postId = randomUUID()
const assetId = randomUUID()
let current: Workspace
let statements: { sql: string; values: unknown[] }[]
let inFlight: boolean
let freshValidation: boolean
let currentApproval: boolean
let brandConflict: boolean
let duplicateContentVersion: boolean
let canonicalBrandExists: boolean

// A query-recording PostgreSQL boundary, not an integration database. Reject
// unexpected SQL so accidental changes to the persistence path are visible.
const client = {
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT set_config'))
      return { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT app.record_audit_event'))
      return { rows: [{ record_audit_event: '1' }], rowCount: 1 }
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
    if (sql.startsWith('SELECT rights,COALESCE')) {
      const asset = current.assets.find((item) => item.id === values[0])
      return { rows: asset ? [{ ...asset, width: 800, height: 800 }] : [], rowCount: asset ? 1 : 0 }
    }
    if (sql.startsWith('SELECT revision FROM businesses'))
      return { rows: [{ revision: current.revision }], rowCount: 1 }
    if (sql.startsWith('SELECT id, slug, state, revision FROM businesses'))
      return {
        rows: [{ id: businessId, slug: 'test-brand', state: current, revision: current.revision }],
        rowCount: 1,
      }
    if (sql.startsWith('SELECT payload FROM posts'))
      return { rows: current.posts.map((payload) => ({ payload })), rowCount: current.posts.length }
    if (sql.startsWith('SELECT id, name, tags, rights,'))
      return { rows: current.assets, rowCount: current.assets.length }
    if (sql.startsWith('SELECT id, revision FROM brands'))
      return {
        rows: canonicalBrandExists ? [{ id: brandId, revision: current.brandRevision }] : [],
        rowCount: 1,
      }
    if (sql.startsWith('SELECT post_id FROM publication_jobs'))
      return { rows: inFlight ? [{ post_id: postId }] : [], rowCount: 0 }
    if (sql.startsWith('SELECT id FROM publication_jobs'))
      return { rows: inFlight ? [{ id: randomUUID() }] : [], rowCount: 0 }
    if (sql.startsWith('SELECT id FROM post_validations'))
      return { rows: freshValidation ? [{ id: randomUUID() }] : [], rowCount: 0 }
    if (sql.startsWith('SELECT decision FROM post_approval_records'))
      return { rows: currentApproval ? [{ decision: 'approved' }] : [], rowCount: 0 }
    if (sql.startsWith('SELECT storage_path FROM assets'))
      return { rows: [{ storage_path: 'existing/photo.jpg' }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO post_content_versions'))
      return { rows: [], rowCount: duplicateContentVersion ? 0 : 1 }
    if (sql.startsWith('UPDATE brands'))
      return {
        rows: brandConflict ? [] : [{ revision: current.brandRevision + 1 }],
        rowCount: brandConflict ? 0 : 1,
      }
    if (
      /^(INSERT INTO (posts |assets |post_approval_records|audit_events)|UPDATE (businesses |assets |publication_jobs )|DELETE FROM assets )/.test(
        sql,
      )
    )
      return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected SQL: ${sql}`)
  }),
  release: vi.fn(),
}

async function save(change: (draft: Workspace) => void = () => {}) {
  const input = structuredClone(current)
  input.revision++
  change(input)
  const { default: handler } = await import('../../server/api/workspaces/[id].put')
  return (handler as (event: unknown) => Promise<{ workspace: Workspace }>)({
    body: input,
    params: { id: businessId },
  })
}

function writes(prefix: string) {
  return statements.filter(({ sql }) => sql.startsWith(prefix))
}

function savedPost(): Post {
  return JSON.parse(writes('INSERT INTO posts ')[0]!.values[2] as string)
}

async function addUpload(draft: Workspace) {
  const bytes = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#ffff00' },
  })
    .jpeg()
    .toBuffer()
  draft.assets.push({
    id: randomUUID(),
    name: 'new.jpg',
    url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    tags: [],
    rights: true,
    kind: 'photo',
    size: bytes.length,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(removeAsset).mockReset().mockResolvedValue(undefined)
  current = workspaceSchema.parse(createDemo())
  current.brandRevision = 3
  current.posts = [
    {
      ...current.posts[0]!,
      id: postId,
      contentVersion: 4,
      version: 7,
      image: `/api/media/${assetId}`,
      status: 'review',
      publicationMode: 'manual',
    },
  ]
  current.assets = [
    {
      id: assetId,
      name: 'photo.jpg',
      url: `/api/media/${assetId}`,
      tags: [],
      rights: true,
      kind: 'photo',
      size: 1000,
    },
  ]
  statements = []
  inFlight = false
  freshValidation = true
  currentApproval = true
  brandConflict = false
  duplicateContentVersion = false
  canonicalBrandExists = true
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('requireSameOrigin', () => undefined)
  vi.stubGlobal('requireUser', async () => ({ id: userId }))
  vi.stubGlobal('boundedBody', async (event: { body: unknown }) => event.body)
  vi.stubGlobal(
    'getRouterParam',
    (event: { params: Record<string, string> }, key: string) => event.params[key],
  )
  vi.stubGlobal('database', () => ({ connect: async () => client }))
  vi.stubGlobal('businessForUser', async () => ({ id: businessId, slug: 'test-brand' }))
  vi.stubGlobal('loadWorkspace', loadWorkspace)
  for (const [key, value] of Object.entries({ ...validation, ...trials, ...publishing }))
    vi.stubGlobal(key, value)
})

afterEach(() => vi.unstubAllGlobals())

describe('legacy workspace PUT regression behavior', () => {
  it('edits reviewed content as a draft with server versions and an immutable snapshot', async () => {
    await save((draft) =>
      Object.assign(draft.posts[0]!, {
        caption: 'New caption',
        status: 'draft',
        version: 999,
        contentVersion: 999,
        history: [],
      }),
    )
    const post = savedPost()
    expect(post).toMatchObject({
      caption: 'New caption',
      status: 'draft',
      version: 8,
      contentVersion: 5,
      scheduledAt: null,
      publicationMode: 'manual',
      policy: 'warn',
    })
    expect(post.history.at(-1)).toMatchObject({ version: 7, caption: current.posts[0]!.caption })
    const version = writes('INSERT INTO post_content_versions')[0]!.values
    expect(version.slice(0, 3)).toEqual([postId, businessId, 5])
    expect(JSON.parse(version[4] as string)).toMatchObject({
      caption: 'New caption',
      contentVersion: 5,
    })
    expect(writes('COMMIT')).toHaveLength(1)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('requires reopening approved content before editing', async () => {
    current.posts[0]!.status = 'approved'
    await expect(
      save((draft) => Object.assign(draft.posts[0]!, { caption: 'Edited', status: 'draft' })),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(writes('INSERT INTO posts ')).toHaveLength(0)
    expect(writes('ROLLBACK')).toHaveLength(1)
  })

  it('keeps the content version when only the approval status changes', async () => {
    await save((draft) => {
      draft.posts[0]!.status = 'approved'
    })
    expect(savedPost()).toMatchObject({ status: 'approved', version: 8, contentVersion: 4 })
    expect(writes('INSERT INTO post_content_versions')).toHaveLength(0)
    expect(writes('INSERT INTO post_approval_records')[0]!.values).toEqual([
      postId,
      businessId,
      4,
      validation.postFingerprint(current.posts[0]!),
      userId,
      'approved',
    ])
  })

  it('rejects approval without fresh validation', async () => {
    freshValidation = false
    await expect(
      save((draft) => {
        draft.posts[0]!.status = 'approved'
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(writes('INSERT INTO posts ')).toHaveLength(0)
  })

  it('rejects scheduling without current content approval', async () => {
    current.posts[0]!.status = 'approved'
    currentApproval = false
    await expect(
      save((draft) =>
        Object.assign(draft.posts[0]!, {
          status: 'scheduled',
          scheduledAt: '2099-01-01T12:00:00Z',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('retains local validation failures when scheduling', async () => {
    current.posts[0]!.status = 'approved'
    current.posts[0]!.caption = '{{unfinished}}'
    await expect(
      save((draft) =>
        Object.assign(draft.posts[0]!, {
          status: 'scheduled',
          scheduledAt: '2099-01-01T12:00:00Z',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(writes('INSERT INTO posts ')).toHaveLength(0)
  })

  it('marks edited content blocked when technical checks fail', async () => {
    await save((draft) =>
      Object.assign(draft.posts[0]!, { caption: '{{unfinished}}', status: 'draft' }),
    )
    expect(savedPost()).toMatchObject({ status: 'draft', policy: 'block', contentVersion: 5 })
  })

  it('does not allow blocked content to be approved', async () => {
    current.posts[0]!.policy = 'block'
    await expect(
      save((draft) => {
        draft.posts[0]!.status = 'approved'
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('supports manual scheduling without invoking the publisher', async () => {
    current.posts[0]!.status = 'approved'
    await save((draft) =>
      Object.assign(draft.posts[0]!, { status: 'scheduled', scheduledAt: '2099-01-01T12:00:00Z' }),
    )
    expect(savedPost()).toMatchObject({
      status: 'scheduled',
      publicationMode: 'manual',
      contentVersion: 4,
    })
    expect(publishing.queuePublication).not.toHaveBeenCalled()
  })

  it('requires publication validation and queues automatic scheduling', async () => {
    current.posts[0]!.status = 'approved'
    await save((draft) =>
      Object.assign(draft.posts[0]!, {
        status: 'scheduled',
        scheduledAt: '2099-01-01T12:00:00Z',
        publicationMode: 'automatic',
      }),
    )
    expect(writes('SELECT id FROM post_validations')[0]!.values.at(-1)).toBe('publication')
    expect(trials.requireEntitlement).toHaveBeenCalledWith(businessId, 'publishing', client)
    expect(publishing.requirePublishingWorker).toHaveBeenCalledWith(client)
    expect(publishing.queuePublication).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: postId, status: 'scheduled' }),
      businessId,
      '2099-01-01T12:00:00Z',
    )
  })

  it('rejects automatic scheduling when the worker is unavailable', async () => {
    current.posts[0]!.status = 'approved'
    vi.mocked(publishing.requirePublishingWorker).mockRejectedValueOnce(
      createError({ statusCode: 503 }),
    )
    await expect(
      save((draft) =>
        Object.assign(draft.posts[0]!, {
          status: 'scheduled',
          scheduledAt: '2099-01-01T12:00:00Z',
          publicationMode: 'automatic',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(publishing.queuePublication).not.toHaveBeenCalled()
    expect(writes('COMMIT')).toHaveLength(0)
  })

  it('does not queue automatic publication without fresh provider validation', async () => {
    current.posts[0]!.status = 'approved'
    freshValidation = false
    await expect(
      save((draft) =>
        Object.assign(draft.posts[0]!, {
          status: 'scheduled',
          scheduledAt: '2099-01-01T12:00:00Z',
          publicationMode: 'automatic',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(publishing.queuePublication).not.toHaveBeenCalled()
  })

  it('rejects dates in the past', async () => {
    current.posts[0]!.status = 'approved'
    await expect(
      save((draft) =>
        Object.assign(draft.posts[0]!, {
          status: 'scheduled',
          scheduledAt: '2000-01-01T12:00:00Z',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('cancels pending jobs when removing a post from the calendar', async () => {
    Object.assign(current.posts[0]!, { status: 'scheduled', scheduledAt: '2099-01-01T12:00:00Z' })
    await save((draft) => Object.assign(draft.posts[0]!, { status: 'approved', scheduledAt: null }))
    expect(savedPost()).toMatchObject({ status: 'approved', scheduledAt: null })
    expect(writes('UPDATE publication_jobs')[0]!.values).toEqual([postId])
  })

  it.each(['draft', 'review', 'approved', 'scheduled', 'failed'] as const)(
    'rejects forged publication from %s',
    async (status) => {
      current.posts[0]!.status = status
      await expect(
        save((draft) => {
          draft.posts[0]!.status = 'published'
        }),
      ).rejects.toMatchObject({ statusCode: 422 })
      expect(writes('INSERT INTO posts ')).toHaveLength(0)
    },
  )

  it('ignores forged provider and policy fields on an unchanged post', async () => {
    await save((draft) =>
      Object.assign(draft.posts[0]!, {
        providerPostId: 'forged',
        publishedAt: '2026-01-01',
        policy: 'block',
        version: 999,
      }),
    )
    expect(savedPost()).toMatchObject({ version: 7, contentVersion: 4, policy: 'pass' })
    expect(savedPost().providerPostId).toBeUndefined()
    expect(savedPost().publishedAt).toBeUndefined()
  })

  it('initializes new drafts with server-owned versions', async () => {
    current.posts = []
    await save((draft) =>
      draft.posts.push({
        ...createDemo().posts[0]!,
        id: postId,
        image: current.assets[0]!.url,
        status: 'draft',
        version: 999,
        contentVersion: 999,
        providerPostId: 'forged',
      }),
    )
    expect(savedPost()).toMatchObject({
      status: 'draft',
      version: 1,
      contentVersion: 1,
      history: [],
    })
    expect(savedPost().providerPostId).toBeUndefined()
    expect(trials.requireQuota).toHaveBeenCalledWith(businessId, 'posts_per_month', 1, client)
  })

  it('rejects a conflicting immutable version and rolls back', async () => {
    duplicateContentVersion = true
    await expect(
      save((draft) => Object.assign(draft.posts[0]!, { caption: 'Updated', status: 'draft' })),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(writes('ROLLBACK')).toHaveLength(1)
    expect(writes('COMMIT')).toHaveLength(0)
  })

  it('rejects stale workspace and brand revisions before writing content', async () => {
    await expect(
      save((draft) => {
        draft.revision = 99
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    await expect(
      save((draft) => {
        draft.brandRevision = 99
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(writes('INSERT INTO posts ')).toHaveLength(0)
    expect(writes('UPDATE businesses')).toHaveLength(0)
  })

  it('persists preferences in workspace state and the canonical brand', async () => {
    const result = await save((draft) =>
      Object.assign(draft.preferences, { timezone: 'UTC', locale: 'en-US', emailTips: true }),
    )
    const state = writes('UPDATE businesses SET state =')[0]!.values
    expect(JSON.parse(state[0] as string).preferences).toMatchObject({
      timezone: 'UTC',
      locale: 'en-US',
      emailTips: true,
    })
    expect(state.slice(1)).toEqual([2, businessId, userId])
    const brand = writes('UPDATE brands')[0]!.values
    expect(JSON.parse(brand[2] as string)).toMatchObject({ emailTips: true })
    expect(brand.slice(3, 5)).toEqual(['UTC', 'en-US'])
    expect(brand.slice(7)).toEqual([brandId, businessId, 3])
    expect(result.workspace.brandRevision).toBe(4)
  })

  it('rolls back when the canonical brand revision conflicts at write time', async () => {
    brandConflict = true
    await expect(save()).rejects.toMatchObject({ statusCode: 409 })
    expect(writes('ROLLBACK')).toHaveLength(1)
    expect(writes('COMMIT')).toHaveLength(0)
  })

  it('retains compatibility when a canonical brand is absent', async () => {
    canonicalBrandExists = false
    const result = await save()
    expect(result.workspace.brandRevision).toBe(3)
    expect(writes('UPDATE brands')).toHaveLength(0)
  })

  it('preserves owner authorization and tenant context', async () => {
    await save()
    expect(
      writes(
        "SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)",
      )[0]!.values,
    ).toEqual([userId, businessId])
    expect(writes('SELECT revision FROM businesses')[0]!.values).toEqual([businessId, userId])
    vi.stubGlobal('businessForUser', async () => ({ id: randomUUID(), slug: 'other' }))
    await expect(save()).rejects.toMatchObject({ statusCode: 404 })
  })

  it('preserves authentication and same-origin gates', async () => {
    vi.stubGlobal('requireUser', async () => {
      throw createError({ statusCode: 401 })
    })
    await expect(save()).rejects.toMatchObject({ statusCode: 401 })
    vi.stubGlobal('requireSameOrigin', () => {
      throw createError({ statusCode: 403 })
    })
    await expect(save()).rejects.toMatchObject({ statusCode: 403 })
    expect(statements).toHaveLength(0)
  })

  it('rejects invalid preference values before opening a transaction', async () => {
    await expect(
      save((draft) => {
        draft.preferences.timezone = 'Not/AZone'
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(statements).toHaveLength(0)
  })
})

describe('legacy workspace asset behavior', () => {
  it('updates metadata with business-scoped SQL', async () => {
    await save((draft) => {
      draft.assets[0]!.name = 'Renamed.jpg'
    })
    expect(writes('UPDATE assets')[0]!.values).toEqual([
      'Renamed.jpg',
      '[]',
      true,
      assetId,
      businessId,
    ])
  })

  it('rejects replacing an existing media URL', async () => {
    await expect(
      save((draft) => {
        draft.assets[0]!.url = '/api/media/' + randomUUID()
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('does not remove an asset still referenced by a post', async () => {
    await expect(
      save((draft) => {
        draft.assets = []
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(writes('DELETE FROM assets')).toHaveLength(0)
    expect(removeAsset).not.toHaveBeenCalled()
  })

  it('protects assets and status transitions while publication is in flight', async () => {
    inFlight = true
    await expect(
      save((draft) => {
        draft.assets[0]!.rights = false
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    await expect(
      save((draft) => {
        draft.posts[0]!.status = 'approved'
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('deletes unused assets and cleans storage only after commit', async () => {
    current.posts = []
    vi.mocked(removeAsset).mockImplementationOnce(async () => {
      expect(writes('COMMIT')).toHaveLength(1)
    })
    await save((draft) => {
      draft.assets = []
    })
    expect(writes('DELETE FROM assets')[0]!.values).toEqual([assetId, businessId])
    expect(removeAsset).toHaveBeenCalledWith('existing/photo.jpg')
  })

  it('uploads through existing storage and substitutes the media URL in posts', async () => {
    await addUpload(current)
    const upload = current.assets.pop()!
    await save((draft) => {
      draft.assets.push(upload)
      Object.assign(draft.posts[0]!, { image: upload.url, status: 'draft' })
    })
    expect(uploadAsset).toHaveBeenCalledOnce()
    expect(writes('INSERT INTO assets ')[0]!.values.slice(0, 2)).toEqual([upload.id, businessId])
    expect(savedPost().image).toBe(`/api/media/${upload.id}`)
    expect(removeAsset).not.toHaveBeenCalled()
  })

  it('cleans new uploads on rollback without deleting committed media', async () => {
    await addUpload(current)
    const upload = current.assets.pop()!
    brandConflict = true
    vi.mocked(removeAsset).mockImplementationOnce(async () => {
      expect(writes('ROLLBACK')).toHaveLength(1)
    })
    await expect(save((draft) => draft.assets.push(upload))).rejects.toMatchObject({
      statusCode: 409,
    })
    const path = vi.mocked(uploadAsset).mock.calls[0]![0]
    expect(removeAsset).toHaveBeenCalledWith(path)
    expect(writes('COMMIT')).toHaveLength(0)
  })

  it('preserves post deletion and duplicate ID restrictions', async () => {
    await expect(
      save((draft) => {
        draft.posts = []
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    await expect(
      save((draft) => {
        draft.assets.push(draft.assets[0]!)
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
