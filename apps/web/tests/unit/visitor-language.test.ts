import { describe, expect, it } from 'vitest'
import { researchFromResponse, type ProviderResponse } from '../../server/utils/monthly-ai'
import { plannerChannelCountsSchema, plannerFailureCode, PlannerFailure, repairedFactId, withGroundedSlotLanguages } from '../../server/utils/monthly-planner-domain'
import { audienceLanguageFromResearch } from '../../server/utils/audience-language'
import { researchSchema, slotBriefSchema } from '../../shared/schemas/monthly-plan'

const now = new Date('2026-10-01T08:00:00Z')
const market = 'https://example.test/local-market'
const festival = 'https://example.test/festival'
const window = { from: '2026-10-02', to: '2026-10-31', categories: ['publicEvents'] }

function response(block: unknown): ProviderResponse {
  const prose = 'Observed context [1] and festival [2]'
  return {
    id: 'visitor-fixture',
    status: 'completed',
    usage: { input_tokens: 10, output_tokens: 10 },
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [
            { url: market, title: 'Local market' },
            { url: festival, title: 'Festival' },
          ],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: `${prose}\n\`\`\`json\n${JSON.stringify(block)}\n\`\`\``,
            annotations: [
              { type: 'url_citation', url: market, title: 'Local market', start_index: 17, end_index: 20 },
            ],
          },
        ],
      },
    ],
  }
}
const language = {
  locale: 'sq-XK',
  audienceSummary: 'Coffee lovers in Prishtina',
  rationale: 'The declared audience is local and writes Albanian.',
  confidence: 0.95,
}
const visitorAudience = {
  locale: 'en-US',
  summary: 'Foreign visitors at the coffee festival',
  rationale: 'The organiser publishes the programme in English for foreign guests.',
  sourceUrl: festival,
  confidence: 0.8,
}
const occasion = {
  date: '2026-10-20',
  name: 'Coffee Festival',
  category: 'publicEvents',
  relevance: 'Draws coffee lovers and visitors.',
  sourceUrl: festival,
  visitorFacing: true,
}

describe('visitor audience research', () => {
  it('keeps a cited visitor audience and the occasions it covers', () => {
    const research = researchFromResponse(
      response({ language, visitorAudience, occasions: [occasion] }),
      now,
      window,
      'en-US',
    )
    expect(research.visitorAudience?.locale).toBe('en-US')
    expect(research.occasions[0]?.visitorFacing).toBe(true)
  })
  it('drops a visitor audience whose source the search never returned', () => {
    const research = researchFromResponse(
      response({
        language,
        visitorAudience: { ...visitorAudience, sourceUrl: 'https://example.test/guess' },
        occasions: [occasion],
      }),
      now,
      window,
      'en-US',
    )
    expect(research.visitorAudience).toBeUndefined()
    expect(research.occasions[0]?.visitorFacing).toBe(false)
  })
  it('drops a visitor audience that speaks the plan language', () => {
    const research = researchFromResponse(
      response({ language, visitorAudience: { ...visitorAudience, locale: 'sq-XK' }, occasions: [occasion] }),
      now,
      window,
      'en-US',
    )
    expect(research.visitorAudience).toBeUndefined()
  })
  it('keeps the plan language when the visitor audience is malformed', () => {
    const research = researchFromResponse(
      response({ language, visitorAudience: { locale: 'en-US' }, occasions: [occasion] }),
      now,
      window,
      'en-US',
    )
    expect(research.language?.locale).toBe('sq-XK')
    expect(research.visitorAudience).toBeUndefined()
  })
})

