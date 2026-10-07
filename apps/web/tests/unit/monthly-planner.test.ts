import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { createDemo } from '../fixtures/workspace'
import {
  plannerEvidence,
  plannerPrerequisites,
  normalizeEditorialPlanResponse,
  validateEditorialPlan,
  planningMonth,
  parsePersistedEditorialPlan,
  eventResearchWindow,
  packageMonthWindow,
  plannerChannels,
  normalizedChannelCounts,
  soleChannel,
  channelCountsTotal,
  feedCreativeGeometry,
  PlannerFailure,
} from '../../server/utils/monthly-planner-domain'
import {
  monthlyAiConfigured,
  monthlyPlannerReadiness,
  researchFromResponse,
  retryableMonthlyGenerationFailureCode,
  retryableProviderFailureCode,
  providerHttpFailure,
  monthlyImagePrompt,
  monthlyInstructions,
  monthlyAutomaticStageKey,
  researchOccasionsFromText,
  postImageEditPrompt,
  type ProviderResponse,
} from '../../server/utils/monthly-ai'
import {
  assetContactSheet,
  normalizeGeneratedCreative,
  removeLogoBackground,
} from '../../server/utils/image-processing'
import { loadPlannerAssets } from '../../server/utils/monthly-planner'
import { generatedPostSchema, editorialPlanSchema } from '../../shared/schemas/monthly-plan'
import { paidAccessForPlanningMonth } from '../../server/utils/trials'
import { aiProviderJsonSchema } from '../../server/utils/ai-provider'
import { z } from 'zod'

