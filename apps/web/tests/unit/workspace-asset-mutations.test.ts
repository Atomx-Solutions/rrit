import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import sharp from 'sharp'
import {
  assetDeleteSchema,
  assetMetadataUpdateSchema,
} from '../../shared/schemas/workspace-resources'
import {
  createWorkspaceAsset,
  deleteWorkspaceAsset,
  parseWorkspaceAssetUpload,
  updateWorkspaceAsset,
} from '../../server/utils/workspace-assets'
import { readBodyWithinLimit } from '../../server/utils/bounded-request-body'
import { removeAsset, uploadAsset } from '../../server/utils/asset-storage'
import * as trials from '../../server/utils/trials'

vi.mock('../../server/utils/trials', () => ({
  requireQuota: vi.fn(async () => undefined),
  requireEntitlement: vi.fn(async () => undefined),
}))
vi.mock('../../server/utils/asset-storage', async (original) => ({
  ...(await original<typeof import('../../server/utils/asset-storage')>()),
  uploadAsset: vi.fn(async () => undefined),
  removeAsset: vi.fn(async () => undefined),
}))

const userId = randomUUID()
const businessId = randomUUID()
const assetId = randomUUID()
let jpeg: Buffer
let png: Buffer

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#24513f' },
  })
    .jpeg()
    .toBuffer()
  png = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#24513f' },
  })
    .png()
    .toBuffer()
})

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    name: 'Kafe.jpg',
    tags: ['kafe'],
    rights: true,
    generated: false,
    size: jpeg.length,
    storage_path: `test-${businessId}/kafe.jpg`,
    ...overrides,
  }
}

function databaseDouble(
  options: {
    revision?: number
    asset?: ReturnType<typeof assetRow>
    assetBelongsToBusiness?: boolean
    usedByPost?: boolean
    failInsert?: boolean
  } = {},
) {
  let revision = options.revision ?? 5
  let storedAsset = options.asset
  const statements: { sql: string; values: unknown[] }[] = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values })
    if (sql.startsWith('SELECT revision FROM businesses'))
      return { rows: [{ revision }], rowCount: 1 }
    if (sql.startsWith('SELECT id,name,tags,rights') && sql.includes('FOR UPDATE'))
      return {
        rows: storedAsset && options.assetBelongsToBusiness !== false ? [{ ...storedAsset }] : [],
        rowCount: storedAsset && options.assetBelongsToBusiness !== false ? 1 : 0,
      }
    if (sql.startsWith("SELECT id FROM posts WHERE business_id=$1 AND payload->>'image'=$2"))
      return {
        rows: options.usedByPost ? [{ id: randomUUID() }] : [],
        rowCount: options.usedByPost ? 1 : 0,
      }
    if (sql.startsWith('INSERT INTO assets ')) {
      if (options.failInsert) throw new Error('insert failed')
      storedAsset = assetRow({
        id: values[0],
        name: values[2],
        tags: JSON.parse(values[3] as string),
        storage_path: values[4],
        size: values[5],
      })
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE assets SET name=')) {
      storedAsset = { ...storedAsset!, name: values[0], tags: values[1], rights: values[2] }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('DELETE FROM assets')) {
      storedAsset = undefined
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE businesses SET revision=revision+1')) {
      if (values[2] !== revision) return { rows: [], rowCount: 0 }
      revision += 1
      return { rows: [{ revision }], rowCount: 1 }
    }
    if (sql.startsWith('SELECT app.record_audit_event'))
      return { rows: [{ record_audit_event: '1' }], rowCount: 1 }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  return {
    client: { query } as never,
    statements,
    get asset() {
      return storedAsset
    },
  }
}

function multipartParts(overrides: { rights?: string; type?: string; data?: Buffer } = {}) {
  return [
    { name: 'workspaceRevision', data: Buffer.from('5') },
    { name: 'name', data: Buffer.from('Kafe.jpg') },
    { name: 'tags', data: Buffer.from('["kafe","produkt"]') },
    { name: 'rights', data: Buffer.from(overrides.rights ?? 'true') },
    {
      name: 'file',
      filename: 'kafe.jpg',
      type: overrides.type ?? 'image/jpeg',
      data: overrides.data ?? jpeg,
    },
  ]
}

