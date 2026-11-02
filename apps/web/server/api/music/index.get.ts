import { listMusicMoods, listMusicTracks } from '../../utils/music-library'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const db = database()
  const [tracks, moods] = await Promise.all([listMusicTracks(db), listMusicMoods(db)])
  return { tracks, moods }
})
