import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createDemo } from '../fixtures/workspace'
import {
  brainForSlot,
  normalizeEditorialPlanResponse,
  plannerBrainOf,
  plannerEvidence,
  plannerPrerequisites,
  plannerVoice,
  promptEvidence,
} from '../../server/utils/monthly-planner-domain'
import { monthlyImagePrompt } from '../../server/utils/monthly-ai'
import {
  brainFactAsBrandFact,
  emptyPlannerBrain,
  offerIsUsable,
  sameBrainCommitments,
  type PlannerBrain,
} from '../../shared/schemas/business-brain'
import type { Research } from '../../shared/schemas/monthly-plan'

const now = new Date('2026-09-09T08:00:00Z')
const month = '2026-09'
const audienceId = randomUUID()
const otherAudienceId = randomUUID()
const offerId = randomUUID()
const expiredOfferId = randomUUID()
const guardrailId = randomUUID()

function brainFixture(): PlannerBrain {
  return {
    voice: 'Ngrohtë dhe i drejtpërdrejtë, pa mbiemra të tepërt.',
    audiences: [
      {
        id: audienceId,
        name: 'Klientë të rregullt të mëngjesit',
        description: 'Vijnë para orës 9 para punës.',
      },
      { id: otherAudienceId, name: 'Studentë', description: 'Kërkojnë vend për të studiuar.' },
    ],
    offers: [
      {
        id: offerId,
        name: 'Kafja e mëngjesit',
        description: 'Kafe plus brumë para orës 10.',
        currency: 'EUR',
        amount: 2.5,
        validFrom: '2026-09-10',
        validUntil: '2026-09-20',
        source: 'Plotësuar nga biznesi',
      },
      {
        id: expiredOfferId,
        name: 'Oferta e gushtit',
        description: 'Ka përfunduar.',
        currency: 'EUR',
        amount: 1.5,
        validFrom: '2026-08-01',
        validUntil: '2026-08-31',
        source: 'Plotësuar nga biznesi',
      },
    ],
    guardrails: [
      {
        id: guardrailId,
        text: 'Mos përmend kurrë pije alkoolike.',
        source: 'Plotësuar nga biznesi',
      },
    ],
  }
}

function researchFixture(): Research {
  return {
    markdown: 'Konteksti i vëzhguar [1]',
    sources: [{ url: 'https://example.test/local-market', title: 'Local primary source' }],
    capturedAt: now.toISOString(),
  } as Research
}

function editorialResponse(overrides: Record<string, unknown> = {}) {
  return {
    objective: 'Introduce the verified business offering',
    audience: 'Local regular customers',
    rationale: 'A varied calendar rooted in verified facts.',
    slots: [
      {
        day: 15,
        time: '10:00',
        channel: 'Instagram',
        topic: 'The daily coffee ritual',
        pillar: 'Product',
        intent: 'educate',
        hook: 'What makes this daily ritual useful?',
        purpose: 'Explain the real product with a useful story.',
        assetDirection: 'Use the clearest owned product photo with room around the subject.',
        visualLayout: 'Build the hierarchy around the real coffee cup and morning light.',
        algorithmGoal: 'saves',
        platformRationale: 'Instagram supports a visual product story people can save.',
        timingRationale: 'This morning slot is a hypothesis to verify with account Insights.',
        factIds: ['f2'],
        sourceUrls: ['https://example.test/local-market'],
        requiredAssetId: null,
        ...overrides,
      },
    ],
  }
}