describe('workspace asset mutation contracts', () => {
  it('rejects streamed bytes over the limit even when Content-Length falsely claims a small body', async () => {
    const request = Readable.from([Buffer.alloc(8), Buffer.alloc(8)])
    Object.assign(request, { headers: { 'content-length': '1' } })
    await expect(readBodyWithinLimit(request, 8)).rejects.toMatchObject({ statusCode: 413 })
  })

  it('accepts a supported PNG upload so it can be normalized server-side', () => {
    const parts = multipartParts({ type: 'image/png', data: png })
    expect(parseWorkspaceAssetUpload(multipartParts())).toMatchObject({
      metadata: {
        workspaceRevision: 5,
        name: 'Kafe.jpg',
        tags: ['kafe', 'produkt'],
        rights: true,
      },
      file: { filename: 'kafe.jpg', type: 'image/jpeg' },
    })
    expect(parseWorkspaceAssetUpload(parts).file.type).toBe('image/png')
  })

  it.each([
    multipartParts({ rights: 'false' }),
    multipartParts({ data: Buffer.alloc(2097153) }),
    multipartParts().filter((part) => part.name !== 'file'),
    [...multipartParts(), { name: 'storage_path', data: Buffer.from('forged') }],
  ])('rejects invalid or unsafe multipart uploads', (parts) => {
    expect(() => parseWorkspaceAssetUpload(parts)).toThrow()
  })

  it('allows delete only with a workspace revision token', () => {
    expect(assetDeleteSchema.parse({ workspaceRevision: 5 })).toEqual({ workspaceRevision: 5 })
    expect(assetDeleteSchema.safeParse({}).success).toBe(false)
    expect(assetDeleteSchema.safeParse({ workspaceRevision: 5, storage_path: 'x' }).success).toBe(
      false,
    )
  })

  it('keeps metadata updates strict and rejects bytes/storage replacement fields', () => {
    for (const key of ['bytes', 'file', 'url', 'storage_path', 'size']) {
      expect(
        assetMetadataUpdateSchema.safeParse({
          workspaceRevision: 5,
          name: 'Emër i ri',
          [key]: 'forged',
        }).success,
      ).toBe(false)
    }
  })
})