describe('slot languages', () => {
  const research = researchSchema.parse({
    text: 'Report',
    sources: [
      { url: market, title: 'Local market' },
      { url: festival, title: 'Festival' },
    ],
    citations: [],
    occasions: [occasion],
    language,
    visitorAudience,
    researchedAt: now.toISOString(),
  })
  const slot = (overrides: Record<string, unknown> = {}) => ({
    day: 18,
    sourceUrls: [festival],
    locale: 'en-US' as string | null,
    languageRationale: 'Visitors at the festival need directions in English.' as string | null,
    ...overrides,
  })

  it('keeps a visitor language for a post about a visitor-facing occasion', () => {
    expect(withGroundedSlotLanguages([slot()], research, '2026-10')[0]?.locale).toBe('en-US')
  })
  it.each([
    ['dated after the occasion', { day: 21 }],
    ['not citing the occasion', { sourceUrls: [market] }],
    ['in a language the visitors do not read', { locale: 'de-CH' }],
    ['without a reason', { languageRationale: ' ' }],
  ])('returns a post %s to the plan language', (_, overrides) => {
    const [result] = withGroundedSlotLanguages([slot(overrides)], research, '2026-10')
    expect(result).toMatchObject({ locale: null, languageRationale: null })
  })
  it('gives each occasion at most one visitor-language post', () => {
    const result = withGroundedSlotLanguages([slot(), slot({ day: 19 })], research, '2026-10')
    expect(result.map((item) => item.locale)).toEqual(['en-US', null])
  })
  it('never leaves the plan language without a visitor audience', () => {
    const local = { ...research, visitorAudience: undefined }
    expect(withGroundedSlotLanguages([slot()], local, '2026-10')[0]?.locale).toBeNull()
  })
  it('reads older slots as speaking the plan language', () => {
    const parsed = slotBriefSchema.parse({
      day: 18,
      time: '10:00',
      channel: 'Instagram',
      topic: 'Morning coffee',
      pillar: 'Product',
      intent: 'educate',
      hook: 'Why this coffee?',
      purpose: 'Explain the real product.',
      assetDirection: 'Use the clearest product photo.',
      visualLayout: 'Cup in the centre with window light.',
      algorithmGoal: 'saves',
      platformRationale: 'Instagram suits a saved product story.',
      timingRationale: 'No observed timing data for this hour.',
      factIds: ['f1'],
      sourceUrls: [market],
      requiredAssetId: null,
    })
    expect(parsed).toMatchObject({ locale: null, languageRationale: null })
  })
})

describe('post language', () => {
  it('keeps the language a post was written in over the plan decision', () => {
    expect(audienceLanguageFromResearch({ language }, 'de-CH', 'en-US')).toBe('en-US')
  })
})

describe('fact id repair', () => {
  const fact = '52e1b0bf-61d1-4366-9525-a26dddf1cbf7'
  it('repairs a fact id copied with one character missing', () => {
    expect(repairedFactId('52e1b0bf-61d-4366-9525-a26dddf1cbf7', new Set([fact]))).toBe(fact)
  })
  it('leaves a fact id that is not close to a known one', () => {
    expect(repairedFactId('00000000-0000-4000-8000-000000000000', new Set([fact]))).toBeUndefined()
  })
  it('never repairs short ids, which differ by one character by design', () => {
    expect(repairedFactId('f9', new Set(['f2']))).toBeUndefined()
  })
})

describe('planner channel split', () => {
  it('keeps every planner channel in the requested split', () => {
    expect(plannerChannelCountsSchema.parse({ Facebook: 1, TikTok: 1 })).toEqual({ Facebook: 1, TikTok: 1 })
  })
})

describe('planner failure reasons', () => {
  it('keeps the reason of a shared request error the planner has a message for', () => {
    expect(plannerFailureCode(new Error('server.CREDITS_EXHAUSTED'))).toBe('CREDITS_EXHAUSTED')
  })
  it('keeps a planner failure code', () => {
    expect(plannerFailureCode(new PlannerFailure('QUOTA_EXCEEDED'))).toBe('QUOTA_EXCEEDED')
  })
  it('falls back to a generic failure for an unknown error', () => {
    expect(plannerFailureCode(new Error('boom'))).toBe('GENERATION_FAILED')
  })
})
