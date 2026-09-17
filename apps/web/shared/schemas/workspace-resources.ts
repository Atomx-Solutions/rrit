import { z } from 'zod'
import { brandResponseSchema, brandUpdateSchema, ianaTimezoneSchema } from './brand'
import { postSchema, workspaceSchema } from './workspace'

// Tokens are the last observed versions, not the next versions to persist.
// Workspace revision zero is valid for a newly created business.
// Comparing tokens and authorizing tenant access belong to the resource services.
export const workspaceRevisionSchema = z.number().int().min(0).max(2147483647)
export const postVersionSchema = z.number().int().min(1).max(2147483647)
export const brandRevisionSchema = z.number().int().min(1).max(2147483647)

const queryInteger = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .pipe(z.coerce.number<string | number>().int())

export const paginationQuerySchema = z.strictObject({
  page: queryInteger.pipe(z.number().int().min(1).max(100000)).default(1),
  pageSize: queryInteger.pipe(z.number().int().min(1).max(50)).default(20),
})

export const workspacePostListQuerySchema = paginationQuerySchema
  .extend({
    status: postSchema.shape.status.optional(),
    channel: postSchema.shape.channel.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to), {
    message: 'The post interval must end on or after it starts.',
    path: ['to'],
  })

const queryBoolean = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
])

export const workspaceAssetListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  rights: queryBoolean.optional(),
})

export function paginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .strictObject({
      items: z.array(itemSchema).max(50),
      page: z.number().int().min(1).max(100000),
      pageSize: z.number().int().min(1).max(50),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
    })
    .refine((page) => page.items.length <= page.pageSize, {
      message: 'Items exceed the requested page size.',
      path: ['items'],
    })
}

const postEditableFieldsSchema = postSchema
  .pick({
    title: true,
    caption: true,
    channel: true,
    format: true,
    image: true,
    pillar: true,
  })
  .extend({
    caption: postSchema.shape.caption.refine((value) => value.trim().length > 0),
    // The upload endpoint returns a media URL; ownership/rights are checked server-side.
    image: z
      .string()
      .refine(
        (value) =>
          value.startsWith('/api/media/') &&
          z.uuid().safeParse(value.slice('/api/media/'.length)).success,
      ),
  })
  .strict()

// The server assigns ID, draft status, versions, history and validation results.
export const postCreateSchema = postEditableFieldsSchema.extend({
  workspaceRevision: workspaceRevisionSchema,
})

export const postUpdateSchema = postEditableFieldsSchema
  .partial()
  .extend({
    workspaceRevision: workspaceRevisionSchema,
    postVersion: postVersionSchema,
    status: z.enum(['draft', 'review', 'approved', 'scheduled']).optional(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
    publicationMode: z.enum(['manual', 'automatic']).optional(),
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) =>
          key !== 'workspaceRevision' && key !== 'postVersion' && value !== undefined,
      ),
    {
      message: 'Provide at least one post change.',
    },
  )

export const workspacePreferencesSchema = workspaceSchema.shape.preferences.extend({
  name: z.string().trim().min(2).max(100),
  email: z.email(),
  timezone: ianaTimezoneSchema,
  locale: z.enum(['sq-XK', 'en-US']),
  currency: z.literal('EUR'),
})

// Partial updates must not insert defaults for preferences omitted by the caller.
export const preferencesUpdateSchema = workspacePreferencesSchema
  .partial()
  .extend({
    workspaceRevision: workspaceRevisionSchema,
    brandRevision: brandRevisionSchema,
  })
  .strict()
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) =>
          key !== 'workspaceRevision' && key !== 'brandRevision' && value !== undefined,
      ),
    {
      message: 'Provide at least one preference change.',
    },
  )

export const workspacePreferencesResponseSchema = z.strictObject({
  preferences: workspacePreferencesSchema,
  workspaceRevision: workspaceRevisionSchema,
  brandRevision: brandRevisionSchema,
})

export const workspaceBootstrapSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().min(1).max(100),
  revision: workspaceRevisionSchema,
  brand: brandResponseSchema.nullable(),
  preferences: workspaceSchema.shape.preferences,
  onboarding: workspaceSchema.shape.onboarding,
  dismissed: workspaceSchema.shape.dismissed,
  notificationsRead: workspaceSchema.shape.notificationsRead,
  postCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  capabilities: z.strictObject({
    posts: z.boolean(),
    assets: z.boolean(),
    brand: z.boolean(),
    preferences: z.boolean(),
  }),
})

const assetMetadataSchema = z.strictObject({
  name: z.string().trim().min(1).max(250),
  tags: z.array(z.string().max(100)).max(20),
  rights: z.boolean(),
})

// Metadata only, after multipart decoding. File bytes, MIME and size validation
// stay in the upload handler; no storage path or binary data is accepted here.
export const assetUploadMetadataSchema = assetMetadataSchema.extend({
  workspaceRevision: workspaceRevisionSchema,
  rights: z.literal(true),
})

export const assetMetadataUpdateSchema = assetMetadataSchema
  .partial()
  .extend({
    workspaceRevision: workspaceRevisionSchema,
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'workspaceRevision' && value !== undefined,
      ),
    {
      message: 'Provide at least one asset metadata change.',
    },
  )

export const assetDeleteSchema = z.strictObject({
  workspaceRevision: workspaceRevisionSchema,
})

export const workspaceMetadataUpdateSchema = z
  .strictObject({
    revision: workspaceRevisionSchema,
    onboarding: workspaceSchema.shape.onboarding.int().optional(),
    dismissed: workspaceSchema.shape.dismissed.optional(),
    notificationsRead: workspaceSchema.shape.notificationsRead.optional(),
  })
  .refine(
    (input) =>
      Object.entries(input).some(([key, value]) => key !== 'revision' && value !== undefined),
    {
      message: 'Provide at least one workspace metadata change.',
    },
  )

export const workspaceOnboardingUpdateSchema = z.strictObject({
  workspaceRevision: workspaceRevisionSchema,
  brandRevision: brandRevisionSchema,
  brand: brandUpdateSchema.omit({ revision: true }).strict(),
  preferences: workspacePreferencesSchema.partial().strict(),
  metadata: z.strictObject({
    onboarding: workspaceSchema.shape.onboarding.int().optional(),
    dismissed: workspaceSchema.shape.dismissed.optional(),
    notificationsRead: workspaceSchema.shape.notificationsRead.optional(),
  }),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>
export type WorkspacePostListQuery = z.infer<typeof workspacePostListQuerySchema>
export type WorkspaceAssetListQuery = z.infer<typeof workspaceAssetListQuerySchema>
export type PaginatedResponse<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  hasNext: boolean
}
export type PostCreate = z.infer<typeof postCreateSchema>
export type PostUpdate = z.infer<typeof postUpdateSchema>
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>
export type WorkspacePreferencesResponse = z.infer<typeof workspacePreferencesResponseSchema>
export type WorkspaceBootstrap = z.infer<typeof workspaceBootstrapSchema>
export type AssetUploadMetadata = z.infer<typeof assetUploadMetadataSchema>
export type AssetMetadataUpdate = z.infer<typeof assetMetadataUpdateSchema>
export type AssetDelete = z.infer<typeof assetDeleteSchema>
export type WorkspaceMetadataUpdate = z.infer<typeof workspaceMetadataUpdateSchema>
export type WorkspaceOnboardingUpdate = z.infer<typeof workspaceOnboardingUpdateSchema>
