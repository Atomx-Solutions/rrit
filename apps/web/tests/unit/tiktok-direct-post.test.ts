import { describe, expect, it } from 'vitest'
import {
  tiktokScopes,
  tiktokSettingsProblem,
  tiktokTokenNeedsRefresh,
  type TikTokCreatorInfo,
  type TikTokPostSettings,
} from '../../server/utils/tiktok'

const creator: TikTokCreatorInfo = {
  creator_nickname: 'Framic',
  creator_username: 'framic',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
  comment_disabled: false,
  duet_disabled: true,
  stitch_disabled: false,
  max_video_post_duration_sec: 600,
}
const settings: TikTokPostSettings = {
  privacyLevel: 'PUBLIC_TO_EVERYONE',
  disableComment: false,
  disableDuet: true,
  disableStitch: false,
  brandOrganic: false,
  brandedContent: false,
}

describe('TikTok Direct Post', () => {
  it('asks for the publishing permission next to the draft upload', () => {
    expect(tiktokScopes).toEqual(expect.arrayContaining(['video.publish', 'video.upload']))
  })

  it('accepts choices the account allows', () => {
    expect(tiktokSettingsProblem(settings, creator)).toBeNull()
  })

  it('rejects a video longer than the account may post', () => {
    expect(tiktokSettingsProblem(settings, creator, 601)).toBe('server.TIKTOK_VIDEO_TOO_LONG')
    expect(tiktokSettingsProblem(settings, creator, 600)).toBeNull()
  })

  it('rejects a privacy the account does not offer', () => {
    expect(tiktokSettingsProblem({ ...settings, privacyLevel: 'MUTUAL_FOLLOW_FRIENDS' }, creator)).toBe('server.TIKTOK_PRIVACY_UNAVAILABLE')
  })

  it('rejects branded content visible only to its creator', () => {
    expect(tiktokSettingsProblem({ ...settings, privacyLevel: 'SELF_ONLY', brandedContent: true }, creator)).toBe(
      'server.TIKTOK_BRANDED_CONTENT_PRIVATE',
    )
  })

  it('rejects an interaction the account has turned off', () => {
    expect(tiktokSettingsProblem({ ...settings, disableDuet: false }, creator)).toBe('server.TIKTOK_INTERACTION_UNAVAILABLE')
  })

  it('renews the day-long access token within its last hour', () => {
    const now = Date.now()
    expect(tiktokTokenNeedsRefresh(new Date(now + 30 * 60 * 1000), now)).toBe(true)
    expect(tiktokTokenNeedsRefresh(new Date(now - 1000), now)).toBe(true)
    expect(tiktokTokenNeedsRefresh(new Date(now + 5 * 60 * 60 * 1000), now)).toBe(false)
  })
})
