import { z } from 'zod'
import { renderVideoForPost } from '../../../utils/video-render'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return renderVideoForPost(user.id, id)
})
