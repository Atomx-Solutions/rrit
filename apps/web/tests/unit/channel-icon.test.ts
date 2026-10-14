import { describe, expect, it } from 'vitest'
import { channelIcon } from '../../app/utils/channel-icon'

describe('channel icons', () => {
  it('uses the TikTok brand icon for TikTok posts', () => {
    expect(channelIcon('TikTok')).toBe('i-simple-icons-tiktok')
  })
})
