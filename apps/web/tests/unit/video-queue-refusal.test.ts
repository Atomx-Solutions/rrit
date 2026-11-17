import { describe, expect, it } from 'vitest'
import { queueRefusalCode } from '../../server/utils/video-render'

describe('why a video could not be queued', () => {
  it('names a lack of credits and a used-up allowance, so the editor can say so', () => {
    expect(queueRefusalCode({ statusCode: 402, data: { code: 'CREDITS_EXHAUSTED' } })).toBe('credits_insufficient')
    expect(queueRefusalCode({ statusCode: 403, data: { code: 'QUOTA_EXCEEDED' } })).toBe('quota_exceeded')
  })

  it('falls back on a general refusal for anything else', () => {
    expect(queueRefusalCode(new Error('boom'))).toBe('queue_refused')
    expect(queueRefusalCode(undefined)).toBe('queue_refused')
  })
})
