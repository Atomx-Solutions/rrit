import { connectedTikTok, uploadTikTokDraft } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const form = await readMultipartFormData(event)
  const video = form?.find((part) => part.name === 'video')
  if (!video?.data?.length || !['video/mp4', 'video/quicktime'].includes(video.type || ''))
    throw createError({ statusCode: 400, message: 'server.VIDEO_FORMAT_REQUIRED' })
  const connection = await withBusinessTransaction(user.id, (client, business) => connectedTikTok(business.id, client))
  if (!connection || !connection.scopes.includes('video.upload'))
    throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED_UPLOAD' })
  return uploadTikTokDraft(connection.token, video.data, video.type || 'video/mp4')
})
