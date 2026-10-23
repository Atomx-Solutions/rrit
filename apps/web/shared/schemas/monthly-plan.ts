import { z } from 'zod'

export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
export const researchSourceSchema = z.object({
  url: z.url().refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)),
  title: z.string().max(500),
})
// A dated occasion the research found inside the permitted window. It is kept
// structured, separately from the prose, because every later batch of posts is
// planned on demand and must be able to anchor on a date without re-reading the
// report. `sourceUrl` is always one of the research sources: an occasion whose
// date cannot be cited is not an occasion, it is a guess.
export const researchOccasionSchema = z.object({
  date: z.string().date(),
  name: z.string().trim().min(2).max(120),
  category: z.enum(['publicEvents', 'seasonalEvents', 'industryTrends']),
  relevance: z.string().trim().max(400),
  sourceUrl: researchSourceSchema.shape.url,
})
export const researchLanguageSchema = z.object({
  locale: z.enum(['sq-XK', 'en-US', 'de-CH', 'it-CH', 'fr-CH', 'tr-TR']),
  audienceSummary: z.string().trim().min(2).max(500),
  rationale: z.string().trim().min(10).max(1000),
  confidence: z.number().min(0).max(1),
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
  // Older plans carry none, and a research run that found nothing inside the
  // window carries an empty list; both must keep parsing.
  occasions: z.array(researchOccasionSchema).max(30).default([]),
  // Kept optional for plans created before language detection existed. New
  // research is required to carry a decision at the planner boundary.
  language: researchLanguageSchema.optional(),
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
// What this slot produces. A video slot is still a static 4:5 feed post: the
// photograph it selects is additionally chosen to be animated into a vertical
// video afterward, so the slot carries a motion brief alongside the post. Older
// plans were all static, which is why this defaults rather than being required.
export const slotDeliverableSchema = z.enum(['static_post', 'video'])
// Structured shot direction for a video slot. Strategy picks each enum from
// the actual photograph and the content intent; the planner's deterministic
// Video Creative Plan reads these to decide subject-safe and text-safe
// zones, and the prompt builder templates them into natural language so the
// provider receives a camera idea and a composition anchor rather than
// prose alone. Every field is optional with a safe default so legacy video
// briefs keep rendering.
export const shotCameraSchema = z.enum([
  'static',
  'slow_push',
  'slow_pull',
  'arc',
  'parallax_drift',
  'handheld_settle',
])
export const shotPacingSchema = z.enum(['calm', 'measured', 'punchy'])
export const shotSubjectAnchorSchema = z.enum(['left', 'centre', 'right'])
export const shotTextZoneSchema = z.enum(['top', 'bottom', 'left', 'right', 'full'])
// What happens in the frame beyond the camera. Each step trades certainty
// about the subject for life: the camera alone moves over the real photograph;
// ambient adds the light, reflections and air the photograph already holds;
// subject_moves lets the subject itself move, which only the photograph's own
// subject may do, and which is checked against the photograph afterwards.
export const shotActionSchema = z.enum(['camera_only', 'ambient', 'subject_moves'])
export const shotDirectionSchema = z.object({
  camera: shotCameraSchema,
  pacing: shotPacingSchema,
  subjectAnchor: shotSubjectAnchorSchema,
  textZone: shotTextZoneSchema,
  action: shotActionSchema,
  // Whether the video closes on the branded end-card. The designed overlay
  // already carries the brand and the call to action, so a card is a choice
  // for videos that benefit from a closing beat, not a fixture of every one.
  endCard: z.boolean(),
})
// A shot as stored. Shots written before the action existed read as the
// camera-only motion they were rendered with.
export const storedShotDirectionSchema = shotDirectionSchema.extend({
  action: shotActionSchema.default('camera_only'),
  endCard: z.boolean().default(true),
})
export const slotBriefSchema = z.object({
  day: z.number().int().min(1).max(31),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  // A video reaches whichever of these three the brief chose. TikTok appears
  // here only because a video can go there; a static feed post cannot, which
  // the planner enforces rather than the enum.
  channel: z.enum(['Facebook', 'Instagram', 'TikTok']),
  topic: z.string().min(5).max(200),
  pillar: z.string().min(2).max(80),
  intent: contentIntentSchema,
  deliverable: slotDeliverableSchema.default('static_post'),
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
  // Structured shot direction for video slots. Optional with safe defaults so
  // older plans and non-video slots parse without emitting it; null is what a
  // generated static slot carries, since structured outputs cannot omit it.
  shot: storedShotDirectionSchema.nullable().optional(),
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
// slot repeats the Business Brain references and the shot direction as
// required-but-nullable.
export const slotBriefGenerationSchema = slotBriefSchema.extend({
  audienceId: z.uuid().nullable(),
  offerId: z.uuid().nullable(),
  deliverable: slotDeliverableSchema,
  shot: shotDirectionSchema.nullable(),
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
export type ShotDirection = z.infer<typeof shotDirectionSchema>
export type Research = z.infer<typeof researchSchema>
export type ResearchOccasion = z.infer<typeof researchOccasionSchema>
export type ResearchLanguage = z.infer<typeof researchLanguageSchema>
export type Creative = z.infer<typeof creativeSchema>
export type StyleProfile = z.infer<typeof styleProfileSchema>
export type PlannedCreativeLayout = z.infer<typeof plannedCreativeLayoutSchema>
