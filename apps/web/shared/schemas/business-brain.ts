import { z } from 'zod'

export const factKindSchema = z.enum(['explicit', 'candidate'])
export const factStatusSchema = z.enum(['proposed', 'verified', 'rejected', 'archived'])
export const sourceTypeSchema = z.enum(['manual', 'website', 'social', 'import', 'ai'])

export const businessBrainFactSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  kind: factKindSchema,
  status: factStatusSchema,
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().max(1000).nullable(),
  sourceType: sourceTypeSchema,
  confidence: z.number().min(0).max(1),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().nullable(),
  verifiedBy: z.uuid().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectedBy: z.uuid().nullable(),
})

export const voiceVersionSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  version: z.number().int().positive(),
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(500),
  active: z.boolean(),
  createdAt: z.string().datetime(),
})

export const audienceSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const offerStatusSchema = z.enum(['draft', 'active', 'archived'])
export const offerSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  currency: z.enum(['EUR', 'ALL']),
  amount: z.number().nonnegative().nullable(),
  validFrom: z.string().date(),
  validUntil: z.string().date().nullable(),
  source: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
  status: offerStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const guardrailSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(500),
  status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const businessBrainSchema = z.object({
  revision: z.number().int().positive(),
  facts: z.array(businessBrainFactSchema),
  voiceVersions: z.array(voiceVersionSchema),
  audiences: z.array(audienceSchema),
  offers: z.array(offerSchema),
  guardrails: z.array(guardrailSchema),
})

export const createFactSchema = z.object({
  kind: factKindSchema,
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().max(1000).nullable().default(null),
  sourceType: sourceTypeSchema.default('manual'),
  confidence: z.number().min(0).max(1).default(1),
})

export const updateFactSchema = createFactSchema.pick({ text: true, source: true, sourceUrl: true, confidence: true })

export const updateBrainSchema = z.object({
  revision: z.number().int().positive(),
  voice: z.object({ text: z.string().trim().min(1).max(1000), source: z.string().trim().min(1).max(500) }),
  audiences: z.array(z.object({ id: z.uuid().optional(), name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000) })).max(20),
  guardrails: z.array(z.object({ id: z.uuid().optional(), text: z.string().trim().min(1).max(1000), source: z.string().trim().min(1).max(500) })).max(30),
})

export const createOfferSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  currency: z.enum(['EUR', 'ALL']),
  amount: z.number().nonnegative().nullable().default(null),
  validFrom: z.string().date(),
  validUntil: z.string().date().nullable().default(null),
  source: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1).default(1),
})

export type BusinessBrain = z.infer<typeof businessBrainSchema>
export type BusinessBrainFact = z.infer<typeof businessBrainFactSchema>
export type CreateFact = z.infer<typeof createFactSchema>
export type UpdateFact = z.infer<typeof updateFactSchema>
export type CreateOffer = z.infer<typeof createOfferSchema>
