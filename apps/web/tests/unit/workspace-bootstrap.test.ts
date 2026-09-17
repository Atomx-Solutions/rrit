import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWorkspaceBootstrap } from '../../server/utils/workspaces'

const userId = randomUUID()
const businessId = randomUUID()
const brandId = randomUUID()

const state = {
  preferences: {
    name: 'Dina',
    email: 'dina@example.com',
    timezone: 'Europe/Belgrade',
    locale: 'sq-XK',
    currency: 'EUR',
    emailApprovals: true,
    emailPublished: true,
    emailTips: false,
  },
  onboarding: 2,
  dismissed: ['welcome'],
  notificationsRead: false,
}

const brand = {
  id: brandId,
  organization_id: businessId,
  revision: 4,
  slug: 'test-brand',
  name: 'Test Brand',
  profile: {
    description: 'Përshkrim',
    voice: 'Miqësor',
    audience: 'Klientë lokalë',
    industry: 'Kafene',
    city: 'Prishtinë',
    color: '#17694d',
    facebookUrl: '',
    instagramUrl: '',
    goals: [],
    researchSources: [],
    facts: [],
    guardrails: [],
  },
  settings: { emailApprovals: false, emailPublished: true, emailTips: true },
  timezone: 'Europe/Tirane',
  locale: 'en-US',
  category: 'Kafene',
  status: 'active',
  archived_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-09-16T00:00:00Z'),
}

function databaseDouble({ ownerMatches = true } = {}) {
  const statements: string[] = []
  const query = vi.fn(async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('SELECT id, slug, state, revision FROM businesses'))
      return ownerMatches
        ? { rows: [{ id: businessId, slug: 'test-brand', state, revision: 8 }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    if (sql.includes('FROM brands WHERE organization_id=$1 AND slug=$2'))
      return { rows: [brand], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::integer AS count FROM posts'))
      return { rows: [{ count: 37 }], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::integer AS count FROM assets'))
      return { rows: [{ count: 12 }], rowCount: 1 }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  return { client: { query } as never, statements }
}

describe('workspace bootstrap loader', () => {
  beforeEach(() => {
    vi.stubGlobal('createError', createError)
  })

  it('returns only startup metadata, canonical Brand and counts', async () => {
    const db = databaseDouble()
    const result = await loadWorkspaceBootstrap(db.client, businessId, userId)

    expect(result).toEqual({
      id: businessId,
      slug: 'test-brand',
      revision: 8,
      brand: expect.objectContaining({ id: brandId, revision: 4, name: 'Test Brand' }),
      preferences: {
        ...state.preferences,
        timezone: 'Europe/Tirane',
        locale: 'en-US',
        emailApprovals: false,
        emailPublished: true,
        emailTips: true,
      },
      onboarding: 2,
      dismissed: ['welcome'],
      notificationsRead: false,
      postCount: 37,
      assetCount: 12,
      capabilities: {
        posts: true,
        assets: true,
        brand: true,
        preferences: true,
      },
    })
    expect(result).not.toHaveProperty('posts')
    expect(result).not.toHaveProperty('assets')
    expect(db.statements.some((sql) => sql.includes('SELECT payload FROM posts'))).toBe(false)
    expect(db.statements.some((sql) => sql.includes('SELECT id, name, tags'))).toBe(false)
  })

  it('hides a workspace owned by another tenant', async () => {
    const db = databaseDouble({ ownerMatches: false })
    await expect(loadWorkspaceBootstrap(db.client, businessId, userId)).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('workspace bootstrap endpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('requireUser', async () => ({ id: userId }))
    vi.stubGlobal(
      'getRouterParam',
      (event: { params: Record<string, string> }, key: string) => event.params[key],
    )
    vi.stubGlobal('setHeader', vi.fn())
    vi.stubGlobal('createError', createError)
  })

  it('authorizes the requested business through the existing tenant transaction', async () => {
    const db = databaseDouble()
    const transaction = vi.fn(
      async (_user: string, work: (client: never, business: unknown) => Promise<unknown>) =>
        work(db.client, { id: businessId, slug: 'test-brand' }),
    )
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import('../../server/api/workspaces/[id]/bootstrap.get')
    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId },
    })
    expect(result).toMatchObject({ id: businessId, postCount: 37, assetCount: 12 })
    expect(transaction).toHaveBeenCalledWith(userId, expect.any(Function))
  })
})
