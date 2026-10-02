import { z } from 'zod'
import { monthlyPostProvenanceSchema } from './monthly-plan'
import { brandFactSchema } from './business-brain'

const researchSourceSchema = z
  .url()
  .max(500)
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  })

// Which kinds of dated context the monthly research may look for. These are
// the business's own permissions, not application categories applied to it: a
// business that does not want its content tied to public holidays simply never
// has them researched. Off by default, because a business that was generating
// without events must not silently start publishing holiday posts.
export const eventResearchCategoriesSchema = z.object({
  // National, local, religious and cultural occasions.
  publicEvents: z.boolean().default(true),
  // Seasons and recurring commercial periods such as the end of year.
  seasonalEvents: z.boolean().default(true),
  // Industry occasions and local trends.
  industryTrends: z.boolean().default(true),
})
export const eventResearchSchema = z.object({
  enabled: z.boolean().default(false),
  categories: eventResearchCategoriesSchema.default({
    publicEvents: true,
    seasonalEvents: true,
    industryTrends: true,
  }),
})
export type EventResearch = z.infer<typeof eventResearchSchema>
export const eventResearchCategoryKeys = ['publicEvents', 'seasonalEvents', 'industryTrends'] as const
export type EventResearchCategory = (typeof eventResearchCategoryKeys)[number]
// The permission is read once, when the research stage runs. An empty list is
// the same answer as a disabled switch: there is nothing to look for.
export function permittedEventCategories(events: EventResearch | undefined) {
  if (!events?.enabled) return []
  return eventResearchCategoryKeys.filter((key) => events.categories[key])
}

export const postSchema = z.object({
  id: z.string(),
  title: z.string().min(3).max(120),
  caption: z.string().max(2200),
  status: z.enum(['draft', 'review', 'approved', 'scheduled', 'published', 'failed']),
  channel: z.enum(['Instagram', 'Facebook']),
  format: z.enum(['static', 'carousel']),
  image: z.string(),
  pillar: z.string(),
  scheduledAt: z.string().nullable(),
  createdAt: z.iso.datetime().optional(),
  proposedAt: z.iso.datetime().optional(),
  aiProvenance: monthlyPostProvenanceSchema.optional(),
  publicationMode: z.enum(['manual', 'automatic']).optional(),
  version: z.number().int().positive(),
  contentVersion: z.number().int().positive().optional(),
  history: z.array(z.object({ version: z.number(), caption: z.string(), at: z.string() })),
  policy: z.enum(['pass', 'warn', 'block']),
  policyReason: z.string(),
  campaignId: z.string().optional(),
  providerPostId: z.string().optional(),
  publishedAt: z.string().optional(),
})
export const campaignSchema = z.object({
  id: z.string(),
  title: z.string().min(3),
  objective: z.string().min(5),
  start: z.string(),
  end: z.string(),
  status: z.enum(['draft', 'active', 'completed']),
  target: z.number().min(1).max(100),
})
export const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  tags: z.array(z.string()),
  rights: z.boolean(),
  kind: z.enum(['photo', 'brand']),
  generated: z.boolean().optional(),
  size: z.number(),
})
export const strategySchema = z.object({
  version: z.number(),
  status: z.enum(['draft', 'active']),
  objective: z.string().min(10),
  audience: z.string().min(5),
  pillars: z.array(z.string()),
  cadence: z.number().min(1).max(14),
  updatedAt: z.string(),
})
export const workspaceSchema = z.object({
  revision: z.number(),
  brandRevision: z.number().int().min(0).default(0),
  brand: z.object({
    name: z.string().min(2),
    industry: z.string(),
    city: z.string(),
    description: z.string(),
    voice: z.string(),
    audience: z.string(),
    color: z.string(),
    facebookUrl: z.string().default(''),
    instagramUrl: z.string().default(''),
    goals: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
    status: z.enum(['active', 'archived']).default('active'),
    researchSources: z.array(researchSourceSchema).max(10).default([]),
    eventResearch: eventResearchSchema.default({
      enabled: false,
      categories: { publicEvents: true, seasonalEvents: true, industryTrends: true },
    }),
    facts: z.array(brandFactSchema),
    guardrails: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    brainVersion: z.number().int().nonnegative().optional(),
  }),
  posts: z.array(postSchema),
  assets: z.array(assetSchema),
  campaigns: z.array(campaignSchema),
  strategies: z.array(strategySchema),
  preferences: z.object({
    name: z.string(),
    email: z.string(),
    timezone: z.string(),
    locale: z.enum(['sq-XK', 'en-US']).default('sq-XK'),
    currency: z.enum(['ALL', 'EUR']).transform(() => 'EUR' as const),
  }),
  onboarding: z.number().min(0).max(4),
  onboardingSkipped: z.boolean().default(false),
  dismissed: z.array(z.string()),
  notificationsRead: z.boolean(),
})
export type Post = z.infer<typeof postSchema>
export type Asset = z.infer<typeof assetSchema>
export type Campaign = z.infer<typeof campaignSchema>
export type Workspace = z.infer<typeof workspaceSchema>
export type Strategy = z.infer<typeof strategySchema>

export function validateTransition(post: Post, next: Post['status']): string | null {
  const allowed: Record<Post['status'], Post['status'][]> = {
    draft: ['review'],
    review: ['approved', 'draft'],
    approved: ['scheduled', 'draft'],
    scheduled: ['approved'],
    published: [],
    failed: ['approved', 'draft'],
  }
  if (!allowed[post.status].includes(next)) return 'transition.invalid'
  if (['approved', 'scheduled'].includes(next) && post.policy === 'block')
    return post.policyReason || 'transition.policyBlocked'
  return null
}
