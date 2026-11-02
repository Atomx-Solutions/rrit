import { musicMoodDetailsSchema, saveMusicMood } from '../../../../utils/admin-music'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const details = musicMoodDetailsSchema.safeParse(await readBody(event))
  if (!details.success)
    throw createError({ statusCode: 400, message: 'server.MUSIC_MOOD_INVALID', data: { code: 'MUSIC_MOOD_INVALID' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return saveMusicMood({ id: actor.id, email: actor.email }, details.data)
})