afterEach(() => vi.unstubAllEnvs())
const now = new Date('2026-09-09T08:00:00Z')
function researchFixture(): ProviderResponse {
  return {
    id: 'fixture-response',
    status: 'completed',
    usage: { input_tokens: 10, output_tokens: 10 },
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [{ url: 'https://example.test/local-market', title: 'Local primary source' }],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Observed context [1]',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://example.test/local-market',
                title: 'Local primary source',
                start_index: 17,
                end_index: 20,
              },
            ],
          },
        ],
      },
    ],
  }
}
function editorialFixture() {
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
        visualLayout:
          'Build the hierarchy around the real coffee cup, natural window light and morning ritual.',
        algorithmGoal: 'saves',
        platformRationale:
          'Instagram supports a visual product story that people can save for later.',
        timingRationale: 'This morning slot is a hypothesis to verify with account-level Insights.',
        factIds: ['f2'],
        sourceUrls: ['https://example.test/local-market'],
        requiredAssetId: null,
      },
    ],
  }
}
describe('monthly evidence and provider boundaries', () => {
  it('uses one stable automatic billing key per monthly stage and post slot', () => {
    const evidence = 'evidence-123'
    expect(monthlyAutomaticStageKey('research', evidence)).toBe('research:evidence-123')
    expect(monthlyAutomaticStageKey('planning', evidence, 12)).toBe('planning:evidence-123:12')
    expect(monthlyAutomaticStageKey('image', evidence, 4)).toBe('image:evidence-123:4')
    // Prompt revisions cannot create a second automatic image billing key.
    expect(monthlyAutomaticStageKey('image', evidence, 4)).toBe(
      monthlyAutomaticStageKey('image', evidence, 4),
    )
  })
  it('classifies explicit temporary provider failures for bounded retries', () => {
    expect(retryableProviderFailureCode('PROVIDER_CREDIT_REQUIRED')).toBe(true)
    // A truncated answer may be retried, but only when the customer asks: a
    // completed-looking row would otherwise serve the same unusable text for
    // the life of the plan.
    expect(retryableProviderFailureCode('PROVIDER_INCOMPLETE')).toBe(true)
    expect(retryableProviderFailureCode('PROVIDER_RATE_LIMITED')).toBe(true)
    expect(retryableProviderFailureCode('CONFIGURATION_REQUIRED')).toBe(true)
    expect(retryableProviderFailureCode('PROVIDER_TEMPORARY')).toBe(true)
    expect(retryableProviderFailureCode('PROVIDER_UNCERTAIN')).toBe(false)
    expect(retryableMonthlyGenerationFailureCode('UNGROUNDED_PLAN')).toBe(true)
    expect(retryableMonthlyGenerationFailureCode('PROVIDER_INCOMPLETE')).toBe(false)
    expect(retryableProviderFailureCode(null)).toBe(false)
    expect(providerHttpFailure(503).code).toBe('PROVIDER_TEMPORARY')
    expect(providerHttpFailure(429).code).toBe('PROVIDER_RATE_LIMITED')
    expect(providerHttpFailure(400).code).toBe('PROVIDER_REQUEST_REJECTED')
    expect(providerHttpFailure(599).code).toBe('PROVIDER_UNCERTAIN')
  })
  it('excludes unverified facts and unowned media from the evidence pack', () => {
    const workspace = createDemo()
    workspace.assets[0]!.rights = false
    const evidence = plannerEvidence(workspace, now)
    expect(evidence.brand.facts.map((fact) => fact.id)).toEqual(['f1', 'f2'])
    expect(evidence.assets.some((asset) => asset.id === workspace.assets[0]!.id)).toBe(false)
  })
  it('requires useful business context and owned original photos', () => {
    const workspace = createDemo()
    workspace.assets = []
    expect(() => plannerEvidence(workspace)).toThrow('OWNED_PHOTOS_REQUIRED')
    workspace.assets = createDemo().assets
    workspace.brand.audience = ''
    expect(() => plannerEvidence(workspace)).toThrow('BUSINESS_CONTEXT_REQUIRED')
  })
  it('reports every missing input that blocks monthly generation', () => {
    const workspace = createDemo()
    workspace.brand.industry = ''
    workspace.brand.audience = ''
    workspace.brand.facts = [{ id: 'empty', text: '', source: '', verified: false }]
    workspace.assets = workspace.assets.map((asset) => ({ ...asset, rights: false }))

    const missing = plannerPrerequisites(workspace, now, '2026-09')
    expect(missing.map((item) => item.id)).toEqual([
      'industry',
      'audience',
      'fact-text',
      'fact-source',
      'fact-confirmation',
      'owned-photo',
    ])
    expect(missing.map((item) => item.label)).toEqual([
      'Lloji i biznesit',
      'Audienca e biznesit',
      'Teksti i detajit të biznesit',
      'Burimi i detajit',
      'Konfirmimi i detajit',
      'Fotografi reale me të drejta të konfirmuara',
    ])
    expect(() => plannerEvidence(workspace, now, '2026-09')).toThrow('BUSINESS_CONTEXT_REQUIRED')
  })
  it('captures user-selected photos and requires the strategy to assign each one once', () => {
    const workspace = createDemo()
    const selectedId = randomUUID()
    workspace.assets[0]!.id = selectedId
    const evidence = plannerEvidence(workspace, now, '2026-09', {
      mode: 'selected',
      selectedAssetIds: [selectedId],
    })
    expect(evidence.assets.map((asset) => asset.id)).toEqual([selectedId])
    const research = researchFromResponse(researchFixture(), now)
    const plan: z.infer<typeof editorialPlanSchema> = editorialFixture()
    plan.slots[0]!.requiredAssetId = selectedId
    expect(validateEditorialPlan(plan, evidence, research, '2026-09', 1).slots[0]).toMatchObject({
      requiredAssetId: selectedId,
    })
    plan.slots[0]!.requiredAssetId = null
    expect(() => validateEditorialPlan(plan, evidence, research, '2026-09', 1)).toThrow(
      'PHOTO_SELECTION_MISSING',
    )
  })
  it('rejects a planner slot after the custom package period ends', () => {
    const evidence = plannerEvidence(createDemo(), now)
    const research = researchFromResponse(researchFixture(), now)
    const plan = editorialFixture()
    plan.slots[0]!.day = 26

    expect(() =>
      validateEditorialPlan(plan, evidence, research, '2026-09', 1, '2026-09-25'),
    ).toThrow('INVALID_SLOT_DATE')
  })
  it('downgrades an unsupported claimed timing hour to truthful no_data', () => {
    const workspace = createDemo()
    const evidence = plannerEvidence(workspace, now, '2026-09', undefined, [
      {
        publishedAt: '2026-09-01T08:00:00.000Z',
        channel: 'Instagram',
        source: 'social',
      },
    ])
    const research = researchFromResponse(researchFixture(), now)
    const plan = editorialFixture()
    plan.slots[0]!.time = '17:00'
    plan.slots[0]!.timingBasis = 'social_history'
    const normalized = normalizeEditorialPlanResponse(plan, evidence, research, 1, '2026-09')
    expect(normalized.slots[0]!.timingBasis).toBe('no_data')
    expect(normalized.slots[0]!.timingRationale).toContain('Nuk ka të dhëna')
    expect(() => validateEditorialPlan(normalized, evidence, research, '2026-09', 1)).not.toThrow()
  })
  it('fails closed when provider configuration is incomplete', () => {
    vi.stubEnv('AI_MONTHLY_PLANNER_ENABLED', 'true')
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(monthlyAiConfigured()).toBe(false)
    expect(monthlyPlannerReadiness(true)).toBe('misconfigured')
  })
  it('does not report automatic planning ready without a live worker', () => {
    vi.stubEnv('AI_MONTHLY_PLANNER_ENABLED', 'false')
    expect(monthlyPlannerReadiness(false)).toBe('disabled')
    vi.stubEnv('AI_MONTHLY_PLANNER_ENABLED', 'true')
    vi.stubEnv('OPENAI_API_KEY', 'fixture-key')
    vi.stubEnv('AI_PLANNER_MODEL', 'fixture-model')
    vi.stubEnv('AI_IMAGE_MODEL', 'fixture-image-model')
    vi.stubEnv('AI_IMAGE_QUALITY', 'high')
    vi.stubEnv('AI_IMAGE_RESERVE_MICRO_EUR', '1')
    vi.stubEnv('AI_USD_MICRO_EUR', '1')
    vi.stubEnv('AI_PLANNER_INPUT_MICRO_EUR_PER_MILLION_TOKENS', '1')
    vi.stubEnv('AI_PLANNER_OUTPUT_MICRO_EUR_PER_MILLION_TOKENS', '1')
    vi.stubEnv('AI_WEB_SEARCH_MICRO_EUR_PER_CALL', '1')
    vi.stubEnv('AI_DAILY_BUDGET_MICRO_EUR', '1')
    vi.stubEnv('AI_PLANNER_MONTHLY_BUDGET_MICRO_EUR', '1')
    expect(monthlyPlannerReadiness(false)).toBe('unavailable')
    expect(monthlyPlannerReadiness(true)).toBe('ready')
  })
  it('keeps real provider citations and rejects invented search claims', () => {
    const response = researchFixture()
    expect(researchFromResponse(response, now).sources[0]!.url).toBe(
      'https://example.test/local-market',
    )
    response.output = response.output.filter((item) => item.type !== 'web_search_call')
    expect(() => researchFromResponse(response, now)).toThrow('RESEARCH_SOURCES_REQUIRED')
  })
  it('accepts OpenRouter search usage and nested citation annotations', () => {
    const response = researchFixture()
    response.usage.server_tool_use = { web_search_requests: 1 }
    response.output = response.output.filter((item) => item.type !== 'web_search_call')
    const annotation = response.output[0]!.content![0]!.annotations![0]!
    annotation.url_citation = {
      url: annotation.url!,
      title: annotation.title,
      start_index: annotation.start_index,
      end_index: annotation.end_index,
    }
    annotation.url = undefined
    expect(researchFromResponse(response, now).sources[0]!.url).toBe(
      'https://example.test/local-market',
    )
  })
  it('rejects research without inline citations and unsafe citation protocols', () => {
    const response = researchFixture()
    response.output[1]!.content![0]!.annotations![0]!.url = 'javascript:alert(1)'
    expect(() => researchFromResponse(response, now)).toThrow('RESEARCH_SOURCES_REQUIRED')
  })
  it('rejects unverified fact IDs, invented sources, duplicate slots and impossible days', () => {
    const evidence = plannerEvidence(createDemo(), now)
    const research = researchFromResponse(researchFixture(), now)
    const plan = editorialFixture()
    expect(validateEditorialPlan(plan, evidence, research, '2026-09', 1).slots).toHaveLength(1)
    expect(
      validateEditorialPlan(
        {
          ...plan,
          slots: [
            {
              ...plan.slots[0],
              sourceUrls: ['https://example.test/local-market/?utm_source=ai#section'],
            },
          ],
        },
        evidence,
        research,
        '2026-09',
        1,
      ).slots,
    ).toHaveLength(1)
    for (const changes of [
      { factIds: ['f3'] },
      { sourceUrls: ['https://invented.test'] },
      { day: 31 },
      { day: 1 },
    ]) {
      expect(() =>
        validateEditorialPlan(
          { ...plan, slots: [{ ...plan.slots[0], ...changes }] },
          evidence,
          research,
          '2026-09',
          1,
        ),
      ).toThrow()
    }
    expect(() =>
      validateEditorialPlan(
        { ...plan, slots: [plan.slots[0], plan.slots[0]] },
        evidence,
        research,
        '2026-09',
        2,
      ),
    ).toThrow('REPETITIVE_PLAN')
  })
  it('repairs provider-only contract noise without weakening factual grounding', () => {
    const evidence = plannerEvidence(createDemo(), now)
    const research = researchFromResponse(researchFixture(), now)
    const plan = editorialFixture()
    const repaired = normalizeEditorialPlanResponse(
      {
        ...plan,
        slots: [
          {
            ...plan.slots[0],
            factIds: ['f2', randomUUID()],
            sourceUrls: ['https://example.test/local-market/?utm_source=model#result'],
          },
          { ...plan.slots[0], day: 16, topic: 'Extra provider slot', hook: 'Extra hook' },
        ],
      },
      evidence,
      research,
      1,
    )
    expect(repaired.slots).toHaveLength(1)
    expect(repaired.slots[0]).toMatchObject({
      factIds: ['f2'],
      sourceUrls: ['https://example.test/local-market'],
      requiredAssetId: null,
    })
    expect(validateEditorialPlan(repaired, evidence, research, '2026-09', 1).slots).toHaveLength(1)
  })
  it('requires a varied editorial rhythm and hydrates already-stored legacy plans', () => {
    const evidence = plannerEvidence(createDemo(), now)
    const research = researchFromResponse(researchFixture(), now)
    const base = editorialFixture()
    const intents = [
      'educate',
      'inspire',
      'trust',
      'conversation',
      'product',
      'conversion',
    ] as const
    const layouts = intents.map(
      (_, index) =>
        `Original photo-specific art direction ${index + 1} with a distinct crop, hierarchy and lighting treatment.`,
    )
    const algorithmGoals = [
      'watch_time',
      'saves',
      'shares',
      'meaningful_comments',
      'profile_actions',
      'clicks',
    ] as const
    const slots = intents.map((intent, index) => ({
      ...base.slots[0],
      day: 15 + index,
      topic: `Distinct editorial topic ${index + 1}`,
      hook: `Distinct audience hook number ${index + 1}`,
      pillar: ['Product', 'People', 'Education'][index % 3]!,
      intent,
      visualLayout: layouts[index]!,
      algorithmGoal: algorithmGoals[index]!,
    }))
    expect(
      validateEditorialPlan({ ...base, slots }, evidence, research, '2026-09', 6).slots,
    ).toHaveLength(6)
    expect(() =>
      validateEditorialPlan(
        {
          ...base,
          slots: slots.map((slot, index) => ({
            ...slot,
            intent: index % 2 ? 'inspire' : 'educate',
          })),
        },
        evidence,
        research,
        '2026-09',
        6,
      ),
    ).toThrow('REPETITIVE_PLAN')

    const legacySlot = { ...base.slots[0] } as Record<string, unknown>
    delete legacySlot.intent
    delete legacySlot.hook
    delete legacySlot.assetDirection
    delete legacySlot.visualLayout
    expect(parsePersistedEditorialPlan({ ...base, slots: [legacySlot] }).slots[0]).toMatchObject({
      intent: 'educate',
      visualLayout: 'Drejtim vizual origjinal i përshtatur për idenë editoriale 1.',
    })
  })
  it('selects the business month independently of the server timezone', () => {
    expect(planningMonth('Europe/Tirane', new Date('2026-08-31T22:30:00Z'))).toBe('2026-09')
  })
  it('resolves future access only from an entitlement covering the full month', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('FROM subscriptions') || sql.includes('FROM custom_packages')
        ? { rows: [] }
        : {
            rows: [
              {
                features: ['posts', 'ai'],
                limits: {
                  posts_per_month: 30,
                  ai_requests_per_day: 30,
                  media_storage_bytes: 1073741824,
                  social_accounts: 2,
                  members: 1,
                },
                plan_name: 'Përditë',
                plan_version: 1,
                valid_until: new Date('2026-11-01T00:00:00.000Z'),
              },
            ],
          },
    )
    const access = await paidAccessForPlanningMonth(randomUUID(), '2026-10', { query } as never)
    const entitlementCall = query.mock.calls.find(([sql]) => sql.includes('FROM entitlements'))
    expect((entitlementCall as unknown as [string, unknown[]])[1].slice(1)).toEqual([
      '2026-10-01',
      '2026-11-01',
    ])
    expect(access).toMatchObject({
      paid: true,
      features: ['posts', 'ai'],
      limits: { posts_per_month: 30 },
      plan: { name: 'Përditë', version: 1 },
    })
  })
  it('exports provider-compatible structured contracts', () => {
    expect(z.toJSONSchema(generatedPostSchema).additionalProperties).toBe(false)
    expect(z.toJSONSchema(editorialPlanSchema).type).toBe('object')
    expect(JSON.stringify(aiProviderJsonSchema(z.toJSONSchema(generatedPostSchema)))).not.toContain(
      'pattern',
    )
  })
})
function imagePromptInput() {
  return {
    brand: { name: 'Aurum', industry: 'Restaurant', audience: 'Mysafirë në Prishtinë' },
    creative: {
      headline: 'Darka fillon këtu',
      eyebrow: 'Aurum Restaurant',
      cta: 'Ruaje për sonte',
      layout: 'A close detail of the plated main course, anchored low on the left.',
    },
    slot: {
      channel: 'Instagram' as const,
      topic: 'Darka',
      intent: 'inspiration',
      hook: 'Atmosferë e ngrohtë',
      purpose: 'Të tregojë eksperiencën',
      assetDirection: 'Ambient real në mbrëmje',
      visualLayout: 'A close detail of the plated main course, anchored low on the left.',
      algorithmGoal: 'saves',
    },
  }
}
describe('AI creative generation', () => {
  it('builds full AI art direction and platform-specific edit instructions', () => {
    const creative = {
      headline: 'Darka fillon këtu',
      eyebrow: 'Aurum Restaurant',
      cta: 'Ruaje për sonte',
      layout: 'An original warm evening composition built around the real dining room.',
    }
    const monthly = monthlyImagePrompt({
      brand: { name: 'Aurum', industry: 'Restaurant', audience: 'Mysafirë në Prishtinë' },
      creative,
      slot: {
        channel: 'Instagram',
        topic: 'Darka',
        intent: 'inspiration',
        hook: 'Atmosferë e ngrohtë',
        purpose: 'Të tregojë eksperiencën',
        assetDirection: 'Ambient real në mbrëmje',
        visualLayout: 'Build an original warm evening composition around the real dining room.',
        algorithmGoal: 'saves',
      },
    })
    expect(monthly).toContain('complete, original, premium 4:5 social-media post')
    expect(monthly).toContain(creative.headline)
    expect(monthly).toContain('no application template or hard-coded layout')
    expect(monthly).toContain('You are solely responsible for the final visual design')
    expect(monthly).toContain('centre-crops it to the final Instagram/Facebook feed image')
    expect(monthly).toContain('malformed hands or faces')
    expect(monthly).toContain('giant expressive typographic gesture')
    expect(monthly).toContain('clean contemporary sans-serif')
    expect(monthly).toContain('8-point spacing rhythm')
    expect(monthly).toContain('correct Albanian diacritics')

    const edited = postImageEditPrompt({
      brand: {
        name: 'Aurum',
        industry: 'Restaurant',
        audience: 'Mysafirë në Prishtinë',
        voice: 'Elegant',
      },
      post: {
        channel: 'Instagram',
        title: 'Darka',
        caption: 'Një mbrëmje në Aurum.',
        pillar: 'experience',
        creative,
        rationale: 'Strategjia e hulumtuar për audiencën lokale.',
      },
      instruction: 'Shto dritë të ngrohtë dhe ruaje lokalin real.',
    })
    expect(edited).toContain('current post image')
    expect(edited).toContain('Instagram feed')
    expect(edited).toContain('Shto dritë të ngrohtë')
    expect(edited).toContain('center-cropped to the final 1080x1350')
    expect(edited).toContain('Never duplicate, fuse, warp, replace or invent material objects')
    expect(edited).toContain('typographic designer')
    expect(edited).toContain('no more than two weights')
  })

  it('states a crop contract derived from the real output canvas', () => {
    const geometry = feedCreativeGeometry()
    const prompt = monthlyImagePrompt(imagePromptInput())

    // The centre crop from a taller provider canvas removes height only, so a
    // width bleed would wrongly narrow every composition.
    expect(geometry.discardedWidthPerSide).toBe('0%')
    expect(prompt).toContain(`portrait ${geometry.providerRatio} canvas`)
    expect(prompt).toContain(`exactly ${geometry.finalPixels} (${geometry.finalRatio})`)
    expect(prompt).toContain(
      `The outer ${geometry.discardedHeightPerSide} of the height at the top and at the bottom is discarded bleed`,
    )
    expect(prompt).toContain(
      `inside the central ${geometry.safeWidth} of the width and the central ${geometry.safeHeight} of the height`,
    )
    expect(prompt).toContain('No text may touch or approach an outer edge')
    expect(prompt).not.toContain('central 88%')
  })

  it('ranks the slot visual direction above general design guidance', () => {
    const prompt = monthlyImagePrompt(imagePromptInput())

    expect(prompt).toContain('Instruction priority')
    // Business guardrails already override everything else in this prompt.
    expect(prompt).toContain('(0) the absolute restrictions set by this business')
    expect(prompt).toContain('(1) the factual truth and identity of the source photograph')
    expect(prompt).toContain('(2) the photo-specific art direction and unique visual direction')
    expect(prompt).toContain('A general rule never overrides the visual direction')
    expect(prompt).toContain('execution contract, not as inspiration')
    expect(prompt).toContain('which zone is reserved for type')
    expect(prompt).toContain('which zone stays as negative space')
    expect(prompt).toContain('generic social-media composition is a failure')
  })

  it('makes a dominant subject conditional on the slot direction', () => {
    const prompt = monthlyImagePrompt(imagePromptInput())

    expect(prompt).toContain('render the whole subject dominant only when the direction asks for')
    expect(prompt).toContain('without enlarging the subject back into a full view')
    expect(prompt).toContain('never add a second vehicle or product')
    expect(prompt).toContain('a reflected or mirrored duplicate')
    // The earlier blanket prominence rule contradicted every detail-crop slot.
    expect(prompt).not.toContain('visually prominent enough to remain the focal subject')
  })

  it('constrains copy fit, invented facts and repeated composition', () => {
    const prompt = monthlyImagePrompt(imagePromptInput())

    expect(prompt).toContain('complete and unabbreviated')
    expect(prompt).toContain(
      'If the call to action cannot be set completely, legibly and safely inside the safe region, leave it out of the image',
    )
    expect(prompt).toContain('the caption still carries it in full')
    expect(prompt).toContain('at most two weights')
    expect(prompt).toContain('never imply that a document, permit or condition is required')
    expect(prompt).toContain('Never generate a new number plate')
    expect(prompt).toContain('noise reduction and plausible non-material background extension remain allowed')
    expect(prompt).toContain('Changed copy does not make a post distinct')
    expect(prompt).toContain(
      'a large headline across the top with the full subject along the bottom',
    )
    expect(prompt).toContain('Then silently verify, before returning')
    expect(prompt).toContain('do not describe this check')
  })

  it('keeps added elements out of the reserved text zone', () => {
    const prompt = monthlyImagePrompt(imagePromptInput())

    expect(prompt).toContain(
      'never fill a reserved text zone or its negative space with an added element',
    )
    expect(prompt).toContain(
      'A typographic gesture never grows until the real subject becomes secondary',
    )
  })

  it('asks the strategy and content stages for renderable direction and copy', () => {
    expect(monthlyInstructions.planning).toContain('state explicitly whether it appears in full')
    expect(monthlyInstructions.planning).toContain('which zone of the frame is reserved for type')
    expect(monthlyInstructions.planning).toContain('at least one explicit "do not"')
    expect(monthlyInstructions.planning).toContain(
      'so general that it could be pasted onto another slot',
    )
    expect(monthlyInstructions.content).toContain('Treat creative.cta as image copy')
    expect(monthlyInstructions.content).toContain('carry the full detail in the caption instead')
    expect(monthlyInstructions.content).toContain('Never introduce a required document')
    // The quality rubric stays exactly as it is.
    expect(monthlyInstructions.quality).toContain(
      'You are an exacting independent creative director and fact reviewer.',
    )
  })

  it('normalizes the AI result technically without applying a design preset', async () => {
    const photo = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#236052' },
    })
      .jpeg()
      .toBuffer()
    const sheet = await assetContactSheet([{ id: randomUUID(), bytes: photo }])
    expect(await sharp(sheet).metadata()).toMatchObject({ width: 1000, height: 230 })
    const normalized = await normalizeGeneratedCreative(photo)
    expect(await sharp(normalized).metadata()).toMatchObject({
      width: 1080,
      height: 1350,
      format: 'jpeg',
    })
  })

  it('removes a connected light logo background but keeps the logo artwork', async () => {
    const logo = await sharp({
      create: { width: 120, height: 60, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: {
            create: { width: 60, height: 24, channels: 3, background: '#57210f' },
          },
          left: 30,
          top: 18,
        },
      ])
      .png()
      .toBuffer()
    const transparent = await removeLogoBackground(logo)
    const { data, info } = await sharp(transparent)
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    expect(data[3]).toBe(0)
    expect(data[(30 * info.width + 45) * info.channels + 3]).toBe(255)
  })
})

