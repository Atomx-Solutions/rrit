import { describe, expect, it } from 'vitest'
import {
  businessBrainFactSchema,
  createFactSchema,
  createOfferSchema,
  factIsUsable,
  updateBrainSchema,
  type BrandFact,
} from '../../shared/schemas/business-brain'
import { normalizeBrandFact } from '../../server/utils/business-brain'
import { plannerEvidence, validateEditorialPlan } from '../../server/utils/monthly-planner-domain'
import { workspaceSchema } from '../../shared/schemas/workspace'
import { createDemo } from '../fixtures/workspace'

const ids = {
  brand: '11111111-1111-4111-8111-111111111111',
  fact: '22222222-2222-4222-8222-222222222222',
}

describe('Business Brain contracts', () => {
  it('accepts a proposed fact with provenance and confidence', () => {
    const result = createFactSchema.safeParse({
      kind: 'candidate',
      text: 'Servisi punon edhe te shtunave.',
      source: 'Intervistë me biznesin',
      sourceType: 'manual',
      confidence: 0.75,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence and missing provenance', () => {
    expect(
      createFactSchema.safeParse({ kind: 'candidate', text: 'Fakt', source: '', confidence: 1.2 })
        .success,
    ).toBe(false)
  })

  it('models verified and rejected states explicitly', () => {
    const result = businessBrainFactSchema.safeParse({
      id: ids.fact,
      brandId: ids.brand,
      kind: 'candidate',
      status: 'verified',
      text: 'Fakt i verifikuar.',
      source: 'Dokument i biznesit',
      sourceUrl: null,
      sourceType: 'import',
      confidence: 0.98,
      version: 2,
      createdAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T10:05:00.000Z',
      verifiedAt: '2026-09-11T10:05:00.000Z',
      verifiedBy: ids.brand,
      rejectedAt: null,
      rejectedBy: null,
    })
    expect(result.success).toBe(true)
  })

  it('requires valid offer dates and a supported currency', () => {
    expect(
      createOfferSchema.safeParse({
        name: 'Zbritje',
        description: 'Oferta e verifikuar',
        currency: 'EUR',
        amount: 10,
        validFrom: '2026-09-11',
        validUntil: '2026-09-30',
        source: 'Lista e çmimeve',
        confidence: 1,
      }).success,
    ).toBe(true)
    expect(
      createOfferSchema.safeParse({
        name: 'Zbritje',
        description: '',
        currency: 'USD',
        amount: 10,
        validFrom: '2026-09-11',
        source: 'Manual',
        confidence: 1,
      }).success,
    ).toBe(false)
  })

  it('requires a revision for Business Brain settings writes', () => {
    expect(
      updateBrainSchema.safeParse({
        voice: { text: 'Informativ', source: 'Manual' },
        audiences: [],
        guardrails: [],
      }).success,
    ).toBe(false)
  })
})

const actor = '00000000-0000-4000-8000-000000000001'
const now = new Date('2026-09-09T08:00:00Z')
const base: BrandFact = {
  id: 'verified-fact',
  text: 'Coffee costs 2 EUR.',
  source: 'Business price list',
  verified: false,
}
describe('Business Brain verification lifecycle', () => {
  it('accepts only safe HTTPS research leads and keeps them separate from verified facts', () => {
    const workspace = createDemo()
    workspace.brand.researchSources = ['https://business.example/menu']
    const parsed = workspaceSchema.parse(workspace)
    expect(parsed.brand.researchSources).toEqual(['https://business.example/menu'])
    expect(parsed.brand.facts).toEqual(workspace.brand.facts)
    expect(() =>
      workspaceSchema.parse({
        ...workspace,
        brand: { ...workspace.brand, researchSources: ['http://business.example'] },
      }),
    ).toThrow()
    expect(() =>
      workspaceSchema.parse({
        ...workspace,
        brand: { ...workspace.brand, researchSources: ['https://user:pass@business.example'] },
      }),
    ).toThrow()
  })
  it('owns verification metadata and never trusts supplied origin/confidence', () => {
    const fact = normalizeBrandFact(
      { ...base, verified: true, origin: 'research', confidence: 1, revision: 99 },
      undefined,
      actor,
      now,
    )
    expect(fact).toMatchObject({
      verified: true,
      verifiedBy: actor,
      verifiedAt: now.toISOString(),
      origin: 'user',
      confidence: null,
      revision: 1,
    })
  })
  it('demotes edits and requires a separate confirmation without losing revision history', () => {
    const first = normalizeBrandFact({ ...base, verified: true }, undefined, actor, now)
    const edited = normalizeBrandFact({ ...first, text: 'Coffee costs 3 EUR.' }, first, actor, now)
    expect(edited).toMatchObject({
      verified: false,
      verifiedBy: null,
      verifiedAt: null,
      revision: 2,
    })
    const confirmed = normalizeBrandFact({ ...edited, verified: true }, edited, actor, now)
    expect(confirmed).toMatchObject({ verified: true, revision: 3, verifiedBy: actor })
    expect(normalizeBrandFact(confirmed, confirmed, actor, now)).toEqual(confirmed)
  })
  it('requires sources, ordered offer dates, and an explicit price currency', () => {
    expect(() =>
      normalizeBrandFact({ ...base, verified: true, source: '' }, undefined, actor),
    ).toThrow()
    expect(() =>
      normalizeBrandFact({ ...base, kind: 'offer', verified: true }, undefined, actor),
    ).toThrow()
    expect(() =>
      normalizeBrandFact(
        { ...base, validFrom: '2026-09-10', validUntil: '2026-09-09' },
        undefined,
        actor,
      ),
    ).toThrow()
    expect(() => normalizeBrandFact({ ...base, amountCents: 200 }, undefined, actor)).toThrow()
  })
  it('excludes rejected, archived, expired and not-yet-valid facts', () => {
    const fact: BrandFact = {
      ...base,
      verified: true,
      kind: 'offer',
      validFrom: '2026-09-10',
      validUntil: '2026-09-15',
    }
    expect(factIsUsable(fact, '2026-09-09')).toBe(false)
    expect(factIsUsable(fact, '2026-09-10')).toBe(true)
    expect(factIsUsable(fact, '2026-09-15')).toBe(true)
    expect(factIsUsable(fact, '2026-09-16')).toBe(false)
    expect(factIsUsable({ ...fact, state: 'archived' }, '2026-09-12')).toBe(false)
    expect(factIsUsable({ ...fact, state: 'rejected' }, '2026-09-12')).toBe(false)
  })
  it('includes future offers only in matching months and checks every editorial slot date', () => {
    const workspace = createDemo()
    workspace.brand.facts = [
      { ...base, verified: true, kind: 'offer', validFrom: '2026-10-10', validUntil: '2026-10-15' },
    ]
    expect(() => plannerEvidence(workspace, now, '2026-09')).toThrow('VERIFIED_FACTS_REQUIRED')
    const evidence = plannerEvidence(workspace, now, '2026-10')
    const plan = {
      objective: 'Explain the real coffee offer',
      audience: 'Local customers',
      rationale: 'Use verified offer dates only.',
      slots: [
        {
          day: 12,
          time: '10:00',
          channel: 'Instagram',
          topic: 'Our coffee',
          pillar: 'Product',
          intent: 'product',
          hook: 'What makes this coffee offer worth discovering?',
          purpose: 'Present the verified coffee offer.',
          assetDirection: 'Use a close product crop with visible texture and natural light.',
          visualLayout:
            'Original photograph-specific direction built around the real subject and campaign intent.',
          algorithmGoal: 'profile_actions',
          platformRationale: 'Instagram gives the verified product a visual discovery surface.',
          timingRationale:
            'The morning timing is a hypothesis to validate against account Insights.',
          factIds: [base.id],
          sourceUrls: ['https://example.test/research'],
          requiredAssetId: null,
        },
      ],
    }
    const research = {
      text: 'Research fixture',
      sources: [{ url: 'https://example.test/research', title: 'Fixture source' }],
      citations: [],
      researchedAt: now.toISOString(),
    }
    expect(validateEditorialPlan(plan, evidence, research, '2026-10', 1).slots).toHaveLength(1)
    plan.slots[0]!.day = 16
    expect(() => validateEditorialPlan(plan, evidence, research, '2026-10', 1)).toThrow(
      'UNGROUNDED_PLAN',
    )
  })
})
