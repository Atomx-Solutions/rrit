import { describe, expect, it, vi } from 'vitest'
import {
  PackageInputError,
  customPackageFromRow,
  expireCustomPackages,
  outgrownPackageStatus,
  packageIsInForce,
  packagePriceIsOverridden,
  resolvePackagePricing,
  suggestedPackagePriceCents,
} from '../../server/utils/custom-packages'
import {
  customPackageChangesSchema,
  customPackageCreateSchema,
  customPackageFailure,
} from '../../server/utils/admin-custom-packages'
import { customPackageDraftSchema, customPackageSchema } from '../../shared/schemas/custom-package'

const organizationId = '11111111-1111-4111-8111-111111111111'
const packageId = '22222222-2222-4222-8222-222222222222'

function draft(overrides: Record<string, unknown> = {}) {
  return {
    organizationId,
    name: 'Paketa e negociuar',
    postsIncluded: 20,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
    status: 'draft' as const,
    ...overrides,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: packageId,
    organization_id: organizationId,
    name: 'Paketa e negociuar',
    posts_included: 20,
    post_price_cents: 150,
    price_cents: 2800,
    suggested_price_cents: 3000,
    currency: 'EUR' as const,
    starts_at: new Date('2026-10-01T00:00:00.000Z'),
    ends_at: new Date('2026-11-01T00:00:00.000Z'),
    status: 'active' as const,
    notes: null,
    ...overrides,
  }
}

describe('custom package pricing', () => {
  it('suggests a price from the configured per-post rate', () => {
    expect(suggestedPackagePriceCents(20, 150)).toBe(3000)
    // The rate is a setting, so a different rate must change the suggestion
    // without any change in this code.
    expect(suggestedPackagePriceCents(20, 200)).toBe(4000)
  })

  it('refuses a post count or rate that cannot produce a price', () => {
    expect(() => suggestedPackagePriceCents(0, 150)).toThrow(PackageInputError)
    expect(() => suggestedPackagePriceCents(20.5, 150)).toThrow(PackageInputError)
    expect(() => suggestedPackagePriceCents(20, 0)).toThrow(PackageInputError)
  })

  it('accepts the suggestion when the superadmin does not override it', () => {
    const pricing = resolvePackagePricing(customPackageDraftSchema.parse(draft()), 150)

    expect(pricing).toEqual({ postPriceCents: 150, suggestedPriceCents: 3000, priceCents: 3000 })
    expect(packagePriceIsOverridden({ ...pricing })).toBe(false)
  })

  it('keeps the suggestion beside an overridden price', () => {
    const pricing = resolvePackagePricing(
      customPackageDraftSchema.parse(draft({ priceCents: 2500 })),
      150,
    )

    // The suggestion survives the override, so a later rate change never
    // rewrites what was agreed.
    expect(pricing).toEqual({ postPriceCents: 150, suggestedPriceCents: 3000, priceCents: 2500 })
    expect(packagePriceIsOverridden({ ...pricing })).toBe(true)
  })

  it('uses a rate negotiated for this organization over the platform default', () => {
    const pricing = resolvePackagePricing(
      customPackageDraftSchema.parse(draft({ postPriceCents: 120 })),
      150,
    )

    // The package records the rate it was agreed at, so a later platform change
    // never re-derives a different suggestion for it.
    expect(pricing).toEqual({ postPriceCents: 120, suggestedPriceCents: 2400, priceCents: 2400 })
  })

  it('treats a free package as a deliberate agreement, not a missing price', () => {
    const pricing = resolvePackagePricing(
      customPackageDraftSchema.parse(draft({ priceCents: 0 })),
      150,
    )

    expect(pricing.priceCents).toBe(0)
    expect(packagePriceIsOverridden({ ...pricing })).toBe(true)
  })
})

describe('custom package period and status', () => {
  it('is in force only while an active package is inside its period', () => {
    const pkg = customPackageFromRow(row())

    expect(packageIsInForce(pkg, new Date('2026-10-15T00:00:00.000Z'))).toBe(true)
    expect(packageIsInForce(pkg, new Date('2026-09-30T23:59:59.000Z'))).toBe(false)
    // The end is exclusive, so the package stops the instant the period closes.
    expect(packageIsInForce(pkg, new Date('2026-11-01T00:00:00.000Z'))).toBe(false)
  })

  it('never puts a draft or cancelled package in force', () => {
    for (const status of ['draft', 'cancelled', 'expired'] as const) {
      const pkg = customPackageFromRow(row({ status }))
      expect(packageIsInForce(pkg, new Date('2026-10-15T00:00:00.000Z'))).toBe(false)
    }
  })

  it('reports an active package that has outrun its period', () => {
    const pkg = customPackageFromRow(row())

    expect(outgrownPackageStatus(pkg, new Date('2026-10-15T00:00:00.000Z'))).toBeNull()
    expect(outgrownPackageStatus(pkg, new Date('2026-11-02T00:00:00.000Z'))).toBe('expired')
    // A cancelled package stays cancelled; expiry must not overwrite a decision.
    expect(
      outgrownPackageStatus(
        customPackageFromRow(row({ status: 'cancelled' })),
        new Date('2026-11-02T00:00:00.000Z'),
      ),
    ).toBeNull()
  })
})

