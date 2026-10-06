import { decryptTikTokToken, uploadTikTokDraft } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const form = await readMultipartFormData(event)
  const video = form?.find((part) => part.name === 'video')
  if (!video?.data?.length || !['video/mp4', 'video/quicktime'].includes(video.type || ''))
    throw createError({ statusCode: 400, message: 'Zgjidh një video MP4 ose MOV.' })
  const connection = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{ access_token_ciphertext: string; expires_at: Date; scopes: string[] }>(
      "SELECT access_token_ciphertext,expires_at,scopes FROM tiktok_connections WHERE business_id=$1 AND status='connected'",
      [business.id],
    )
    return { business, row: result.rows[0] }
  })
  if (!connection.row || connection.row.expires_at < new Date() || !connection.row.scopes.includes('video.upload'))
    throw createError({ statusCode: 409, message: 'Lidhe ose rinovo TikTok para upload-it.' })
  const token = decryptTikTokToken(connection.row.access_token_ciphertext, connection.business.id)
  return uploadTikTokDraft(token, video.data, video.type || 'video/mp4')
})
