import { z } from 'zod'

const supportedTimezones = new Set(
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
)

export function isIanaTimezone(value: string) {
  if (value === 'UTC' || value === 'Etc/UTC') return true
  if (supportedTimezones.size) return supportedTimezones.has(value)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const ianaTimezoneSchema = z.string().trim().refine(isIanaTimezone, {
  message: 'Timezone duhet të jetë një IANA timezone valide.',
})

export const brandProfileSchema = z.object({
  description: z.string().max(2000).default(''),
  voice: z.string().max(1000).default(''),
  audience: z.string().max(1000).default(''),
  industry: z.string().max(200).default(''),
  city: z.string().max(120).default(''),
  color: z.string().max(30).default('#137d59'),
  facebookUrl: z.string().max(500).default(''),
  instagramUrl: z.string().max(500).default(''),
  facts: z.array(
    z.object({
      id: z.string().min(1).max(100),
      text: z.string().max(1000),
      source: z.string().max(500),
      verified: z.boolean(),
    }),
  ).max(100).default([]),
})

export const brandSettingsSchema = z.object({
  emailApprovals: z.boolean().default(true),
  emailPublished: z.boolean().default(true),
  emailTips: z.boolean().default(false),
})

export const brandCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  profile: brandProfileSchema.default({
    description: '',
    voice: '',
    audience: '',
    industry: '',
    city: '',
    color: '#137d59',
    facebookUrl: '',
    instagramUrl: '',
    facts: [],
  }),
  settings: brandSettingsSchema.default({
    emailApprovals: true,
    emailPublished: true,
    emailTips: false,
  }),
  timezone: ianaTimezoneSchema,
  locale: z.string().trim().min(2).max(35),
  category: z.string().trim().min(2).max(100),
})

export const brandUpdateSchema = brandCreateSchema.partial().extend({
  status: z.literal('active').optional(),
})

export const brandResponseSchema = brandCreateSchema.extend({
  id: z.uuid(),
  organizationId: z.uuid(),
  status: z.enum(['active', 'archived']),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Brand = z.infer<typeof brandResponseSchema>
export type BrandCreate = z.infer<typeof brandCreateSchema>
export type BrandUpdate = z.infer<typeof brandUpdateSchema>
