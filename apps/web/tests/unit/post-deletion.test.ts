import { describe, expect, it } from 'vitest'
import { postSchema } from '../../shared/schemas/workspace'
import { canDeletePost } from '../../shared/utils/post-deletion'

describe('canDeletePost', () => {
  const statuses = postSchema.shape.status.options

  it('keeps scheduled and published posts', () => {
    expect(canDeletePost({ status: 'scheduled' })).toBe(false)
    expect(canDeletePost({ status: 'published' })).toBe(false)
  })

  it('allows every other status', () => {
    for (const status of statuses.filter((s) => s !== 'scheduled' && s !== 'published'))
      expect(canDeletePost({ status })).toBe(true)
  })
})
