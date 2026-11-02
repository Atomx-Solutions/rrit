import { z } from 'zod'
import { musicMoodDetailsSchema, saveMusicMood } from '../../../../utils/admin-music'

// Renames or reorders a mood; its slug, and so its tracks, stay.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60).safeParse(getRouterParam(event, 'slug'))
  if (!slug.success)
    throw createError({ statusCode: 404, message: 'server.MUSIC_MOOD_NOT_FOUND', data: { code: 'MUSIC_MOOD_NOT_FOUND' } })
  const details = musicMoodDetailsSchema.safeParse(await readBody(event))
  if (!details.success)
    throw createError({ statusCode: 400, message: 'server.MUSIC_MOOD_INVALID', data: { code: 'MUSIC_MOOD_INVALID' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return saveMusicMood({ id: actor.id, email: actor.email }, details.data, slug.data)
})
