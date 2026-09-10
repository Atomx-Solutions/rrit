import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const userId = randomUUID()
const organizationId = randomUUID()
const brandId = randomUUID()
const client = { query: vi.fn() }
const withOrganizationTransaction = vi.fn(async (_userId: string, _organizationId: string, work: (client: typeof client) => Promise<unknown>) =>
  work(client),
)
const createBrand = vi.fn()
const listBrands = vi.fn()
const getBrand = vi.fn()
const updateBrand = vi.fn()
const archiveBrand = vi.fn()
const deleteArchivedBrand = vi.fn()
const requireOrganizationManager = vi.fn()

vi.mock('../../server/utils/brands', () => ({
  withOrganizationTransaction,
  createBrand,
  listBrands,
  getBrand,
  updateBrand,
  archiveBrand,
  deleteArchivedBrand,
  requireOrganizationManager,
}))

function setupGlobals() {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('requireUser', async () => ({ id: userId, name: 'Test', email: 'test@example.test' }))
  vi.stubGlobal('requireSameOrigin', () => undefined)
  vi.stubGlobal('getRouterParam', (event: { params: Record<string, string> }, key: string) => event.params[key])
  vi.stubGlobal('boundedBody', async (event: { body: unknown }) => event.body)
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('setHeader', vi.fn())
  vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number; message: string }) =>
    Object.assign(new Error(message), { statusCode }),
  )
}

function event(body?: unknown, params = { organizationId, brandId }) {
  return { body, params }
}

describe('Brand HTTP API handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupGlobals()
  })

  it('rejects an invalid IANA timezone at the POST boundary', async () => {
    const { default: handler } = await import('../../server/api/organizations/[organizationId]/brands/index.post')

    await expect(
      (handler as (event: unknown) => Promise<unknown>)(
        event({
          name: 'Brand A',
          slug: 'brand-a',
          timezone: 'Not/A-Timezone',
          locale: 'sq-XK',
          category: 'cafe',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(withOrganizationTransaction).not.toHaveBeenCalled()
  })

  it('passes the authenticated user and organization scope to create and returns 201', async () => {
    const created = { id: brandId, organizationId, slug: 'brand-a' }
    createBrand.mockResolvedValue(created)
    const setResponseStatus = globalThis.setResponseStatus as ReturnType<typeof vi.fn>
    const { default: handler } = await import('../../server/api/organizations/[organizationId]/brands/index.post')

    const result = await (handler as (event: unknown) => Promise<unknown>)(
      event({
        name: 'Brand A',
        slug: 'brand-a',
        timezone: 'Europe/Tirane',
        locale: 'sq-XK',
        category: 'cafe',
      }),
    )

    expect(result).toEqual(created)
    expect(withOrganizationTransaction).toHaveBeenCalledWith(userId, organizationId, expect.any(Function))
    expect(createBrand).toHaveBeenCalledWith(client, organizationId, expect.objectContaining({
      timezone: 'Europe/Tirane',
    }))
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 201)
  })

  it('keeps reads and writes scoped by both organizationId and brandId', async () => {
    getBrand.mockResolvedValue({ id: brandId, organizationId })
    updateBrand.mockResolvedValue({ id: brandId, organizationId, name: 'Updated' })
    const { default: getHandler } = await import('../../server/api/organizations/[organizationId]/brands/[brandId].get')
    const { default: updateHandler } = await import('../../server/api/organizations/[organizationId]/brands/[brandId].put')

    await (getHandler as (event: unknown) => Promise<unknown>)(event())
    await (updateHandler as (event: unknown) => Promise<unknown>)(
      event({ name: 'Updated' }),
    )

    expect(getBrand).toHaveBeenCalledWith(client, organizationId, brandId)
    expect(updateBrand).toHaveBeenCalledWith(
      client,
      organizationId,
      brandId,
      expect.objectContaining({ name: 'Updated' }),
    )
  })

  it('requires manager authorization for archive and physical delete', async () => {
    archiveBrand.mockResolvedValue({ id: brandId, status: 'archived' })
    deleteArchivedBrand.mockResolvedValue({ deleted: true, id: brandId })
    const { default: archiveHandler } = await import('../../server/api/organizations/[organizationId]/brands/[brandId]/archive.post')
    const { default: deleteHandler } = await import('../../server/api/organizations/[organizationId]/brands/[brandId].delete')

    await (archiveHandler as (event: unknown) => Promise<unknown>)(event())
    await (deleteHandler as (event: unknown) => Promise<unknown>)(event())

    expect(requireOrganizationManager).toHaveBeenCalledTimes(2)
    expect(requireOrganizationManager).toHaveBeenNthCalledWith(1, client, userId, organizationId)
    expect(requireOrganizationManager).toHaveBeenNthCalledWith(2, client, userId, organizationId)
    expect(archiveBrand).toHaveBeenCalledWith(client, organizationId, brandId)
    expect(deleteArchivedBrand).toHaveBeenCalledWith(client, organizationId, brandId)
  })
})
