import { addMusicTrack, musicTrackDetailsSchema } from '../../../utils/admin-music'
import { MAX_TRACK_BYTES } from '../../../utils/music-library'

// A new library track: the MP3 and its details arrive as one form.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event, { multipart: true })
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  // Turned away before the form is read: an MP3 over the limit plus its fields.
  if (Number(getRequestHeader(event, 'content-length') || 0) > MAX_TRACK_BYTES + 64 * 1024)
    throw createError({ statusCode: 413, message: 'server.MUSIC_FILE_TOO_LARGE', data: { code: 'MUSIC_FILE_TOO_LARGE' } })
  const form = await readMultipartFormData(event)
  const file = form?.find((part) => part.name === 'file')
  const fields = Object.fromEntries(
    (form || []).filter((part) => !part.filename).map((part) => [part.name, part.data.toString('utf8')]),
  )
  const details = musicTrackDetailsSchema.safeParse(fields)
  if (!details.success)
    throw createError({ statusCode: 400, message: 'server.MUSIC_DETAILS_INVALID', data: { code: 'MUSIC_DETAILS_INVALID' } })
  if (!file?.data?.length)
    throw createError({ statusCode: 400, message: 'server.MUSIC_FILE_INVALID', data: { code: 'MUSIC_FILE_INVALID' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return addMusicTrack({ id: actor.id, email: actor.email }, details.data, file.data)
})
