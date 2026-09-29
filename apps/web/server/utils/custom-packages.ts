import {
  customPackageSchema,
  type CustomPackage,
  type CustomPackageDraft,
  type CustomPackageStatus,
} from '../../shared/schemas/custom-package'
import { withTenantTransaction, type TenantContext } from './database'

/**
 * Price suggested for a package of this size. The per-post rate is a commercial
 * setting read from platform_settings, never a constant in this file: the
 * superadmin changes it without a deployment, and a package already agreed
 * keeps the suggestion it was written with.
 */
export function suggestedPackagePriceCents(postsIncluded: number, postPriceCents: number) {
  if (!Number.isInteger(postsIncluded) || postsIncluded <= 0)
    throw new PackageInputError('POSTS_INCLUDED_INVALID')
  if (!Number.isInteger(postPriceCents) || postPriceCents <= 0)
    throw new PackageInputError('POST_PRICE_INVALID')
  return postsIncluded * postPriceCents
}

export class PackageInputError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

/**
 * Whether an agreed price departs from the suggestion. The superadmin may
 * override freely; recording that the override happened is what matters.
 */
export function packagePriceIsOverridden(
  pkg: Pick<CustomPackage, 'priceCents' | 'suggestedPriceCents'>,
) {
  return pkg.priceCents !== pkg.suggestedPriceCents
}

/**
 * Whether a package is the one in force at this instant. Status alone is not
 * enough: an active package outside its period is a package whose expiry has
 * not been written yet.
 */
export function packageIsInForce(
  pkg: Pick<CustomPackage, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
) {
  if (pkg.status !== 'active') return false
  const instant = now.getTime()
  return Date.parse(pkg.startsAt) <= instant && instant < Date.parse(pkg.endsAt)
}

/**
 * The status a stored package has outgrown, or null when the stored status
 * still describes it. Kept separate from persistence so the caller decides when
 * to write, and so an expiry never surprises a package the superadmin cancelled.
 */
export function outgrownPackageStatus(
  pkg: Pick<CustomPackage, 'status' | 'endsAt'>,
  now: Date,
): CustomPackageStatus | null {
  if (pkg.status !== 'active') return null
  return Date.parse(pkg.endsAt) <= now.getTime() ? 'expired' : null
}

type CustomPackageRow = {
  id: string
  organization_id: string
  name: string
  posts_included: number
  post_price_cents: number
  price_cents: number
  suggested_price_cents: number
  currency: 'EUR'
  starts_at: Date
  ends_at: Date
  status: CustomPackageStatus
  notes: string | null
}

export function customPackageFromRow(row: CustomPackageRow): CustomPackage {
  return customPackageSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    postsIncluded: row.posts_included,
    postPriceCents: row.post_price_cents,
    priceCents: row.price_cents,
    suggestedPriceCents: row.suggested_price_cents,
    currency: row.currency,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    notes: row.notes,
  })
}

/**
 * Resolves a draft into the row values to persist. The suggestion is always
 * computed, so an override is stored next to what it replaced rather than
 * instead of it.
 */
export function resolvePackagePricing(draft: CustomPackageDraft, defaultPostPriceCents: number) {
  // The draft may carry a rate negotiated for this organization; otherwise the
  // platform default applies.
  const postPriceCents = draft.postPriceCents ?? defaultPostPriceCents
  const suggestedPriceCents = suggestedPackagePriceCents(draft.postsIncluded, postPriceCents)
  return {
    postPriceCents,
    suggestedPriceCents,
    priceCents: draft.priceCents ?? suggestedPriceCents,
  }
}

/**
 * The organization's own packages. Tenant context is set first, so the row
 * level policy — not this query — is what keeps one organization out of
 * another's packages.
 */
export async function organizationCustomPackages(tenant: TenantContext) {
  return await withTenantTransaction(tenant, async (client) => {
    const result = await client.query<CustomPackageRow>(
      `SELECT id, organization_id, name, posts_included, post_price_cents, price_cents, suggested_price_cents,
              currency, starts_at, ends_at, status, notes
       FROM custom_packages
       ORDER BY ends_at DESC, id DESC`,
    )
    return result.rows.map(customPackageFromRow)
  })
}
