import { z } from 'zod'
import { deleteMusicMood } from '../../../../utils/admin-music'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60).safeParse(getRouterParam(event, 'slug'))
  if (!slug.success)
    throw createError({ statusCode: 404, message: 'server.MUSIC_MOOD_NOT_FOUND', data: { code: 'MUSIC_MOOD_NOT_FOUND' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return deleteMusicMood({ id: actor.id, email: actor.email }, slug.data)
})