describe('Business Brain reaches monthly generation', () => {
  it('freezes the brain into the plan snapshot', () => {
    const evidence = plannerEvidence(createDemo(), now, month, undefined, [], { brain: brainFixture() })
    const brain = plannerBrainOf(evidence)
    expect(brain.voice).toContain('Ngrohtë')
    expect(brain.audiences).toHaveLength(2)
    expect(brain.guardrails.map((rule) => rule.text)).toEqual([
      'Mos përmend kurrë pije alkoolike.',
    ])
  })

  it('resolves the two voice fields into one and keeps every guardrail', () => {
    const workspace = createDemo()
    workspace.brand.voice = 'Zëri i vjetër nga profili'
    workspace.brand.guardrails = ['Mos premto kurrë zbritje pa datë.']
    const brain = plannerBrainOf(
      plannerEvidence(workspace, now, month, undefined, [], { brain: brainFixture() }),
    )
    expect(brain.voice).toContain('Ngrohtë')
    expect(brain.guardrails.map((rule) => rule.text)).toEqual([
      'Mos përmend kurrë pije alkoolike.',
      'Mos premto kurrë zbritje pa datë.',
    ])
  })

  it('falls back to the profile voice when Business Brain has none', () => {
    const workspace = createDemo()
    workspace.brand.voice = 'Zëri i vjetër nga profili'
    const brain = plannerBrainOf(
      plannerEvidence(workspace, now, month, undefined, [], {
        brain: { ...brainFixture(), voice: '' },
      }),
    )
    expect(brain.voice).toBe('Zëri i vjetër nga profili')
  })

  it('does not repeat a guardrail the business wrote in both editors', () => {
    const workspace = createDemo()
    workspace.brand.guardrails = ['Mos përmend kurrë pije alkoolike.']
    const brain = plannerBrainOf(
      plannerEvidence(workspace, now, month, undefined, [], { brain: brainFixture() }),
    )
    expect(brain.guardrails).toHaveLength(1)
  })

  it('drops offers whose window cannot reach the planned month', () => {
    const evidence = plannerEvidence(createDemo(), now, month, undefined, [], { brain: brainFixture() })
    expect(plannerBrainOf(evidence).offers.map((offer) => offer.id)).toEqual([offerId])
  })

  it('generates without a brain for a business that has none', () => {
    const workspace = createDemo()
    workspace.brand.guardrails = []
    const brain = plannerBrainOf(plannerEvidence(workspace, now, month))
    expect(brain).toEqual({
      ...emptyPlannerBrain,
      // The profile voice still reaches generation exactly as it did before.
      voice: workspace.brand.voice,
    })
  })

  it('keeps the stored brain out of the prompt copy so per-slot narrowing holds', () => {
    const evidence = plannerEvidence(createDemo(), now, month, undefined, [], { brain: brainFixture() })
    const forPrompt = promptEvidence(evidence)
    expect('brain' in forPrompt).toBe(false)
    // Everything else the stages rely on survives the projection.
    expect(forPrompt.brand.facts.length).toBe(evidence.brand.facts.length)
    expect(forPrompt.timezone).toBe(evidence.timezone)
    expect(JSON.stringify(forPrompt)).not.toContain(offerId)
  })
})

describe('Business Brain facts join the single fact list', () => {
  function brainFact(overrides: Record<string, unknown> = {}) {
    return brainFactAsBrandFact({
      id: randomUUID(),
      brandId: randomUUID(),
      kind: 'explicit',
      status: 'verified',
      text: 'Ofrojmë dorëzim falas brenda Rahovecit.',
      source: 'Plotësuar nga biznesi',
      sourceUrl: null,
      sourceType: 'manual',
      confidence: 1,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      verifiedAt: now.toISOString(),
      verifiedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      ...overrides,
    })
  }

  it('cites a fact written only in Business Brain', () => {
    const fact = brainFact()
    const evidence = plannerEvidence(createDemo(), now, month, undefined, [], {
      brain: brainFixture(),
      facts: [fact],
    })
    expect(evidence.brand.facts.map((item) => item.id)).toContain(fact.id)
  })

  it('unblocks a business whose only verified facts live in Business Brain', () => {
    const workspace = createDemo()
    workspace.brand.facts = []
    expect(plannerPrerequisites(workspace, now, month).some((item) => item.id === 'fact-text')).toBe(
      true,
    )
    expect(plannerPrerequisites(workspace, now, month, [brainFact()])).toEqual([])
  })

  it('does not cite the same sentence twice when onboarding copied it across', () => {
    const workspace = createDemo()
    const duplicate = brainFact({ text: workspace.brand.facts[0]!.text })
    const evidence = plannerEvidence(workspace, now, month, undefined, [], {
      facts: [duplicate],
    })
    expect(evidence.brand.facts.filter((item) => item.text === workspace.brand.facts[0]!.text))
      .toHaveLength(1)
    expect(evidence.brand.facts.map((item) => item.id)).not.toContain(duplicate.id)
  })

  it('ignores a Business Brain fact that is not verified', () => {
    const proposed = brainFact({ status: 'proposed', verifiedAt: null })
    const evidence = plannerEvidence(createDemo(), now, month, undefined, [], {
      facts: [proposed],
    })
    expect(evidence.brand.facts.map((item) => item.id)).not.toContain(proposed.id)
  })
})

