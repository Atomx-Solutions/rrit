import { describe, expect, it } from 'vitest'
import { imageEditQueueSettings } from '../../server/utils/monthly-planner-domain'

describe('photo edit queue settings', () => {
  it('reads the limits from the environment', () => {
    expect(imageEditQueueSettings({
      IMAGE_EDIT_CONCURRENCY: '7',
      IMAGE_EDIT_CONCURRENCY_PER_BUSINESS: '2',
      IMAGE_EDIT_MIN_SECONDS: '120',
      IMAGE_EDIT_QUEUE_POLL_SECONDS: '4',
    })).toEqual({ concurrency: 7, perBusiness: 2, minEditMs: 120000, pollMs: 4000 })
  })

  it('keeps the default when a value is not a positive whole number', () => {
    const defaults = imageEditQueueSettings({})
    expect(imageEditQueueSettings({ IMAGE_EDIT_CONCURRENCY: '0', IMAGE_EDIT_CONCURRENCY_PER_BUSINESS: 'many' }))
      .toMatchObject({ concurrency: defaults.concurrency, perBusiness: defaults.perBusiness })
  })
})
