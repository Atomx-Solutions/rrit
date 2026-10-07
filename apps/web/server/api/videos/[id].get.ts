import { z } from 'zod'
import { downloadAsset } from '../../utils/asset-storage'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const render = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{ storage_path: string }>(
      "SELECT storage_path FROM video_renders WHERE id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL",
      [id, business.id],
    )
    if (!result.rows[0]) throw createError({ statusCode: 404, message: 'server.VIDEO_NOT_FOUND' })
    return result.rows[0]
  })
  setHeader(event, 'Content-Type', 'video/mp4')
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return downloadAsset(render.storage_path, 60 * 1024 * 1024)
})
