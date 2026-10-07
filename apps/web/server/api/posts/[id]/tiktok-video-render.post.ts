import { z } from 'zod'
import { renderTikTokVideoForPost } from '../../../utils/tiktok-video-render'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return renderTikTokVideoForPost(user.id, id)
})
