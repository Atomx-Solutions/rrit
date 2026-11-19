import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'
import { customPackageStatusSchema } from '../../shared/schemas/custom-package'

const cents = z.number().int().min(0).max(100_000_000)
const isoDate = z.string().datetime({ offset: true })

// suggested_price_cents is always derived in the database from the rate and the
// post count, so the superadmin never supplies it. The rate itself may be
// negotiated per organization; an omitted rate takes the platform default.
export const customPackageCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    // A credit top-up carries no posts, a video package carries no posts
    // either, and a post package carries no credits of its own beyond what its
    // posts fund. Each may be zero; all three may not.
    posts_included: z.number().int().min(0).max(1000),
    videos_included: z.number().int().min(0).max(1000).optional(),
    credits_included: z.number().int().min(0).max(10_000_000).optional(),
    post_price_cents: z.number().int().min(1).max(1_000_000).optional(),
    video_price_cents: z.number().int().min(0).max(1_000_000).optional(),
    // A proposal must never be sent with a zero total. The UI also waits for
    // pricing settings, but this protects the API from stale or crafted input.
    price_cents: z.number().int().min(1).max(100_000_000).optional(),
    starts_at: isoDate,
    ends_at: isoDate,
    status: customPackageStatusSchema,
    package_request_id: z.uuid().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Whatever the client receives is invoiced unless it is marked as a gift,
    // which needs a reason and is listed in Billing instead of the revenue.
    gift: z.boolean().optional(),
    gift_reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(value => !value.gift || !!value.gift_reason, { message: 'server.GIFT_REASON_REQUIRED', path: ['gift_reason'] })
  .refine((value) => Date.parse(value.ends_at) > Date.parse(value.starts_at), {
    message: 'server.ENDS_AT_AFTER_STARTS_AT',
    path: ['ends_at'],
  })
  .refine(
    (value) =>
      value.posts_included > 0
      || (value.videos_included || 0) > 0
      || (value.credits_included || 0) > 0,
    { message: 'server.PACKAGE_MUST_INCLUDE_ITEMS', path: ['posts_included'] },
  )

export const customPackageChangesSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    posts_included: z.number().int().min(0).max(1000).optional(),
    videos_included: z.number().int().min(0).max(1000).optional(),
    credits_included: z.number().int().min(0).max(10_000_000).optional(),
    // Unlike credits_included (the package's total), this is an explicit
    // increment for an already active package.
    credit_top_up: z.number().int().min(1).max(10_000_000).optional(),
    post_price_cents: z.number().int().min(1).max(1_000_000).optional(),
    video_price_cents: z.number().int().min(0).max(1_000_000).optional(),
    price_cents: cents.optional(),
    starts_at: isoDate.optional(),
    ends_at: isoDate.optional(),
    status: customPackageStatusSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Whatever the client receives is invoiced unless it is marked as a gift,
    // which needs a reason and is listed in Billing instead of the revenue.
    gift: z.boolean().optional(),
    gift_reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(value => !value.gift || !!value.gift_reason, { message: 'server.GIFT_REASON_REQUIRED', path: ['gift_reason'] })
  // An empty body is not a change; rejecting it keeps the audit trail honest.
  .refine((value) => Object.keys(value).length > 0)
  .refine(
    (value) =>
      !value.starts_at || !value.ends_at || Date.parse(value.ends_at) > Date.parse(value.starts_at),
    { message: 'server.ENDS_AT_AFTER_STARTS_AT', path: ['ends_at'] },
  )

