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

export const updateFactSchema = createFactSchema.pick({
  text: true,
  source: true,
  sourceUrl: true,
  confidence: true,
})

export const updateBrainSchema = z.object({
  revision: z.number().int().positive(),
  voice: z.object({
    text: z.string().trim().min(1).max(1000),
    source: z.string().trim().min(1).max(500),
  }),
  audiences: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(1000),
      }),
    )
    .max(20),
  guardrails: z
    .array(
      z.object({
        id: z.uuid().optional(),
        text: z.string().trim().min(1).max(1000),
        source: z.string().trim().min(1).max(500),
      }),
    )
    .max(30),
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

export const updateOfferSchema = createOfferSchema

export type BusinessBrain = z.infer<typeof businessBrainSchema>
export type BusinessBrainFact = z.infer<typeof businessBrainFactSchema>
export type CreateFact = z.infer<typeof createFactSchema>
export type UpdateFact = z.infer<typeof updateFactSchema>
export type CreateOffer = z.infer<typeof createOfferSchema>
export type UpdateOffer = z.infer<typeof updateOfferSchema>

// Backward-compatible input shape; server synchronization owns provenance and
// verification metadata. A legacy checkbox does not imply independent verification.
export const brandFactSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().max(1000),
  source: z.string().trim().max(500),
  verified: z.boolean(),
  kind: z.enum(['fact', 'offer']).optional(),
  validFrom: z.iso.date().nullable().optional(),
  validUntil: z.iso.date().nullable().optional(),
  amountCents: z.number().int().positive().max(100000000).nullable().optional(),
  currency: z.literal('EUR').nullable().optional(),
  state: z.enum(['proposed', 'verified', 'rejected', 'archived']).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  origin: z.enum(['user', 'social', 'research']).optional(),
  verifiedAt: z.iso.datetime().nullable().optional(),
  verifiedBy: z.uuid().nullable().optional(),
  revision: z.number().int().positive().optional(),
})
export type BrandFact = z.infer<typeof brandFactSchema>
export function factContent(fact: BrandFact) {
  return {
    text: fact.text,
    source: fact.source,
    kind: fact.kind || 'fact',
    validFrom: fact.validFrom || null,
    validUntil: fact.validUntil || null,
    amountCents: fact.amountCents ?? null,
    currency: fact.currency || null,
  }
}
export function factIsUsable(fact: BrandFact, day: string) {
  if (
    !fact.verified ||
    !fact.text.trim() ||
    !fact.source.trim() ||
    ['rejected', 'archived'].includes(fact.state || '')
  )
    return false
  if (fact.validFrom && fact.validFrom > day) return false
  if (fact.validUntil && fact.validUntil < day) return false
  if (
    fact.kind === 'offer' &&
    (!fact.validFrom || !fact.validUntil || fact.validUntil < fact.validFrom)
  )
    return false
  if (fact.amountCents != null && fact.currency !== 'EUR') return false
  return true
}
export function factInputProblem(fact: BrandFact) {
  if (fact.verified && (!fact.text || !fact.source))
    return 'Fakti i konfirmuar kërkon tekst dhe burim.'
  if (fact.validFrom && fact.validUntil && fact.validUntil < fact.validFrom)
    return 'Përfundimi duhet të jetë pas fillimit të vlefshmërisë.'
  if (fact.kind === 'offer' && fact.verified && (!fact.validFrom || !fact.validUntil))
    return 'Oferta kërkon datën e fillimit dhe të përfundimit.'
  if (fact.amountCents != null && fact.currency !== 'EUR')
    return 'Çmimi duhet të ketë monedhën EUR.'
  return null
}
export function sameFactContent(first: BrandFact, second: BrandFact) {
  return JSON.stringify(factContent(first)) === JSON.stringify(factContent(second))
}
