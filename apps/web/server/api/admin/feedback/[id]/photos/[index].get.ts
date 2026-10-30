import { z } from 'zod'
import { downloadAsset } from '../../../../../utils/asset-storage'
import { FEEDBACK_MAX_PHOTOS, adminClientFeedbackPhoto } from '../../../../../utils/client-feedback'

// Feedback photos are private, so the superadmin reads them through this route
// instead of a public storage link.
export default defineEventHandler(async (event) => {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const index = z.coerce.number().int().min(0).max(FEEDBACK_MAX_PHOTOS - 1).safeParse(getRouterParam(event, 'index'))
  const path = id.success && index.success ? await adminClientFeedbackPhoto(id.data, index.data) : null
  if (!path) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })
  const bytes = await downloadAsset(path)
  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return bytes
})