describe('individual workspace asset persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uploads one validated asset, checks quota and advances revision', async () => {
    const db = databaseDouble()
    const uploadedStoragePaths: string[] = []
    const result = await createWorkspaceAsset(db.client, {
      businessId,
      userId,
      slug: 'test-brand',
      metadata: {
        workspaceRevision: 5,
        name: 'Kafe.jpg',
        tags: ['kafe'],
        rights: true,
      },
      file: { filename: 'kafe.jpg', type: 'image/jpeg', data: jpeg },
      uploadedStoragePaths,
    })

    expect(result).toMatchObject({
      workspaceRevision: 6,
      asset: {
        name: 'Kafe.jpg',
        rights: true,
        size: jpeg.length,
        kind: 'photo',
      },
    })
    expect(result.asset.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(uploadAsset).toHaveBeenCalledWith(uploadedStoragePaths[0], expect.any(Buffer))
    expect(trials.requireQuota).toHaveBeenCalledWith(
      businessId,
      'media_storage_bytes',
      jpeg.length,
      db.client,
    )
    expect(trials.requireEntitlement).toHaveBeenCalledWith(businessId, 'media', db.client)
  })

  it('updates only asset metadata and advances revision', async () => {
    const db = databaseDouble({ asset: assetRow() })
    const result = await updateWorkspaceAsset(db.client, {
      businessId,
      userId,
      assetId,
      input: { workspaceRevision: 5, name: 'Emër i ri', tags: ['produkt'] },
    })
    expect(result).toMatchObject({
      workspaceRevision: 6,
      asset: { id: assetId, name: 'Emër i ri', tags: ['produkt'], rights: true },
    })
    const update = db.statements.find(({ sql }) => sql.startsWith('UPDATE assets SET name='))!
    expect(update.sql).not.toMatch(/bytes|storage_path/)
  })

  it('rejects stale revisions and assets from another tenant', async () => {
    const stale = databaseDouble({ revision: 6, asset: assetRow() })
    await expect(
      updateWorkspaceAsset(stale.client, {
        businessId,
        userId,
        assetId,
        input: { workspaceRevision: 5, name: 'Ndryshim' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    const foreign = databaseDouble({ asset: assetRow(), assetBelongsToBusiness: false })
    await expect(
      updateWorkspaceAsset(foreign.client, {
        businessId,
        userId,
        assetId,
        input: { workspaceRevision: 5, name: 'Ndryshim' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('blocks deletion while a post uses the asset', async () => {
    const db = databaseDouble({ asset: assetRow(), usedByPost: true })
    await expect(
      deleteWorkspaceAsset(db.client, {
        businessId,
        userId,
        assetId,
        workspaceRevision: 5,
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(db.statements.some(({ sql }) => sql.startsWith('DELETE FROM assets'))).toBe(false)
  })

  it('deletes an unused tenant asset and returns its storage cleanup path', async () => {
    const db = databaseDouble({ asset: assetRow() })
    const result = await deleteWorkspaceAsset(db.client, {
      businessId,
      userId,
      assetId,
      workspaceRevision: 5,
    })
    expect(result).toEqual({
      deleted: true,
      assetId,
      workspaceRevision: 6,
      storagePath: `test-${businessId}/kafe.jpg`,
    })
  })
})

describe('workspace asset HTTP endpoints', () => {
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
    vi.stubGlobal('readMultipartFormData', async (event: { parts: unknown }) => event.parts)
    vi.stubGlobal(
      'getHeader',
      (event: { headers?: Record<string, string> }, key: string) => event.headers?.[key],
    )
    vi.stubGlobal('createError', createError)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects multipart uploads without a declared bounded body size before parsing', async () => {
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.post')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        parts: multipartParts(),
        headers: { 'content-type': 'multipart/form-data; boundary=test' },
      }),
    ).rejects.toMatchObject({ statusCode: 411 })
  })

  it('rejects an oversized multipart stream despite a forged small Content-Length', async () => {
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.post')
    const request = Readable.from([Buffer.alloc(5 * 1024 * 1024 + 64 * 1024 + 1)])
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        headers: {
          'content-type': 'multipart/form-data; boundary=test',
          'content-length': '1',
        },
        node: { req: request },
      }),
    ).rejects.toMatchObject({ statusCode: 413 })
  })

  it('cleans an uploaded storage object when the database transaction fails', async () => {
    const db = databaseDouble({ failInsert: true })
    vi.stubGlobal(
      'withBusinessTransaction',
      async (
        _userId: string,
        work: (
          client: typeof db.client,
          business: { id: string; slug: string },
        ) => Promise<unknown>,
      ) => work(db.client, { id: businessId, slug: 'test-brand' }),
    )
    const { default: handler } = await import('../../server/api/workspaces/[id]/assets/index.post')
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        parts: multipartParts(),
        headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': '1024' },
      }),
    ).rejects.toThrow('insert failed')
    expect(removeAsset).toHaveBeenCalledWith(vi.mocked(uploadAsset).mock.calls[0]![0])
  })

  it.each([
    ['PUT', '../../server/api/workspaces/[id]/assets/[assetId].put'],
    ['DELETE', '../../server/api/workspaces/[id]/assets/[assetId].delete'],
  ] as const)('%s hides another workspace before mutating an asset', async (_method, path) => {
    const transaction = vi.fn(
      async (
        _userId: string,
        work: (client: never, business: { id: string }) => Promise<unknown>,
      ) => work({} as never, { id: randomUUID() }),
    )
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import(path)
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId, assetId },
        body:
          _method === 'PUT' ? { workspaceRevision: 5, name: 'Ndryshim' } : { workspaceRevision: 5 },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
