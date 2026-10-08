import { z } from 'zod'

/**
 * A custom package is a commercial agreement between the platform and one
 * organization. It sits beside the shared plan catalogue rather than inside it:
 * a plan is offered to every organization, a custom package exists for exactly
 * one and is negotiated per case.
 */
export const customPackageStatusSchema = z.enum(['draft', 'active', 'expired', 'cancelled'])
export type CustomPackageStatus = z.infer<typeof customPackageStatusSchema>

const customPackageFields = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  // A package may be sold for posts, for videos or for credits alone, so each
  // included amount is allowed to be zero on its own.
  postsIncluded: z.number().int().nonnegative().max(1000),
  videosIncluded: z.number().int().nonnegative().max(1000).default(0),
  // The rate this package was agreed at, which may differ from the platform
  // default offered when it was created.
  postPriceCents: z.number().int().positive().max(1_000_000),
  // What the superadmin agreed to charge. A zero price is a deliberate
  // goodwill package, not a missing value, so it stays valid.
  priceCents: z.number().int().nonnegative(),
  // What the configured per-post rate suggested when the package was written.
  suggestedPriceCents: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: customPackageStatusSchema,
  notes: z.string().max(2000).nullable(),
})

// One period rule, applied to every shape a package takes.
const endsAfterStart = (value: { startsAt: string; endsAt: string }) =>
  Date.parse(value.endsAt) > Date.parse(value.startsAt)
const endsAfterStartError = { message: 'endsAt must be after startsAt', path: ['endsAt'] }
// A draft is what a superadmin is writing now, and writing a package that
// includes nothing is a mistake. Stored rows are left alone by this rule: a
// credits-only package was legitimately saved with no posts and no videos.
const draftIncludesSomething = (value: { postsIncluded: number; videosIncluded?: number }) =>
  value.postsIncluded > 0 || (value.videosIncluded ?? 0) > 0
const draftIncludesSomethingError = {
  message: 'a package draft must include posts or videos',
  path: ['postsIncluded'],
}

export const customPackageSchema = customPackageFields.refine(endsAfterStart, endsAfterStartError)
export type CustomPackage = z.infer<typeof customPackageSchema>

/** The fields a superadmin supplies; the derived ones are computed server-side. */
export const customPackageDraftSchema = customPackageFields
  .pick({
    organizationId: true,
    name: true,
    postsIncluded: true,
    videosIncluded: true,
    startsAt: true,
    endsAt: true,
    status: true,
  })
  .extend({
    // Omitted means "use the platform default rate".
    postPriceCents: z.number().int().positive().max(1_000_000).optional(),
    // Omitted means "accept the suggestion"; a number is a deliberate override.
    priceCents: z.number().int().nonnegative().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(endsAfterStart, endsAfterStartError)
  .refine(draftIncludesSomething, draftIncludesSomethingError)
export type CustomPackageDraft = z.infer<typeof customPackageDraftSchema>
