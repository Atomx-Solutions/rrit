import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  paginationQuerySchema,
  paginatedResponseSchema,
  postCreateSchema,
  postUpdateSchema,
  preferencesUpdateSchema,
  assetUploadMetadataSchema,
  assetMetadataUpdateSchema,
  workspaceMetadataUpdateSchema,
} from '../../shared/schemas/workspace-resources'

const post = {
  title: 'Kafe e freskët',
  caption: 'Ejani për kafe.',
  channel: 'Instagram',
  format: 'static',
  image: '/api/media/550e8400-e29b-41d4-a716-446655440000',
  pillar: 'Produkte',
}

describe('workspace resource pagination', () => {
  it('defaults to a bounded page and accepts query-string numbers', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
    expect(paginationQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    })
  })

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: true },
    { page: ['2'] },
    { page: 'abc' },
    { page: '' },
    { page: null },
    { page: Number.MAX_SAFE_INTEGER + 1 },
    { pageSize: 0 },
    { pageSize: 51 },
    { pageSize: '1.5' },
  ])('rejects invalid pagination %j', (input) => {
    expect(paginationQuerySchema.safeParse(input).success).toBe(false)
  })

  it('validates item types and page bounds in responses', () => {
    const schema = paginatedResponseSchema(z.strictObject({ id: z.uuid() }))
    const page = { items: [], page: 1, pageSize: 20, total: 0, hasNext: false }
    expect(schema.parse(page)).toEqual(page)
    expect(schema.safeParse({ ...page, items: [{ id: 'invalid' }] }).success).toBe(false)
    expect(schema.safeParse({ ...page, total: -1 }).success).toBe(false)
    expect(schema.safeParse({ ...page, pageSize: 51 }).success).toBe(false)
    expect(schema.safeParse({ ...page, hasNext: 'false' }).success).toBe(false)
  })
})

describe('individual post contracts', () => {
  it('accepts a new post at workspace revision zero without server-owned fields', () => {
    expect(postCreateSchema.parse({ ...post, workspaceRevision: 0 })).toEqual({
      ...post,
      workspaceRevision: 0,
    })
  })

  it('accepts a caption-only update and a scheduling command', () => {
    const update = { workspaceRevision: 3, postVersion: 2, caption: 'Caption i ri' }
    expect(postUpdateSchema.parse(update)).toEqual(update)
    expect(
      postUpdateSchema.safeParse({
        workspaceRevision: 3,
        postVersion: 2,
        status: 'scheduled',
        scheduledAt: '2026-12-01T10:00:00Z',
        publicationMode: 'manual',
      }).success,
    ).toBe(true)
  })

  it.each([
    'providerPostId',
    'publishedAt',
    'policy',
    'policyReason',
    'history',
    'contentVersion',
    'aiProvenance',
    'posts',
    'brand',
    'assets',
  ])('rejects injected %s instead of silently dropping it', (key) => {
    expect(
      postUpdateSchema.safeParse({
        workspaceRevision: 1,
        postVersion: 1,
        caption: 'Text',
        [key]: 'forged',
      }).success,
    ).toBe(false)
    expect(
      postCreateSchema.safeParse({ ...post, workspaceRevision: 0, [key]: 'forged' }).success,
    ).toBe(false)
  })

  it.each([
    { workspaceRevision: 1, postVersion: 1 },
    { workspaceRevision: 1, caption: 'Text' },
    { workspaceRevision: -1, postVersion: 1, caption: 'Text' },
    { workspaceRevision: 1, postVersion: 0, caption: 'Text' },
    { workspaceRevision: '1', postVersion: 1, caption: 'Text' },
    { workspaceRevision: 1, postVersion: 1, status: 'published' },
    { workspaceRevision: 1, postVersion: 1, status: 'failed' },
    { workspaceRevision: 1, postVersion: 1, caption: '   ' },
    { workspaceRevision: 1, postVersion: 1, image: 'data:image/jpeg;base64,abcd' },
  ])('rejects invalid or unversioned post update %j', (input) => {
    expect(postUpdateSchema.safeParse(input).success).toBe(false)
  })

  it('rejects incomplete creations and creation with client-supplied status', () => {
    expect(postCreateSchema.safeParse({ workspaceRevision: 0, caption: 'Text' }).success).toBe(
      false,
    )
    expect(
      postCreateSchema.safeParse({ ...post, workspaceRevision: 0, status: 'approved' }).success,
    ).toBe(false)
  })
})

