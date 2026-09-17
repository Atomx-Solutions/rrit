import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import {
  getWorkspacePreferences,
  updateWorkspacePreferences,
} from '../../server/utils/workspace-preferences'

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
}

function brandRow(revision = 3, overrides: Record<string, unknown> = {}) {
  return {
    id: brandId,
    organization_id: businessId,
    revision,
    slug: 'test-brand',
    name: 'Test Brand',
    profile: {},
    settings: { emailApprovals: false, emailPublished: true, emailTips: true },
    timezone: 'Europe/Tirane',
    locale: 'en-US',
    category: 'cafe',
    status: 'active',
    archived_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function databaseDouble(
  options: {
    workspaceRevision?: number
    brandRevision?: number
    ownerMatches?: boolean
  } = {},
) {
  let workspaceRevision = options.workspaceRevision ?? 5
  let brandRevision = options.brandRevision ?? 3
  let currentState = structuredClone(state)
  let currentBrand = brandRow(brandRevision)
  const statements: { sql: string; values: unknown[] }[] = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values })
    if (sql.startsWith('SELECT state,revision FROM businesses'))
      return options.ownerMatches === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ state: currentState, revision: workspaceRevision }], rowCount: 1 }
    if (sql.startsWith('SELECT revision,state FROM businesses'))
      return options.ownerMatches === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ state: currentState, revision: workspaceRevision }], rowCount: 1 }
    if (sql.includes('FROM brands WHERE organization_id=$1 AND slug=$2'))
      return { rows: [currentBrand], rowCount: 1 }
    if (sql.includes('FROM brands WHERE organization_id=$1 AND id=$2'))
      return { rows: [currentBrand], rowCount: 1 }
    if (sql.startsWith('UPDATE brands')) {
      if (values[10] !== brandRevision) return { rows: [], rowCount: 0 }
      brandRevision += 1
      currentBrand = brandRow(brandRevision, {
        slug: values[0],
        name: values[1],
        profile: JSON.parse(values[2] as string),
        settings: JSON.parse(values[3] as string),
        timezone: values[4],
        locale: values[5],
        category: values[6],
        status: values[7],
        updated_at: new Date('2026-09-16T00:00:00Z'),
      })
      return { rows: [currentBrand], rowCount: 1 }
    }
    if (sql.startsWith("UPDATE businesses SET state=jsonb_set(state,'{preferences}'")) {
      if (values[3] !== workspaceRevision) return { rows: [], rowCount: 0 }
      currentState = { ...currentState, preferences: JSON.parse(values[0] as string) }
      workspaceRevision += 1
      return { rows: [{ revision: workspaceRevision }], rowCount: 1 }
    }
    if (sql.startsWith('SELECT app.record_audit_event'))
      return { rows: [{ record_audit_event: '1' }], rowCount: 1 }
    throw new Error(`Unexpected SQL: ${sql}`)
  })
  return {
    client: { query } as never,
    statements,
    get state() {
      return currentState
    },
  }
}