describe('monthly planner source photos', () => {
  it('hydrates a real JPEG stored in Supabase Storage for model input', async () => {
    const photo = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#236052' },
    })
      .jpeg()
      .toBuffer()
    const assetId = randomUUID()
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: assetId,
          bytes: null,
          storage_path: 'uji-rugova-business/photo_20260909T142337481Z.jpg',
          size_bytes: photo.length,
        },
      ],
    })
    const download = vi.fn().mockResolvedValue(photo)

    const assets = await loadPlannerAssets({ query } as never, 'business-id', [assetId], download)

    expect(query.mock.calls[0]![0]).toContain('storage_path')
    expect(query.mock.calls[0]![0]).toContain('bytes IS NOT NULL OR storage_path IS NOT NULL')
    expect(download).toHaveBeenCalledWith(
      'uji-rugova-business/photo_20260909T142337481Z.jpg',
      2097152,
    )
    expect(assets).toEqual([{ id: assetId, bytes: photo }])
    expect(await sharp(assets[0]!.bytes).metadata()).toMatchObject({
      width: 800,
      height: 600,
      format: 'jpeg',
    })
  })

  it('rejects Storage metadata above the image input limit before downloading', async () => {
    const assetId = randomUUID()
    const download = vi.fn()
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: assetId,
          bytes: null,
          storage_path: 'uji-rugova-business/too-large.jpg',
          size_bytes: 2097153,
        },
      ],
    })

    await expect(
      loadPlannerAssets({ query } as never, 'business-id', [assetId], download),
    ).rejects.toThrow('OWNED_PHOTOS_REQUIRED')
    expect(download).not.toHaveBeenCalled()
  })

  it('cleans already downloaded source buffers when a later Storage asset fails', async () => {
    const firstAsset = randomUUID()
    const secondAsset = randomUUID()
    const firstPhoto = Buffer.from([255, 216, 255, 217])
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: firstAsset,
          bytes: null,
          storage_path: 'business/first.jpg',
          size_bytes: firstPhoto.length,
        },
        {
          id: secondAsset,
          bytes: null,
          storage_path: 'business/missing.jpg',
          size_bytes: firstPhoto.length,
        },
      ],
    })
    const download = vi
      .fn()
      .mockResolvedValueOnce(firstPhoto)
      .mockRejectedValueOnce(new Error('Storage unavailable'))

    await expect(
      loadPlannerAssets({ query } as never, 'business-id', [firstAsset, secondAsset], download),
    ).rejects.toThrow('Storage unavailable')
    expect(firstPhoto).toEqual(Buffer.alloc(firstPhoto.length))
  })
})

