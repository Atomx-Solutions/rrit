import { describe, expect, it } from 'vitest'
import { pricePerSecondUsd } from '../../server/utils/ai-video-provider'
import { affordableVideoSeconds, estimatedVideoCredits } from '../../server/utils/video-budget'

// Price lists as OpenRouter publishes them for a few video models.
const veoFast = {
  duration_seconds_with_audio: '0.12',
  duration_seconds_with_audio_4k: '0.30',
  duration_seconds_without_audio: '0.10',
  duration_seconds_with_audio_720p: '0.10',
  duration_seconds_without_audio_4k: '0.25',
  duration_seconds_without_audio_720p: '0.08',
}
const grok = {
  cents_per_image_input: '1',
  cents_per_video_output_second_480p: '8',
  cents_per_video_output_second_720p: '14',
  cents_per_video_output_second_1080p: '25',
}
const tokenPriced = { video_tokens: '0.000007', video_tokens_without_audio: '0.000007' }

describe('the model price per second', () => {
  it('reads the silent price for the resolution asked for', () => {
    expect(pricePerSecondUsd(veoFast, '1080p')).toBeCloseTo(0.10)
    expect(pricePerSecondUsd(veoFast, '720p')).toBeCloseTo(0.08)
  })

  it('converts a price published in cents', () => {
    expect(pricePerSecondUsd(grok, '1080p')).toBeCloseTo(0.25)
    expect(pricePerSecondUsd(grok, '720p')).toBeCloseTo(0.14)
  })

  it('has no per-second price for a model priced another way', () => {
    expect(pricePerSecondUsd(tokenPriced, '1080p')).toBeNull()
    expect(pricePerSecondUsd(undefined, '1080p')).toBeNull()
  })
})

describe('fitting a video to the credits available', () => {
  // 0.10 USD a second; 1 USD = 900 000 micro-EUR; one credit pays 10 000 micro-EUR.
  const pricing = { pricePerSecondUsd: 0.1, usdMicroEur: 900_000, providerCostPerCreditMicroEur: 10_000 }

  it('works out how many seconds the credits pay for', () => {
    // A second costs 90 000 micro-EUR, that is 9 credits.
    expect(affordableVideoSeconds(108, pricing)).toBe(12)
    expect(affordableVideoSeconds(60, pricing)).toBe(6)
    expect(affordableVideoSeconds(8, pricing)).toBe(0)
  })

  it('estimates the credits a planned video costs', () => {
    expect(estimatedVideoCredits(12, pricing)).toBe(108)
    expect(estimatedVideoCredits(6, pricing)).toBe(54)
  })
})