describe('workspace preferences resource service', () => {
  it('reads profile fields from workspace and shared settings from the canonical brand', async () => {
    const db = databaseDouble()
    const result = await getWorkspacePreferences(db.client, {
      businessId,
      userId,
      slug: 'test-brand',
    })
    expect(result).toEqual({
      preferences: {
        name: 'Dina',
        email: 'dina@example.com',
        currency: 'EUR',
        timezone: 'Europe/Tirane',
        locale: 'en-US',
        emailApprovals: false,
        emailPublished: true,
        emailTips: true,
      },
      workspaceRevision: 5,
      brandRevision: 3,
    })
  })

  it('updates shared fields through the existing Brand domain update and advances both revisions', async () => {
    const db = databaseDouble()
    const result = await updateWorkspacePreferences(db.client, {
      businessId,
      userId,
      slug: 'test-brand',
      input: {
        workspaceRevision: 5,
        brandRevision: 3,
        timezone: 'UTC',
        locale: 'sq-XK',
        emailTips: false,
      },
    })

    expect(result).toMatchObject({
      preferences: { timezone: 'UTC', locale: 'sq-XK', emailTips: false },
      workspaceRevision: 6,
      brandRevision: 4,
    })
    const brandUpdate = db.statements.find(({ sql }) => sql.startsWith('UPDATE brands'))!
    expect(brandUpdate.values[3]).toBe(
      JSON.stringify({ emailApprovals: false, emailPublished: true, emailTips: false }),
    )
    expect(db.state.preferences).toEqual(result.preferences)
  })

  it('rejects stale workspace revision before updating Brand', async () => {
    const db = databaseDouble({ workspaceRevision: 6 })
    await expect(
      updateWorkspacePreferences(db.client, {
        businessId,
        userId,
        slug: 'test-brand',
        input: { workspaceRevision: 5, brandRevision: 3, timezone: 'UTC' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(db.statements.some(({ sql }) => sql.startsWith('UPDATE brands'))).toBe(false)
  })

  it('preserves Brand conflict detection and does not update workspace after a stale Brand', async () => {
    const db = databaseDouble({ brandRevision: 4 })
    await expect(
      updateWorkspacePreferences(db.client, {
        businessId,
        userId,
        slug: 'test-brand',
        input: { workspaceRevision: 5, brandRevision: 3, timezone: 'UTC' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(
      db.statements.some(({ sql }) =>
        sql.startsWith("UPDATE businesses SET state=jsonb_set(state,'{preferences}'"),
      ),
    ).toBe(false)
  })

  it('does not expose another tenant workspace', async () => {
    const db = databaseDouble({ ownerMatches: false })
    await expect(
      getWorkspacePreferences(db.client, { businessId, userId, slug: 'test-brand' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('workspace preferences HTTP endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('requireSameOrigin', vi.fn())
    vi.stubGlobal('requireUser', async () => ({ id: userId }))
    vi.stubGlobal(
      'getRouterParam',
      (event: { params: Record<string, string> }, key: string) => event.params[key],
    )
    vi.stubGlobal('boundedBody', async (event: { body: unknown }) => event.body)
    vi.stubGlobal('setHeader', vi.fn())
    vi.stubGlobal('createError', createError)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('GET returns preferences through the authenticated tenant transaction', async () => {
    const db = databaseDouble()
    vi.stubGlobal(
      'withBusinessTransaction',
      async (
        receivedUserId: string,
        work: (
          client: typeof db.client,
          business: { id: string; slug: string },
        ) => Promise<unknown>,
      ) => {
        expect(receivedUserId).toBe(userId)
        return work(db.client, { id: businessId, slug: 'test-brand' })
      },
    )
    const { default: handler } =
      await import('../../server/api/workspaces/[id]/preferences/index.get')
    const result = await (handler as (event: unknown) => Promise<unknown>)({
      params: { id: businessId },
    })
    expect(result).toMatchObject({ workspaceRevision: 5, brandRevision: 3 })
  })

  it('PUT rejects invalid timezone, locale and workspace-shaped fields before a transaction', async () => {
    const transaction = vi.fn()
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } =
      await import('../../server/api/workspaces/[id]/preferences/index.put')
    for (const body of [
      { workspaceRevision: 5, brandRevision: 3, timezone: 'Invalid/Zone' },
      { workspaceRevision: 5, brandRevision: 3, locale: 'de-DE' },
      { workspaceRevision: 5, brandRevision: 3, posts: [] },
      { workspaceRevision: 5, brandRevision: 3, assets: [] },
      { workspaceRevision: 5, brandRevision: 3, brand: {} },
    ]) {
      await expect(
        (handler as (event: unknown) => Promise<unknown>)({ params: { id: businessId }, body }),
      ).rejects.toMatchObject({ statusCode: 422 })
    }
    expect(transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', '../../server/api/workspaces/[id]/preferences/index.get'],
    ['PUT', '../../server/api/workspaces/[id]/preferences/index.put'],
  ] as const)('%s hides another workspace', async (method, path) => {
    const transaction = vi.fn(
      async (
        _userId: string,
        work: (client: never, business: { id: string; slug: string }) => Promise<unknown>,
      ) => work({} as never, { id: randomUUID(), slug: 'other' }),
    )
    vi.stubGlobal('withBusinessTransaction', transaction)
    const { default: handler } = await import(path)
    await expect(
      (handler as (event: unknown) => Promise<unknown>)({
        params: { id: businessId },
        ...(method === 'PUT'
          ? { body: { workspaceRevision: 5, brandRevision: 3, timezone: 'UTC' } }
          : {}),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
