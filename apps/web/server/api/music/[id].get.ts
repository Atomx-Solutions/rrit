import { z } from 'zod'
import { downloadMusicTrack, findMusicTrack } from '../../utils/music-library'

// A library track, played in the editor before the business picks it.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const track = await findMusicTrack(database(), id)
  if (!track) throw createError({ statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND' })
  setHeader(event, 'Content-Type', 'audio/mpeg')
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return downloadMusicTrack(track.storagePath)
})
