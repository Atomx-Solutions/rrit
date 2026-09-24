import { z } from 'zod'

export const entitlementFeatureSchema = z.enum([
  'posts',
  'media',
  'validation',
  'social_import',
  'publishing',
  'ai',
])
export const planLimitsSchema = z.object({
  posts_per_month: z.number().int().nonnegative(),
  ai_requests_per_day: z.number().int().nonnegative(),
  media_storage_bytes: z.number().int().nonnegative(),
  social_accounts: z.number().int().nonnegative(),
  members: z.number().int().positive(),
})
export const trialPolicySchema = z.object({
  duration_hours: z.number().int().min(1).max(720),
  features: z.array(entitlementFeatureSchema).min(1),
  device_retention_days: z.number().int().positive(),
  limits: planLimitsSchema,
})
export const planCatalogSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  monthlyCents: z.number().int().nonnegative(),
  currency: z.literal('EUR'),
  annualDiscount: z.number().int().min(0).max(100),
  // Presentation copy is localized by the client. The catalog only carries
  // configuration and entitlement data from the database.
  description: z.string(),
  displayFeatures: z.array(z.string()),
  entitlements: z.array(entitlementFeatureSchema),
  limits: planLimitsSchema,
  purchasable: z.boolean(),
})
export type PlanCatalogPlan = z.infer<typeof planCatalogSchema> & {
  code: string
  isTrial: boolean
  monthlyCredits: number
  styleFetchPostCount: number
  price: number
  annualPrice: number
  features: string[]
}
export type PlanLimits = z.infer<typeof planLimitsSchema>
export type EntitlementFeature = z.infer<typeof entitlementFeatureSchema>