describe('event research window', () => {
  const zone = 'Europe/Belgrade'
  const period = (startsAt: string, endsAt: string) => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  })

  it('covers the whole month when the plan has no package window', () => {
    expect(packageMonthWindow('2026-11', undefined)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      bounded: false,
    })
  })

  it('intersects a package bought mid-month with the month', () => {
    // Bought on 30 October, valid to 30 November: November is covered whole,
    // October only from the purchase day on.
    const quota = period('2026-10-30T00:00:00Z', '2026-11-30T00:00:00Z')
    expect(packageMonthWindow('2026-11', quota)).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-29',
    })
    expect(packageMonthWindow('2026-10', quota)).toMatchObject({
      from: '2026-10-30',
      to: '2026-10-31',
    })
  })

  it('researches the days that are both paid for and still publishable', () => {
    const quota = period('2026-10-30T00:00:00Z', '2026-12-01T00:00:00Z')
    // Planning on 1 November: the 28 November holiday is inside the window.
    expect(eventResearchWindow('2026-11', quota, zone, '2026-11-01T09:00:00Z')).toEqual({
      from: '2026-11-02',
      to: '2026-11-30',
    })
    // Planning on 28 November: the holiday is already unpublishable, so it is
    // outside the window the research is given.
    const late = eventResearchWindow('2026-11', quota, zone, '2026-11-28T09:00:00Z')
    expect(late).toEqual({ from: '2026-11-29', to: '2026-11-30' })
    expect(late!.from > '2026-11-28').toBe(true)
  })

  it('returns no window when nothing of the month remains', () => {
    const quota = period('2026-10-30T00:00:00Z', '2026-12-01T00:00:00Z')
    expect(eventResearchWindow('2026-11', quota, zone, '2026-11-30T09:00:00Z')).toBeNull()
  })

  it('never reaches past the end of the paid period', () => {
    const quota = period('2026-10-30T00:00:00Z', '2026-11-15T00:00:00Z')
    expect(eventResearchWindow('2026-11', quota, zone, '2026-11-01T09:00:00Z')).toEqual({
      from: '2026-11-02',
      to: '2026-11-14',
    })
  })
})

