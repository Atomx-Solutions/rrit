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
// photograph. It is intentionally unique to the post and business context.
export const plannedCreativeLayoutSchema = z.string().trim().min(1).max(600)
export const algorithmGoalSchema = z.enum([
  'watch_time',
  'saves',
  'shares',
  'meaningful_comments',
  'profile_actions',
  'clicks',
])
export const timingBasisSchema = z.enum(['social_history', 'platform_history', 'no_data'])
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
  timingBasis: timingBasisSchema.default('no_data'),
  factIds: z.array(z.string()).min(1).max(12),
  sourceUrls: z.array(researchSourceSchema.shape.url).min(1).max(5),
  requiredAssetId: z.uuid().nullable(),
  // References into the business's own Business Brain rows, not application
  // categories. Optional here so plans snapshotted before Business Brain
  // reached generation still parse and finish.
  audienceId: z.uuid().nullable().default(null),
  offerId: z.uuid().nullable().default(null),
})
export const styleProfileSchema = z.object({
  palette: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  contrast: z.string().trim().max(500).optional(),
  typography: z.string().trim().max(500).optional(),
  hierarchy: z.string().trim().max(500).optional(),
  density: z.string().trim().max(500).optional(),
  spacing: z.string().trim().max(500).optional(),
  photography: z.string().trim().max(500).optional(),
  composition: z.string().trim().max(500).optional(),
  brandElements: z.string().trim().max(500).optional(),
  tone: z.string().trim().max(500).optional(),
  doNotUse: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
})
// OpenAI-compatible structured outputs require every object property to be
// listed as required. Keep the persisted schema permissive for older plans,
// but use a strict variant when requesting a new editorial plan.
export const styleProfileGenerationSchema = styleProfileSchema.required()
export const editorialPlanSchema = z.object({
  objective: z.string().min(10).max(1500),
  audience: z.string().min(5).max(1000),
  rationale: z.string().min(10).max(2000),
  slots: z.array(slotBriefSchema).min(1).max(100),
  // Generated from the connected page history and current application brand
  // controls; this is a dynamic style contract, not a hard-coded template.
  styleProfile: styleProfileSchema.optional(),
})
// Structured outputs require every property to be present, so the requested
// slot repeats the Business Brain references as required-but-nullable.
export const slotBriefGenerationSchema = slotBriefSchema.extend({
  audienceId: z.uuid().nullable(),
  offerId: z.uuid().nullable(),
})
export const editorialPlanGenerationSchema = editorialPlanSchema.extend({
  styleProfile: styleProfileGenerationSchema,
  slots: z.array(slotBriefGenerationSchema).min(1).max(100),
})
// Monthly AI analysis of the connected page (PRC-04): the visual profile plus
// the caption text, post formats and hashtag habits of the fetched posts.
export const pageStyleAnalysisSchema = styleProfileGenerationSchema.extend({
  captionStyle: z.string().trim().max(500),
  formats: z.string().trim().max(500),
  hashtags: z.string().trim().max(500),
})
export type PageStyleAnalysis = z.infer<typeof pageStyleAnalysisSchema>
/**
 * Where the approved logo belongs in this composition. The image model must not
 * draw a logo, so the application composites the real file afterwards; this is
 * how the model that designed the composition says which corner it left free.
 * "auto" leaves the choice to the application, which finds the calmest area
 * itself. It exists so a model with no real preference does not have to invent
 * one, and so posts written before this field carry a truthful value.
 */
export const logoZoneSchema = z.enum([
  'auto',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])
export type LogoZone = z.infer<typeof logoZoneSchema>

export const creativeSchema = z.object({
  headline: z.string().trim().min(3).max(64),
  eyebrow: z.string().trim().min(2).max(48),
  cta: z.string().trim().min(2).max(32),
  // Describes the model's unique composition; it never selects a coded preset.
  layout: z.string().trim().min(1).max(600),
  // Required of the model, because provider structured output rejects a
  // property that is not required. The fallback keeps older stored posts and a
  // malformed answer readable.
  logoZone: logoZoneSchema.catch('auto'),
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
  sourceFidelity: z.boolean().default(true),
  sourceFidelityReasons: z.array(z.string().min(1).max(500)).max(5).default([]),
  styleConsistency: z.boolean().default(true),
  styleReasons: z.array(z.string().min(1).max(500)).max(5).default([]),
  visualDistinctness: z.boolean().default(true),
  distinctnessReasons: z.array(z.string().min(1).max(500)).max(5).default([]),
})
export const monthlyPostProvenanceSchema = z.object({
  planId: z.uuid(),
  slot: z.number().int().nonnegative(),
  evidenceHash: z.string(),
  styleReferenceRevision: z.string().optional(),
  styleReferences: z
    .array(
      z.object({
        source: z.enum(['facebook', 'instagram', 'platform']),
        channel: z.enum(['Facebook', 'Instagram']),
        postId: z.uuid().optional(),
        providerId: z.string().min(1).optional(),
        assetId: z.uuid().optional(),
        publishedAt: z.iso.datetime(),
      }),
    )
    .max(8)
    .optional(),
  styleReferenceCount: z.number().int().nonnegative().optional(),
  platformPublishedStyleCount: z.number().int().nonnegative().optional(),
  importedSocialStyleCount: z.number().int().nonnegative().optional(),
  pageStyleHistory: z
    .object({
      totalPosts: z.number().int().nonnegative(),
      byChannel: z.object({
        Facebook: z.number().int().nonnegative(),
        Instagram: z.number().int().nonnegative(),
      }),
      bySource: z.object({
        platform: z.number().int().nonnegative(),
        facebook: z.number().int().nonnegative(),
        instagram: z.number().int().nonnegative(),
      }),
      mediaTypes: z.record(z.string(), z.number().int().nonnegative()),
      captionedPosts: z.number().int().nonnegative(),
      averageCaptionLength: z.number().int().nonnegative(),
      oldestPublishedAt: z.iso.datetime().nullable(),
      newestPublishedAt: z.iso.datetime().nullable(),
    })
    .optional(),
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
export type StyleProfile = z.infer<typeof styleProfileSchema>
export type PlannedCreativeLayout = z.infer<typeof plannedCreativeLayoutSchema>
