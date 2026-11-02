import { listMusicTracks } from '../../utils/music-library'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { tracks: await listMusicTracks(database()) }
})