describe('custom package expiry', () => {
  it('delegates expiry to the audited database transition with a stable clock', async () => {
    const now = new Date('2026-08-25T00:00:00.000Z')
    const query = vi.fn(async () => ({ rows: [{ expired: 2 }] }))

    await expect(expireCustomPackages({ query } as never, now)).resolves.toBe(2)
    expect(query).toHaveBeenCalledWith('SELECT app.expire_custom_packages($1) AS expired', [now])
  })
})

describe('custom package schema', () => {
  it('maps a database row onto the shared schema', () => {
    const pkg = customPackageFromRow(row())

    expect(pkg).toMatchObject({
      id: packageId,
      organizationId,
      postsIncluded: 20,
      postPriceCents: 150,
      priceCents: 2800,
      suggestedPriceCents: 3000,
      currency: 'EUR',
      status: 'active',
      notes: null,
    })
    expect(pkg.startsAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rejects a package whose period ends before it starts', () => {
    expect(() =>
      customPackageSchema.parse({
        ...customPackageFromRow(row()),
        endsAt: '2026-09-01T00:00:00.000Z',
      }),
    ).toThrow()
    expect(() =>
      customPackageDraftSchema.parse(draft({ endsAt: '2026-09-01T00:00:00.000Z' })),
    ).toThrow()
  })

  it('rejects a post count outside the supported range', () => {
    expect(() => customPackageDraftSchema.parse(draft({ postsIncluded: 0 }))).toThrow()
    expect(() => customPackageDraftSchema.parse(draft({ postsIncluded: 1001 }))).toThrow()
  })

  it('rejects an unknown status', () => {
    expect(() => customPackageDraftSchema.parse(draft({ status: 'paused' }))).toThrow()
  })
})

describe('admin custom package request schemas', () => {
  it('accepts a package without a price, leaving the suggestion to the database', () => {
    const parsed = customPackageCreateSchema.parse({
      name: 'Paketa e negociuar',
      posts_included: 20,
      starts_at: '2026-10-01T00:00:00.000Z',
      ends_at: '2026-11-01T00:00:00.000Z',
      status: 'draft',
    })

    expect(parsed.price_cents).toBeUndefined()
  })

  it('refuses a suggested price supplied by the caller', () => {
    expect(() =>
      customPackageCreateSchema.parse({
        name: 'Paketa e negociuar',
        posts_included: 20,
        suggested_price_cents: 1,
        starts_at: '2026-10-01T00:00:00.000Z',
        ends_at: '2026-11-01T00:00:00.000Z',
        status: 'draft',
      }),
    ).toThrow()
  })

  it('refuses a period that ends before it starts', () => {
    expect(() =>
      customPackageCreateSchema.parse({
        name: 'Paketa e negociuar',
        posts_included: 20,
        starts_at: '2026-11-01T00:00:00.000Z',
        ends_at: '2026-10-01T00:00:00.000Z',
        status: 'draft',
      }),
    ).toThrow()
    expect(() =>
      customPackageChangesSchema.parse({
        starts_at: '2026-11-01T00:00:00.000Z',
        ends_at: '2026-10-01T00:00:00.000Z',
      }),
    ).toThrow()
  })

  it('refuses an empty change, which would write an audit row for nothing', () => {
    expect(() => customPackageChangesSchema.parse({})).toThrow()
    expect(customPackageChangesSchema.parse({ status: 'cancelled' }).status).toBe('cancelled')
  })

  it('maps database failures onto stable client responses', () => {
    expect(customPackageFailure('PACKAGE_ACTIVE_EXISTS')).toMatchObject({
      statusCode: 409,
      code: 'PACKAGE_ACTIVE_EXISTS',
    })
    expect(customPackageFailure('PACKAGE_NOT_FOUND')?.statusCode).toBe(404)
    // An unmapped database error must not be reported as a client mistake.
    expect(customPackageFailure('some unexpected postgres error')).toBeNull()
  })
})
