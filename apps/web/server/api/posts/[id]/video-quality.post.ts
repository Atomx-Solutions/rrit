import { z } from 'zod'
import { reviewExistingVideoQuality } from '../../../utils/video-quality'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return { quality: await reviewExistingVideoQuality(user.id, id) }
})
