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
    posts_included: z.number().int().min(1).max(1000),
    post_price_cents: z.number().int().min(1).max(1_000_000).optional(),
    price_cents: cents.optional(),
    starts_at: isoDate,
    ends_at: isoDate,
    status: customPackageStatusSchema,
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.ends_at) > Date.parse(value.starts_at), {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  })

export const customPackageChangesSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    posts_included: z.number().int().min(1).max(1000).optional(),
    post_price_cents: z.number().int().min(1).max(1_000_000).optional(),
    price_cents: cents.optional(),
    starts_at: isoDate.optional(),
    ends_at: isoDate.optional(),
    status: customPackageStatusSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  // An empty body is not a change; rejecting it keeps the audit trail honest.
  .refine((value) => Object.keys(value).length > 0)
  .refine(
    (value) =>
      !value.starts_at || !value.ends_at || Date.parse(value.ends_at) > Date.parse(value.starts_at),
    { message: 'ends_at must be after starts_at', path: ['ends_at'] },
  )

const failures: Record<string, { statusCode: number; message: string }> = {
  ORGANIZATION_NOT_FOUND: { statusCode: 404, message: 'Organizata nuk u gjet.' },
  PACKAGE_NOT_FOUND: { statusCode: 404, message: 'Paketa nuk u gjet.' },
  PACKAGE_INVALID: { statusCode: 400, message: 'Vlerat e paketës nuk janë të vlefshme.' },
  PACKAGE_ACTIVE_EXISTS: {
    statusCode: 409,
    message: 'Kjo organizatë ka tashmë një paketë aktive.',
  },
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
    throw createError({ statusCode: 502, message: 'Paketa nuk u ruajt.' })
  }
  return data as Record<string, unknown>
}

export function adminOrganizationPackages(organizationId: string) {
  return rpc('admin_organization_packages', { target_organization_id: organizationId })
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
