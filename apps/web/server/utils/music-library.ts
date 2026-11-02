import type { Pool, PoolClient } from 'pg'
import { musicMoodSchema, musicTrackSchema, type VideoMusic, type VideoMusicChoice } from '../../shared/schemas/music'
import { downloadAsset } from './asset-storage'

// A library MP3 is a few minutes of music; anything far larger is not one.
export const MAX_TRACK_BYTES = 20 * 1024 * 1024

type TrackRow = {
  id: string
  title: string
  artist: string | null
  mood: string
  duration_seconds: string
  credit_text: string | null
  storage_path: string
}

const columns = 'id,title,artist,mood,duration_seconds,credit_text,storage_path'

function track(row: TrackRow) {
  return musicTrackSchema.parse({
    id: row.id,
    title: row.title,
    artist: row.artist,
    mood: row.mood,
    durationSeconds: Number(row.duration_seconds),
    credit: row.credit_text,
  })
}

/** The active library, by mood and then by title. */
export async function listMusicTracks(db: Pool | PoolClient) {
  const result = await db.query<TrackRow>(
    `SELECT ${columns} FROM music_tracks
      WHERE active ORDER BY mood,title`,
  )
  return result.rows.map(track)
}

/** The moods the library is grouped by. */
export async function listMusicMoods(db: Pool | PoolClient) {
  const result = await db.query<{ slug: string; names: unknown }>("SELECT slug,names FROM music_moods ORDER BY names->>'en',slug")
  return result.rows.map((row) => musicMoodSchema.parse(row))
}

/** One active track with where its MP3 is kept, or null when it is gone. */
export async function findMusicTrack(db: Pool | PoolClient, id: string) {
  const result = await db.query<TrackRow>(`SELECT ${columns} FROM music_tracks WHERE id=$1 AND active`, [id])
  const row = result.rows[0]
  return row ? { ...track(row), storagePath: row.storage_path } : null
}

/**
 * The music a choice stands for, with a library track's title and credit read
 * now so the video keeps them even if the track later leaves the library.
 */
export async function resolveVideoMusic(db: Pool | PoolClient, choice: VideoMusicChoice) {
  if (choice.source !== 'library') return { music: { source: choice.source } as VideoMusic }
  const found = await findMusicTrack(db, choice.trackId!)
  if (!found) throw createError({ statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND' })
  const music: VideoMusic = { source: 'library', trackId: found.id, title: found.title, credit: found.credit || undefined }
  return { music, storagePath: found.storagePath }
}

export function downloadMusicTrack(storagePath: string) {
  return downloadAsset(storagePath, MAX_TRACK_BYTES)
}