describe('planning assigns brain references per slot', () => {
  const evidence = plannerEvidence(createDemo(), now, month, undefined, [], { brain: brainFixture() })

  it('keeps an audience and an offer the business actually declared', () => {
    const plan = normalizeEditorialPlanResponse(
      editorialResponse({ audienceId, offerId }),
      evidence,
      researchFixture(),
      1,
      month,
    )
    expect(plan.slots[0]!.audienceId).toBe(audienceId)
    expect(plan.slots[0]!.offerId).toBe(offerId)
  })

  it('discards references the model invented', () => {
    const plan = normalizeEditorialPlanResponse(
      editorialResponse({ audienceId: randomUUID(), offerId: randomUUID() }),
      evidence,
      researchFixture(),
      1,
      month,
    )
    expect(plan.slots[0]!.audienceId).toBeNull()
    expect(plan.slots[0]!.offerId).toBeNull()
  })

  it('refuses an offer whose window does not cover the slot day', () => {
    // The offer runs 10–20 September; day 25 falls outside it.
    const plan = normalizeEditorialPlanResponse(
      editorialResponse({ day: 25, offerId }),
      evidence,
      researchFixture(),
      1,
      month,
    )
    expect(plan.slots[0]!.offerId).toBeNull()
  })
})

describe('per-slot projection', () => {
  const brain = brainFixture()

  it('narrows the audience and offer but never the guardrails or voice', () => {
    const projection = brainForSlot(brain, { audienceId, offerId }, '2026-09-15')
    expect(projection.audience?.id).toBe(audienceId)
    expect(projection.offer?.id).toBe(offerId)
    expect(projection.guardrails).toHaveLength(1)
    expect(projection.voice).toBe(brain.voice)
  })

  it('withholds an offer that expired before the publication day', () => {
    const projection = brainForSlot(brain, { audienceId, offerId }, '2026-09-25')
    expect(projection.offer).toBeNull()
    expect(projection.guardrails).toHaveLength(1)
  })

  it('carries no offer when planning assigned none', () => {
    expect(brainForSlot(brain, {}, '2026-09-15').offer).toBeNull()
  })
})

describe('offer windows', () => {
  const [offer] = brainFixture().offers
  it('accepts only days inside the declared window', () => {
    expect(offerIsUsable(offer!, '2026-09-10')).toBe(true)
    expect(offerIsUsable(offer!, '2026-09-20')).toBe(true)
    expect(offerIsUsable(offer!, '2026-09-09')).toBe(false)
    expect(offerIsUsable(offer!, '2026-09-21')).toBe(false)
  })
  it('treats an open-ended offer as running from its start date', () => {
    expect(offerIsUsable({ ...offer!, validUntil: null }, '2027-01-01')).toBe(true)
  })
})

describe('mid-flight drift', () => {
  // The snapshot is processed (offers filtered to the month, brand-profile
  // guardrails merged in) while the live brain is raw. Comparing them naively
  // reported drift on every tick and stalled the plan at advance.evidence.
  it('does not report drift between a processed snapshot and the raw brain', () => {
    const workspace = createDemo()
    workspace.brand.guardrails = ['Rregull i vjetër nga profili i biznesit.']
    const live = brainFixture()
    const snapshot = plannerBrainOf(
      plannerEvidence(workspace, now, month, undefined, [], { brain: live }),
    )
    // The snapshot dropped the August offer and gained the profile guardrail.
    expect(snapshot.offers).toHaveLength(1)
    expect(snapshot.guardrails).toHaveLength(2)
    expect(live.offers).toHaveLength(2)
    expect(sameBrainCommitments(snapshot, live)).toBe(true)
  })

  // Same class of bug as above: the snapshot stores the reconciled voice, so
  // the drift check has to derive its expectation the same way instead of
  // reading the brand profile directly.
  it('derives the same voice for the snapshot and the drift check', () => {
    const workspace = createDemo()
    workspace.brand.voice = 'Zëri i vjetër nga profili'
    const live = brainFixture()
    const evidence = plannerEvidence(workspace, now, month, undefined, [], { brain: live })
    expect(evidence.brand.voice).toBe(plannerVoice(live, workspace.brand))
    expect(evidence.brand.voice).toBe(live.voice)
  })

  // A snapshot is read back from a jsonb column, which reorders object keys by
  // length. Comparing whole serialized objects reported drift on every tick
  // even when every value was identical.
  it('survives the key reordering a jsonb round-trip applies', () => {
    const live = brainFixture()
    const reordered: PlannerBrain = {
      ...live,
      offers: live.offers.map((offer) => ({
        id: offer.id,
        name: offer.name,
        amount: offer.amount,
        source: offer.source,
        currency: offer.currency,
        validFrom: offer.validFrom,
        validUntil: offer.validUntil,
        description: offer.description,
      })),
    }
    expect(JSON.stringify(reordered.offers)).not.toBe(JSON.stringify(live.offers))
    expect(sameBrainCommitments(reordered, live)).toBe(true)
  })

  it('ignores an offer added after the snapshot', () => {
    const live = brainFixture()
    const snapshot = plannerBrainOf(
      plannerEvidence(createDemo(), now, month, undefined, [], { brain: live }),
    )
    const withNewOffer = {
      ...live,
      offers: [
        ...live.offers,
        { ...live.offers[0]!, id: randomUUID(), name: 'Ofertë e re' },
      ],
    }
    expect(sameBrainCommitments(snapshot, withNewOffer)).toBe(true)
  })

  it('stops the plan when an offer or a guardrail changes', () => {
    const original = brainFixture()
    const repricedOffer = {
      ...original,
      offers: original.offers.map((offer) => ({ ...offer, amount: 9.9 })),
    }
    const withoutGuardrail = { ...original, guardrails: [] }
    expect(sameBrainCommitments(original, repricedOffer)).toBe(false)
    expect(sameBrainCommitments(original, withoutGuardrail)).toBe(false)
  })

  it('lets the plan continue when only the voice or an audience changes', () => {
    const original = brainFixture()
    expect(sameBrainCommitments(original, { ...original, voice: 'Ton tjetër' })).toBe(true)
    expect(
      sameBrainCommitments(original, {
        ...original,
        audiences: [{ id: audienceId, name: 'Emër i ri', description: 'Përshkrim i ri' }],
      }),
    ).toBe(true)
  })
})