describe('research occasions', () => {
  const sources = new Map([
    ['https://example.org/kalendari', { url: 'https://example.org/kalendari', title: 'Kalendari' }],
  ])
  const window = {
    from: '2026-11-02',
    to: '2026-11-30',
    categories: ['publicEvents', 'seasonalEvents', 'industryTrends'],
  }
  const block = (occasions: unknown) =>
    `Raporti.

\`\`\`json
${JSON.stringify({ occasions })}
\`\`\``
  const occasion = (overrides: Record<string, unknown> = {}) => ({
    date: '2026-11-28',
    name: 'Dita e Flamurit',
    category: 'publicEvents',
    relevance: 'Festë kombëtare me trafik të lartë.',
    sourceUrl: 'https://example.org/kalendari',
    ...overrides,
  })

  it('lifts the occasions out and leaves the prose for the customer', () => {
    const result = researchOccasionsFromText(block([occasion()]), sources, window)
    expect(result.text).toBe('Raporti.')
    expect(result.occasions).toHaveLength(1)
    expect(result.occasions[0]!.date).toBe('2026-11-28')
  })

  it('drops an occasion outside the granted window', () => {
    const result = researchOccasionsFromText(block([occasion({ date: '2026-12-25' })]), sources, window)
    expect(result.occasions).toEqual([])
  })

  it('drops an occasion in a category the business did not permit', () => {
    const result = researchOccasionsFromText(block([occasion()]), sources, {
      ...window,
      categories: ['seasonalEvents'],
    })
    expect(result.occasions).toEqual([])
  })

  it('keeps an occasion whose source differs only by tracking parameters', () => {
    // Search returns the URL with utm parameters; the model echoes it without
    // them. They are the same source.
    const tracked = new Map([
      [
        'https://example.org/kalendari?utm_source=openai',
        { url: 'https://example.org/kalendari?utm_source=openai', title: 'Kalendari' },
      ],
    ])
    const result = researchOccasionsFromText(block([occasion()]), tracked, window)
    expect(result.occasions).toHaveLength(1)
  })

  it('drops an occasion cited to a source the search never returned', () => {
    const result = researchOccasionsFromText(
      block([occasion({ sourceUrl: 'https://elsewhere.example/invented' })]),
      sources,
      window,
    )
    expect(result.occasions).toEqual([])
  })

  it('keeps the paid report when the block is malformed', () => {
    const text = ['Raporti.', '', '```json', '{not json', '```'].join('\n')
    const result = researchOccasionsFromText(text, sources, window)
    expect(result.text).toBe('Raporti.')
    expect(result.occasions).toEqual([])
  })

  it('reports none when the permission was never granted', () => {
    const result = researchOccasionsFromText(block([occasion()]), sources, undefined)
    expect(result.occasions).toEqual([])
  })

  it('leaves a report without a block untouched', () => {
    const result = researchOccasionsFromText('Vetëm prozë.', sources, window)
    expect(result.text).toBe('Vetëm prozë.')
    expect(result.occasions).toEqual([])
  })
})

