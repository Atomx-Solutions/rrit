import { adminMusicTracks } from '../../../utils/admin-music'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminMusicTracks()
})