describe('image prompt', () => {
  const brand = { name: 'Demo', industry: 'Kafene', audience: 'Klientë lokalë', color: '#1f6f5c' }
  const creative = {
    eyebrow: 'Mëngjes',
    headline: 'Kafja jote e përditshme',
    cta: 'Na vizito',
    layout: 'Hierarki rreth filxhanit real.',
  }
  const slot = {
    channel: 'Instagram' as const,
    topic: 'Rituali i kafes',
    intent: 'educate',
    hook: 'Pse ka rëndësi?',
    purpose: 'Trego produktin real.',
    assetDirection: 'Foto e qartë e produktit.',
    visualLayout: 'Dritë natyrale mëngjesi.',
    algorithmGoal: 'saves',
  }

  it('passes every guardrail through verbatim, without classifying them', () => {
    const prompt = monthlyImagePrompt({
      brand,
      creative,
      slot,
      guardrails: ['Mos përmend kurrë pije alkoolike.', 'Mos përdor fotografi me fëmijë.'],
    })
    expect(prompt).toContain('Mos përmend kurrë pije alkoolike.')
    expect(prompt).toContain('Mos përdor fotografi me fëmijë.')
    expect(prompt).toContain('They are prohibitions, not preferences')
  })

  // The guardrails pushed a real prompt to 12181 bytes and the image stage
  // refused it at the old 12 KB ceiling. A full art direction plus a typical
  // rule set has to fit with room to spare.
  it('leaves room for the business rules on top of a full art direction', () => {
    const styleProfile = {
      palette: ['#1c8764', '#ffffff', '#111111'],
      contrast: 'x'.repeat(500),
      typography: 'x'.repeat(500),
      hierarchy: 'x'.repeat(500),
      density: 'x'.repeat(500),
      spacing: 'x'.repeat(500),
      photography: 'x'.repeat(500),
      composition: 'x'.repeat(500),
      brandElements: 'x'.repeat(500),
      tone: 'x'.repeat(500),
      doNotUse: Array.from({ length: 12 }, () => 'x'.repeat(200)),
    }
    const prompt = monthlyImagePrompt({
      brand,
      creative,
      slot,
      logoAvailable: true,
      styleProfile,
      previousGeneratedPostCount: 5,
      previousPageStyle: { exampleCount: 12, dimensions: Array.from({ length: 5 }, () => 'x'.repeat(60)) },
      revisionFeedback: ['x'.repeat(400)],
      guardrails: Array.from({ length: 10 }, (_, index) => `Rregulli ${index}: ${'x'.repeat(200)}`),
    })
    expect(Buffer.byteLength(prompt)).toBeLessThan(32000)
  })

  it('never carries facts or offer prices into the image', () => {
    const prompt = monthlyImagePrompt({ brand, creative, slot, guardrails: [] })
    expect(prompt).not.toContain('2.5')
    expect(prompt).toContain('never invent a product, person, venue feature, sign, offer')
  })
})