describe('requested platforms', () => {
  it('offers exactly the two platforms a post can be planned for', () => {
    expect([...plannerChannels].sort()).toEqual(['Facebook', 'Instagram'])
  })

  it('keeps a split that accounts for every requested post', () => {
    expect(normalizedChannelCounts({ Instagram: 2, Facebook: 1 }, 3)).toEqual({
      Instagram: 2,
      Facebook: 1,
    })
  })

  it('drops the platforms that were given no posts', () => {
    expect(normalizedChannelCounts({ Instagram: 3, Facebook: 0 }, 3)).toEqual({ Instagram: 3 })
  })

  it('rejects a split that does not add up to the request', () => {
    expect(() => normalizedChannelCounts({ Instagram: 1, Facebook: 1 }, 3)).toThrow(PlannerFailure)
    expect(() => normalizedChannelCounts({ Instagram: 4 }, 3)).toThrow(PlannerFailure)
  })

  it('rejects a fractional or negative share', () => {
    expect(() => normalizedChannelCounts({ Instagram: -1, Facebook: 4 }, 3)).toThrow(PlannerFailure)
    expect(() => normalizedChannelCounts({ Instagram: 1.5, Facebook: 1.5 }, 3)).toThrow(
      PlannerFailure,
    )
  })

  it('treats no split as no restriction', () => {
    expect(normalizedChannelCounts(undefined, 3)).toEqual({})
    expect(normalizedChannelCounts({}, 3)).toEqual({})
    expect(channelCountsTotal({})).toBe(0)
  })

  it('names the single platform when a split leaves only one', () => {
    expect(soleChannel({ Instagram: 3 })).toBe('Instagram')
    expect(soleChannel({ Instagram: 2, Facebook: 1 })).toBeUndefined()
    expect(soleChannel({})).toBeUndefined()
  })
})
