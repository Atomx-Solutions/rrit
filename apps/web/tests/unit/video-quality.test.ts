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

    const quality = await reviewVideoQuality({
      photograph: Buffer.from('photo'),
      frames: [Buffer.from('first'), Buffer.from('last')],
      caption: 'Caption',
      brandName: 'Brand',
      locale: 'en-US',
      verifiedFacts: ['Verified fact'],
    })

    expect(quality.decision).toBe('WARN')
    expect(quality.reasons).toContain('The overlay obscures the main subject.')
    const request = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(request.input[0].content.filter((part: { type: string }) => part.type === 'input_image')).toHaveLength(3)
    expect(request.input[0].content[0].text).toContain('Verified fact')
  })
})
