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
} from '../../server/utils/monthly-planner-domain'
import {
  monthlyAiConfigured,
  monthlyPlannerReadiness,
  researchFromResponse,
  retryableProviderFailureCode,
  providerHttpFailure,
  monthlyImagePrompt,
  monthlyAutomaticStageKey,
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
    expect(retryableProviderFailureCode('PROVIDER_RATE_LIMITED')).toBe(true)
    expect(retryableProviderFailureCode('CONFIGURATION_REQUIRED')).toBe(true)
    expect(retryableProviderFailureCode('PROVIDER_TEMPORARY')).toBe(true)
    expect(retryableProviderFailureCode('PROVIDER_UNCERTAIN')).toBe(false)
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
      sql.includes('FROM subscriptions')
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
    expect(monthly).toContain('center-cropped to the final Instagram/Facebook feed canvas')
    expect(monthly).toContain('central 88%')
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