// Posts, videos and credits added to the running package, paid or as a gift.
export const packageAdditionSchema = z
  .object({
    posts: z.number().int().min(0).max(1000).default(0),
    videos: z.number().int().min(0).max(1000).default(0),
    credits: z.number().int().min(0).max(10_000_000).default(0),
    // The agreed price of the addition; omitted, the package's own rates apply.
    price_cents: z.number().int().min(1).max(100_000_000).optional(),
    gift: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(value => value.posts + value.videos + value.credits > 0, { message: 'server.ADDITION_EMPTY', path: ['posts'] })
  .refine(value => !value.gift || !!value.reason, { message: 'server.GIFT_REASON_REQUIRED', path: ['reason'] })

const failures: Record<string, { statusCode: number; message: string }> = {
  ORGANIZATION_NOT_FOUND: { statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' },
  PACKAGE_NOT_FOUND: { statusCode: 404, message: 'server.PACKAGE_NOT_FOUND' },
  PACKAGE_INVALID: { statusCode: 400, message: 'server.PACKAGE_VALUES_INVALID' },
  PACKAGE_ACTIVE_EXISTS: {
    statusCode: 409,
    message: 'server.ORGANIZATION_HAS_ACTIVE_PACKAGE',
  },
  // Closing the organization ended this package; reopening it never restores it.
  GIFT_REASON_REQUIRED: { statusCode: 400, message: 'server.GIFT_REASON_REQUIRED' },
  PACKAGE_NOT_ACTIVE: { statusCode: 409, message: 'server.PACKAGE_NOT_ACTIVE' },
  ADDITION_EMPTY: { statusCode: 400, message: 'server.ADDITION_EMPTY' },
  ADDITION_PRICE_INVALID: { statusCode: 400, message: 'server.ADDITION_PRICE_INVALID' },
  PACKAGE_ENDED_BY_CLOSURE: { statusCode: 409, message: 'server.PACKAGE_ENDED_BY_CLOSURE' },
}

export function customPackageFailure(message: string | undefined) {
  const failure = message ? failures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    const failure = customPackageFailure(error.message)
    if (failure)
      throw createError({
        statusCode: failure.statusCode,
        message: failure.message,
        data: { code: failure.code },
      })
    console.error('Admin custom package call failed.', {
      name,
      code: error.code,
      message: error.message,
    })
    throw createError({ statusCode: 502, message: 'server.PACKAGE_NOT_SAVED' })
  }
  return data as Record<string, unknown>
}

export async function adminOrganizationPackages(organizationId: string) {
  const [listing, grants, documents] = await Promise.all([
    rpc('admin_organization_packages', { target_organization_id: organizationId }),
    // Every credit a package handed out: the credits its posts fund when it
    // starts, and every addition since. That is the package's credit total.
    adminServiceClient()
      .from('credit_ledger')
      .select('reference_id, credit_delta')
      .eq('organization_id', organizationId)
      .eq('event_type', 'grant')
      .eq('reference_type', 'custom_package'),
    // Which invoice or gift each addition produced, so it opens from the list.
    adminServiceClient()
      .from('package_additions')
      .select('id, invoice_id, gift_id')
      .eq('organization_id', organizationId),
  ])
  if (documents.error) {
    console.error('Admin package additions read failed.', { code: documents.error.code, message: documents.error.message })
    throw createError({ statusCode: 502, message: 'server.PACKAGE_NOT_SAVED' })
  }
  if (grants.error) {
    console.error('Admin package credit grants read failed.', { code: grants.error.code, message: grants.error.message })
    throw createError({ statusCode: 502, message: 'server.PACKAGE_NOT_SAVED' })
  }
  const granted = new Map<string, number>()
  for (const row of grants.data ?? [])
    granted.set(String(row.reference_id), (granted.get(String(row.reference_id)) ?? 0) + Number(row.credit_delta))
  const packages = Array.isArray(listing.packages) ? listing.packages as Array<Record<string, unknown>> : []
  return {
    ...listing,
    packages: packages.map(pkg => ({
      ...pkg,
      credits_granted: granted.get(String(pkg.id)) ?? 0,
      additions: (Array.isArray(pkg.additions) ? pkg.additions as Array<Record<string, unknown>> : []).map((addition) => {
        const document = (documents.data ?? []).find(row => row.id === addition.id)
        return { ...addition, invoice_id: document?.invoice_id ?? null, gift_id: document?.gift_id ?? null }
      }),
    })),
  }
}

export function createCustomPackage(
  organizationId: string,
  actor: { id: string; email: string },
  values: z.infer<typeof customPackageCreateSchema>,
) {
  return rpc('admin_create_custom_package', {
    p_organization_id: organizationId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_package: values,
  })
}

export function updateCustomPackage(
  packageId: string,
  actor: { id: string; email: string },
  changes: z.infer<typeof customPackageChangesSchema>,
) {
  return rpc('admin_update_custom_package', {
    p_package_id: packageId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_changes: changes,
  })
}

export function deleteCustomPackage(
  packageId: string,
  actor: { id: string; email: string },
) {
  return rpc('admin_delete_custom_package', {
    p_package_id: packageId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
}

export function addToPackage(
  packageId: string,
  actor: { id: string; email: string },
  addition: z.infer<typeof packageAdditionSchema>,
) {
  return rpc('admin_add_to_package', {
    p_package_id: packageId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_addition: addition,
  })
}
