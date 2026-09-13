import { z } from 'zod'

export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
export const researchSourceSchema = z.object({
  url: z.url().refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)),
  title: z.string().max(500),
})
export const researchSchema = z.object({
  text: z.string().min(1).max(30000),
  sources: z.array(researchSourceSchema).min(1).max(100),
  citations: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        url: researchSourceSchema.shape.url,
        title: z.string().max(500),
      }),
    )
    .max(200),
  researchedAt: z.iso.datetime(),
})
export const contentIntentSchema = z.enum([
  'educate',
  'inspire',
  'trust',
  'conversation',
  'product',
  'behind_the_scenes',
  'local_relevance',
  'conversion',
])
// Free-form art direction generated from the research and the actual source
// photograph. It is intentionally not a list of application-owned templates.
export const plannedCreativeLayoutSchema = z.string().trim().min(1).max(600)
export const algorithmGoalSchema = z.enum([
  'watch_time',
  'saves',
  'shares',
  'meaningful_comments',
  'profile_actions',
  'clicks',
])
export const slotBriefSchema = z.object({
  day: z.number().int().min(1).max(31),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  channel: z.enum(['Facebook', 'Instagram']),
  topic: z.string().min(5).max(200),
  pillar: z.string().min(2).max(80),
  intent: contentIntentSchema,
  hook: z.string().min(5).max(180),
  purpose: z.string().min(10).max(600),
  assetDirection: z.string().min(10).max(400),
  visualLayout: plannedCreativeLayoutSchema,
  algorithmGoal: algorithmGoalSchema,
  platformRationale: z.string().min(15).max(500),
  timingRationale: z.string().min(15).max(500),
  factIds: z.array(z.string()).min(1).max(12),
  sourceUrls: z.array(researchSourceSchema.shape.url).min(1).max(5),
  requiredAssetId: z.uuid().nullable(),
})
export const editorialPlanSchema = z.object({
  objective: z.string().min(10).max(1500),
  audience: z.string().min(5).max(1000),
  rationale: z.string().min(10).max(2000),
  slots: z.array(slotBriefSchema).min(1).max(100),
})
export const creativeSchema = z.object({
  headline: z.string().trim().min(3).max(64),
  eyebrow: z.string().trim().min(2).max(48),
  cta: z.string().trim().min(2).max(32),
  // Describes the model's unique composition; it never selects a coded preset.
  layout: z.string().trim().min(1).max(600),
})
export const generatedPostSchema = z.object({
  title: z.string().trim().min(3).max(120),
  caption: z.string().trim().min(10).max(2200),
  hashtags: z
    .array(z.string().regex(/^#[\p{L}\p{N}_]{2,50}$/u))
    .min(2)
    .max(8),
  assetId: z.uuid(),
  assetReason: z.string().min(10).max(600),
  factIds: z.array(z.string()).min(1).max(12),
  creative: creativeSchema,
  reasoning: z.object({
    concept: z.string().min(20).max(800),
    copy: z.string().min(20).max(800),
    design: z.string().min(20).max(800),
    hashtags: z.string().min(20).max(800),
  }),
})
export const qualitySchema = z.object({
  decision: z.enum(['PASS', 'WARN', 'BLOCK']),
  reasons: z.array(z.string().min(1).max(500)).max(10),
  factuality: z.boolean(),
  brandFit: z.boolean(),
  visualQuality: z.boolean(),
})
export const monthlyPostProvenanceSchema = z.object({
  planId: z.uuid(),
  slot: z.number().int().nonnegative(),
  evidenceHash: z.string(),
  factIds: z.array(z.string()),
  sourceUrls: z.array(researchSourceSchema.shape.url),
  rationale: z.string(),
  hashtags: z.array(z.string()).max(8).optional(),
  reasoning: z
    .object({
      concept: z.string(),
      copy: z.string(),
      design: z.string(),
      hashtags: z.string(),
      photo: z.string(),
      platform: z.string(),
      timing: z.string(),
    })
    .optional(),
  assetId: z.uuid(),
  creative: creativeSchema,
  imageGeneration: z
    .object({
      model: z.string().min(1).max(200),
      quality: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  revision: z
    .object({
      instruction: z.string().min(5).max(1200),
      sourceAssetId: z.uuid(),
      createdAt: z.iso.datetime(),
    })
    .optional(),
  quality: qualitySchema,
  promptVersion: z.string(),
})
export type SlotBrief = z.infer<typeof slotBriefSchema>
export type Research = z.infer<typeof researchSchema>
export type Creative = z.infer<typeof creativeSchema>
export type PlannedCreativeLayout = z.infer<typeof plannedCreativeLayoutSchema>
