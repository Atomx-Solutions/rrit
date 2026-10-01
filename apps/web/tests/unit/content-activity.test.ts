import { describe, expect, it } from 'vitest'
import { contentActivityDate } from '../../app/utils/content-activity'

describe('content activity date', () => {
  it('uses a draft post creation date for the activity chart', () => {
    expect(contentActivityDate({
      createdAt: '2026-10-01T09:30:00.000Z',
      proposedAt: undefined,
      publishedAt: undefined,
      scheduledAt: null,
    })).toBe('2026-10-01T09:30:00.000Z')
  })
})
