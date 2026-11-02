import { z } from 'zod'
import { adminMusicTrackFile } from '../../../../utils/admin-music'

// Any track, removed ones too, so the superadmin can listen before restoring it.
export default defineEventHandler(async (event) => {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND' })
  const bytes = await adminMusicTrackFile(id.data)
  setHeader(event, 'Content-Type', 'audio/mpeg')
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
