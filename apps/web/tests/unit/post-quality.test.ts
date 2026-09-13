import { describe, expect, it } from 'vitest'
import { createDemo } from '../fixtures/workspace'
import {
  qualityBrandHash,
  qualityReviewKey,
  reviewedQuality,
} from '../../server/utils/post-quality-domain'
import { postFingerprint } from '../../server/utils/post-validation'

describe('version-bound editorial quality', () => {
  it('ignores confirmation metadata but invalidates material brand changes', () => {
    const { brand } = createDemo()
    const hash = qualityBrandHash(brand)
    brand.brainVersion = 20
    brand.facts[0]!.revision = 99
    expect(qualityBrandHash(brand)).toBe(hash)
    brand.guardrails = ['Do not claim guarantees.']
    expect(qualityBrandHash(brand)).not.toBe(hash)
  })
  it('binds cache identity to version, exact content, image and verified business claims', () => {
    const workspace = createDemo(),
      post = workspace.posts[0]!
    const key = () => qualityReviewKey(post, postFingerprint(post), workspace.brand, '2026-09-09')
    const first = key()
    post.contentVersion = 2
    expect(key()).not.toBe(first)
    const second = key()
    post.image = '/api/media/changed'
    expect(key()).not.toBe(second)
    const third = key()
    workspace.brand.facts[0]!.text += ' Changed.'
    expect(key()).not.toBe(third)
  })
  it('never accepts PASS with a failed factuality or visual check', () => {
    const raw = {
      id: 'fixture',
      status: 'completed',
      usage: { input_tokens: 1, output_tokens: 1 },
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                decision: 'PASS',
                reasons: ['Fix unsupported claims.'],
                factuality: false,
                brandFit: true,
                visualQuality: true,
              }),
            },
          ],
        },
      ],
    }
    expect(reviewedQuality(raw).decision).toBe('BLOCK')
    raw.output[0]!.content[0]!.text = JSON.stringify({
      decision: 'PASS',
      reasons: ['Improve hierarchy.'],
      factuality: true,
      brandFit: true,
      visualQuality: false,
    })
    expect(reviewedQuality(raw).decision).toBe('WARN')
    raw.output[0]!.content[0]!.text = JSON.stringify({
      decision: 'WARN',
      reasons: ['Refine the composition.'],
      factuality: true,
      brandFit: false,
      visualQuality: false,
    })
    expect(reviewedQuality(raw).decision).toBe('WARN')
    raw.status = 'incomplete'
    expect(() => reviewedQuality(raw)).toThrow('PROVIDER_INCOMPLETE')
  })
})
