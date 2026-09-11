import { z } from 'zod'

export const organizationRoleSchema = z.enum([
  'owner',
  'admin',
  'marketer',
  'approver',
  'analyst',
  'billing',
])

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine(
    (value) => [...value].every((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    }),
    'Invalid organization name',
  )

export const organizationSlugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid organization slug')

export const organizationCreateSchema = z.object({
  name: organizationNameSchema,
  slug: organizationSlugSchema,
})

export const organizationUpdateSchema = z
  .object({
    name: organizationNameSchema.optional(),
    slug: organizationSlugSchema.optional(),
    revision: z.number().int().min(0),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, 'No organization change')

export const organizationViewSchema = z.object({
  id: z.uuid(),
  name: organizationNameSchema,
  slug: organizationSlugSchema,
  revision: z.number().int().nonnegative(),
  role: organizationRoleSchema,
})

export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>
export type OrganizationRole = z.infer<typeof organizationRoleSchema>
export type OrganizationView = z.infer<typeof organizationViewSchema>
