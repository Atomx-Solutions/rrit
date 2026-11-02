import { z } from 'zod'
import { setMusicTrackActive } from '../../../utils/admin-music'

// Takes a track out of the library or puts it back.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const body = z.object({ active: z.boolean() }).safeParse(await readBody(event))
  if (!id.success)
    throw createError({ statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND', data: { code: 'MUSIC_TRACK_NOT_FOUND' } })
  if (!body.success)
    throw createError({ statusCode: 400, message: 'server.MUSIC_DETAILS_INVALID', data: { code: 'MUSIC_DETAILS_INVALID' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return setMusicTrackActive({ id: actor.id, email: actor.email }, id.data, body.data.active)
})
