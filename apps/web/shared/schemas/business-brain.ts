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

// Compact Business Brain projection consumed by the monthly planner. The
// planner snapshots it once per plan and carries it through the existing
// provider payloads; it never adds a provider call of its own. Every value is
// the business's own text passed through verbatim: the application applies no
// category, classification or template to it.
export const plannerBrainAudienceSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
})
export const plannerBrainOfferSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  currency: z.enum(['EUR', 'ALL']),
  amount: z.number().nonnegative().nullable(),
  validFrom: z.string().date(),
  validUntil: z.string().date().nullable(),
  source: z.string().trim().min(1).max(500),
})
export const plannerBrainGuardrailSchema = z.object({
  // Not a uuid: the projection also carries the rules written in the older
  // brand-profile editor, which have no row of their own. Losing a
  // prohibition because of where the business typed it is not acceptable.
  id: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(500),
})
export const plannerBrainSchema = z.object({
  voice: z.string().trim().max(1000),
  audiences: z.array(plannerBrainAudienceSchema).max(20),
  offers: z.array(plannerBrainOfferSchema).max(20),
  guardrails: z.array(plannerBrainGuardrailSchema).max(30),
})
export type PlannerBrainAudience = z.infer<typeof plannerBrainAudienceSchema>
export type PlannerBrainOffer = z.infer<typeof plannerBrainOfferSchema>
export type PlannerBrainGuardrail = z.infer<typeof plannerBrainGuardrailSchema>
export type PlannerBrain = z.infer<typeof plannerBrainSchema>

export const emptyPlannerBrain: PlannerBrain = {
  voice: '',
  audiences: [],
  offers: [],
  guardrails: [],
}

// Business Brain facts and brand-profile facts are two editors over the same
// idea, so generation sees one list. Brain rows are mapped into the shape the
// planner already cites by id; they carry no validity window or price, which
// belong to offers.
export function brainFactAsBrandFact(fact: BusinessBrainFact): BrandFact {
  const origin =
    fact.sourceType === 'manual' ? 'user' : fact.sourceType === 'social' ? 'social' : 'research'
  return {
    id: fact.id,
    text: fact.text,
    source: fact.source,
    verified: fact.status === 'verified',
    kind: 'fact',
    validFrom: null,
    validUntil: null,
    amountCents: null,
    currency: null,
    state: fact.status,
    confidence: fact.confidence,
    origin,
    verifiedAt: fact.verifiedAt,
    verifiedBy: fact.verifiedBy,
    revision: fact.version,
  }
}

// Onboarding copies profile facts into Business Brain, so the same sentence
// usually exists in both stores. The profile row wins: existing plans already
// cite its id.
export function mergeBrandFacts(profileFacts: BrandFact[], brainFacts: BrandFact[]) {
  const seen = new Set(
    profileFacts.map((fact) => fact.text.trim().toLocaleLowerCase('sq')).filter(Boolean),
  )
  const ids = new Set(profileFacts.map((fact) => fact.id))
  const extra = brainFacts.filter((fact) => {
    const key = fact.text.trim().toLocaleLowerCase('sq')
    if (!key || seen.has(key) || ids.has(fact.id)) return false
    seen.add(key)
    return true
  })
  return [...profileFacts, ...extra]
}

// An offer may only reach a post whose publication day falls inside the window
// the business itself declared. A price is the one AI output the customer
// cannot correct after publication, so the window is enforced per slot rather
// than per plan.
export function offerIsUsable(offer: PlannerBrainOffer, day: string) {
  if (!offer.name.trim() || !offer.source.trim()) return false
  if (offer.validFrom > day) return false
  if (offer.validUntil && offer.validUntil < day) return false
  if (offer.validUntil && offer.validUntil < offer.validFrom) return false
  return true
}

// Guardrails carried over from the older brand-profile editor get a synthetic
// id, because they have no row of their own. The drift check uses the prefix to
// leave them to the brand-profile comparison that already covers them.
export const profileGuardrailIdPrefix = 'brand-profile-'

// Offers and guardrails are the two sections whose mid-flight change makes an
// already-planned post factually wrong rather than merely less tailored, so
// only these two participate in the evidence-drift check.
//
// The snapshot is a processed view: its offers are filtered to the planned
// month and its guardrails include the brand-profile ones. The live brain is
// raw. Comparing them directly would report drift on every tick, so each side
// is reduced to what is genuinely comparable — the Business Brain rows the
// snapshot actually committed to.
export function sameBrainCommitments(snapshot: PlannerBrain, live: PlannerBrain) {
  const liveOffers = new Map(live.offers.map((offer) => [offer.id, offer]))
  const offersHold = snapshot.offers.every((offer) => {
    const current = liveOffers.get(offer.id)
    // Field by field, never JSON.stringify of the whole object: the snapshot
    // has been through Postgres jsonb, which reorders keys, so two identical
    // offers would serialize differently and report drift forever.
    return (
      !!current &&
      current.name === offer.name &&
      current.description === offer.description &&
      current.currency === offer.currency &&
      current.amount === offer.amount &&
      current.validFrom === offer.validFrom &&
      current.validUntil === offer.validUntil
    )
  })
  // Guardrails are compared as a set: removing a prohibition is as meaningful
  // as adding one, because the remaining posts generate from the snapshot and
  // would not honour a rule added after it.
  const rules = (brain: PlannerBrain) =>
    brain.guardrails
      .filter((guardrail) => !guardrail.id.startsWith(profileGuardrailIdPrefix))
      .map((guardrail) => `${guardrail.id}:${guardrail.text.trim()}`)
      .sort()
  return offersHold && JSON.stringify(rules(snapshot)) === JSON.stringify(rules(live))
}