describe('preferences and workspace metadata contracts', () => {
  it('accepts a timezone-only preferences update without defaulting other fields', () => {
    const input = { workspaceRevision: 0, brandRevision: 1, timezone: 'Europe/Tirane' }
    expect(preferencesUpdateSchema.parse(input)).toEqual(input)
  })

  it.each([
    { timezone: 'invalid/timezone' },
    { email: 'invalid' },
    { locale: 'xx' },
    { currency: 'USD' },
    { posts: [] },
    { brand: {} },
    { assets: [] },
    { emailTips: 'false' },
    { brandRevision: 0, timezone: 'UTC' },
  ])('rejects invalid preferences %j', (change) => {
    expect(
      preferencesUpdateSchema.safeParse({ workspaceRevision: 0, brandRevision: 1, ...change })
        .success,
    ).toBe(false)
  })

  it('requires revision tokens and at least one preference', () => {
    expect(
      preferencesUpdateSchema.safeParse({ workspaceRevision: 0, brandRevision: 1 }).success,
    ).toBe(false)
    expect(preferencesUpdateSchema.safeParse({ timezone: 'UTC' }).success).toBe(false)
  })

  it('accepts workspace metadata only', () => {
    const input = { revision: 0, onboarding: 2, dismissed: ['welcome'], notificationsRead: true }
    expect(workspaceMetadataUpdateSchema.parse(input)).toEqual(input)
    for (const key of ['posts', 'assets', 'brand', 'preferences']) {
      expect(workspaceMetadataUpdateSchema.safeParse({ ...input, [key]: {} }).success).toBe(false)
    }
    expect(workspaceMetadataUpdateSchema.safeParse({ revision: 0 }).success).toBe(false)
    expect(workspaceMetadataUpdateSchema.safeParse({ revision: 0, onboarding: 1.5 }).success).toBe(
      false,
    )
    expect(workspaceMetadataUpdateSchema.safeParse({ revision: 0, onboarding: 5 }).success).toBe(
      false,
    )
  })
})

describe('asset resource contracts', () => {
  it('accepts upload metadata with explicit rights confirmation', () => {
    const input = { workspaceRevision: 0, name: 'Kafe.jpg', tags: ['kafe'], rights: true }
    expect(assetUploadMetadataSchema.parse(input)).toEqual(input)
    expect(assetUploadMetadataSchema.safeParse({ ...input, rights: false }).success).toBe(false)
    expect(
      assetUploadMetadataSchema.safeParse({ workspaceRevision: 0, name: 'Kafe.jpg', tags: [] })
        .success,
    ).toBe(false)
  })

  it('accepts a metadata-only update including rights withdrawal', () => {
    const input = { workspaceRevision: 1, name: 'Foto e re', rights: false }
    expect(assetMetadataUpdateSchema.parse(input)).toEqual(input)
    expect(assetMetadataUpdateSchema.safeParse({ workspaceRevision: 1 }).success).toBe(false)
  })

  it.each(['url', 'bytes', 'storage_path', 'size', 'generated', 'base64'])(
    'rejects injected %s in metadata',
    (key) => {
      const input = {
        workspaceRevision: 0,
        name: 'Kafe.jpg',
        tags: [],
        rights: true,
        [key]: 'forged',
      }
      expect(assetMetadataUpdateSchema.safeParse(input).success).toBe(false)
      expect(assetUploadMetadataSchema.safeParse(input).success).toBe(false)
    },
  )

  it('enforces existing asset name and tag limits', () => {
    for (const change of [
      { name: 'x'.repeat(251) },
      { tags: Array(21).fill('tag') },
      { tags: ['x'.repeat(101)] },
    ]) {
      const input = { workspaceRevision: 0, name: 'Kafe.jpg', tags: [], rights: true, ...change }
      expect(assetUploadMetadataSchema.safeParse(input).success).toBe(false)
      expect(assetMetadataUpdateSchema.safeParse(input).success).toBe(false)
    }
  })
})
