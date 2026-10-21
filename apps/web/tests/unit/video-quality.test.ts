import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewVideoQuality } from '../../server/utils/video-subject-check'

vi.mock('../../server/utils/ai-provider', () => ({
  aiProviderConfiguration: () => ({ name: 'openai', responsesUrl: 'https://example.test/responses', headers: {} }),
  aiProviderJsonSchema: (schema: unknown) => schema,
  aiProviderModel: () => 'review-model',
  aiProviderStructuredRouting: () => ({}),
}))

afterEach(() => vi.unstubAllGlobals())

describe('reviewVideoQuality', () => {
  it('sends the original and finished video frames to QA and returns its criticism', async () => {
    const response = {
      id: 'response-1',
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 50 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        decision: 'WARN',
        reasons: ['The overlay obscures the main subject.'],
        factuality: true,
        brandFit: true,
        visualQuality: false,
      }) }] }],
    }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetcher)

    const { quality } = await reviewVideoQuality({
      photograph: Buffer.from('photo'),
      frames: [Buffer.from('first'), Buffer.from('last')],
      caption: 'Caption',
      brandName: 'Brand',
      locale: 'en-US',
      verifiedFacts: ['Verified fact'],
      targetChannel: 'Instagram',
    })

    expect(quality.decision).toBe('WARN')
    expect(quality.reasons).toContain('The overlay obscures the main subject.')
    const request = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(request.input[0].content.filter((part: { type: string }) => part.type === 'input_image')).toHaveLength(3)
    expect(request.input[0].content[0].text).toContain('Verified fact')
  })

  it('reviews a video against the same commitments as a still image, and reports its cost', async () => {
    const response = {
      id: 'response-2',
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 50, cost: 0.003 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        decision: 'PASS', reasons: [], factuality: true, brandFit: true, visualQuality: true,
      }) }] }],
    }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetcher)
    const review = await reviewVideoQuality({
      photograph: Buffer.from('photo'),
      frames: [Buffer.from('first')],
      caption: 'Caption',
      brandName: 'Brand',
      locale: 'sq-XK',
      verifiedFacts: [],
      targetChannel: 'TikTok',
      context: {
        businessBrain: '{"voice":"calm"}',
        guardrails: ['No speed claims.'],
        approvedCopy: { headline: 'Udhëtimi fillon', cta: 'Rezervo sot' },
        storyboard: {
          concept: 'An arrival and a reveal of the real car.',
          rationale: 'Premium launch for a rental fleet.',
          cta: 'Rezervo sot',
          caption: 'Rezervo sot.',
          shots: [],
        },
      },
    })
    expect(review.costUsd).toBeCloseTo(0.003)
    const request = JSON.parse(fetcher.mock.calls[0]![1].body)
    const payload = JSON.parse(request.input[0].content[0].text)
    expect(payload.channelFrame).toMatchObject({ ratio: '9:16', coveredByInterface: { bottom: '25%' } })
    expect(payload.restrictions).toEqual(['No speed claims.'])
    expect(payload.approvedCopy.cta).toBe('Rezervo sot')
    expect(payload.businessBrain).toBe('{"voice":"calm"}')
    expect(payload.storyboard.concept).toContain('arrival')
    expect(request.instructions).toContain('restrictions are absolute prohibitions')
    expect(request.instructions).toContain('approvedCopy is the only text')
    expect(request.instructions).toContain('never BLOCK for that alone')
  })

  it('says nothing about context it was not given', async () => {
    const response = {
      id: 'response-3',
      status: 'completed',
      usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        decision: 'PASS', reasons: [], factuality: true, brandFit: true, visualQuality: true,
      }) }] }],
    }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetcher)
    const review = await reviewVideoQuality({
      photograph: Buffer.from('photo'), frames: [], caption: 'Caption', brandName: 'Brand', locale: 'en-US', verifiedFacts: [], targetChannel: 'Facebook',
    })
    expect(review.costUsd).toBe(0)
    const request = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(request.instructions).not.toContain('restrictions are absolute')
    expect(request.instructions).not.toContain('storyboard is the concept')
  })
})
