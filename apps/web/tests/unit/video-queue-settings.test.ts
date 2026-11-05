import { describe, expect, it } from 'vitest'
import { videoQueueSettings } from '../../server/utils/monthly-planner-domain'

describe('video queue settings', () => {
  it('renders one video of a business at a time unless configured otherwise', () => {
    expect(videoQueueSettings({}).perBusiness).toBe(1)
    expect(videoQueueSettings({ VIDEO_CONCURRENCY_PER_BUSINESS: '3' }).perBusiness).toBe(3)
    // A value that is not a positive whole number keeps the default.
    expect(videoQueueSettings({ VIDEO_CONCURRENCY_PER_BUSINESS: '0' }).perBusiness).toBe(1)
  })
})
