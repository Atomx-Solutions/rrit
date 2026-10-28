import { connectedTikTok, tiktokCreatorInfo, tiktokDirectPostScope } from '../../utils/tiktok'

// What the connected account allows for a direct post, read fresh from TikTok
// each time the settings are shown, as TikTok requires.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const connection = await withBusinessTransaction(user.id, (client, business) => connectedTikTok(business.id, client))
  if (!connection) throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED' })
  if (!connection.scopes.includes(tiktokDirectPostScope))
    throw createError({ statusCode: 409, message: 'server.TIKTOK_DIRECT_POST_PERMISSION' })
  let creator: Awaited<ReturnType<typeof tiktokCreatorInfo>>
  try {
    creator = await tiktokCreatorInfo(connection.token)
  } catch {
    throw createError({ statusCode: 502, message: 'server.TIKTOK_CREATOR_UNAVAILABLE' })
  }
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    nickname: creator.creator_nickname,
    username: creator.creator_username,
    avatarUrl: creator.creator_avatar_url || null,
    privacyLevelOptions: creator.privacy_level_options,
    commentDisabled: creator.comment_disabled,
    duetDisabled: creator.duet_disabled,
    stitchDisabled: creator.stitch_disabled,
    maxVideoPostDurationSec: creator.max_video_post_duration_sec,
  }
})
