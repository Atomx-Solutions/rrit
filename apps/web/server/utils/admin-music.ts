import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { APP_LOCALES } from '../../shared/schemas/workspace'
import { adminServiceClient } from './admin-supabase'
import { removeAsset, uploadBinaryAsset } from './asset-storage'
import { downloadMusicTrack, MAX_TRACK_BYTES } from './music-library'

const run = promisify(execFile)

// What the superadmin fills in next to the MP3.
export const musicTrackDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120).optional().default(''),
  mood: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
})
export type MusicTrackDetails = z.infer<typeof musicTrackDetailsSchema>

/** An MP3 starts with an ID3 tag or straight with an MPEG audio frame. */
export function looksLikeMp3(bytes: Buffer) {
  if (bytes.length < 4) return false
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') return true
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

function slugOf(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}

/** The track's slug, also the name of its file; a title with no latin letters still gets one. */
export function musicTrackSlug(title: string, unique = crypto.randomUUID().slice(0, 8)) {
  const base = slugOf(title)
  return base ? `${base}-${unique}` : `track-${unique}`
}

// A mood's name in each app language. English is required: it stands in for
// any language left empty.
const moodLanguages = APP_LOCALES.map((locale) => locale.slice(0, 2))
export const musicMoodDetailsSchema = z.object({
  names: z.record(z.string(), z.string().trim().max(60))
    .refine((names) => Object.keys(names).every((language) => moodLanguages.includes(language)))
    .refine((names) => !!names.en)
    .transform((names) => Object.fromEntries(Object.entries(names).filter(([, name]) => name))),
})
export type MusicMoodDetails = z.infer<typeof musicMoodDetailsSchema>

/** A new mood is named after its English name; that slug never changes. */
export function musicMoodSlug(englishName: string, unique = crypto.randomUUID().slice(0, 6)) {
  return slugOf(englishName) || `mood-${unique}`
}

/** The length of the MP3 in seconds, read by ffprobe as the import script did. */
export async function mp3Duration(bytes: Buffer) {
  const folder = await mkdtemp(join(tmpdir(), 'rrit-music-'))
  try {
    const file = join(folder, 'track.mp3')
    await writeFile(file, bytes)
    const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 })
    const seconds = Number(stdout.trim())
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('No audio duration')
    return Math.round(seconds * 100) / 100
  } catch {
    throw createError({ statusCode: 400, message: 'server.MUSIC_FILE_INVALID', data: { code: 'MUSIC_FILE_INVALID' } })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

const failures: Record<string, { statusCode: number; message: string }> = {
  MUSIC_TRACK_EXISTS: { statusCode: 409, message: 'server.MUSIC_TRACK_EXISTS' },
  MUSIC_TRACK_NOT_FOUND: { statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND' },
  MUSIC_MOOD_IN_USE: { statusCode: 409, message: 'server.MUSIC_MOOD_IN_USE' },
  MUSIC_MOOD_EXISTS: { statusCode: 409, message: 'server.MUSIC_MOOD_EXISTS' },
  MUSIC_MOOD_NOT_FOUND: { statusCode: 404, message: 'server.MUSIC_MOOD_NOT_FOUND' },
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    const code = Object.keys(failures).find((key) => error.message.includes(key))
    if (code) throw createError({ ...failures[code]!, data: { code } })
    console.error('Admin music call failed.', { name, code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.MUSIC_LIBRARY_FAILED' })
  }
  return data as T
}

type Actor = { id: string; email: string }

export function adminMusicTracks() {
  return rpc<{ tracks: unknown[] }>('admin_music_tracks', {})
}

export async function adminMusicTrackFile(id: string) {
  const path = await rpc<string | null>('admin_music_track_path', { p_track_id: id })
  if (!path) throw createError({ statusCode: 404, message: 'server.MUSIC_TRACK_NOT_FOUND' })
  return downloadMusicTrack(path)
}

/** Stores the MP3, then the row; a row that cannot be written leaves no file behind. */
export async function addMusicTrack(actor: Actor, details: MusicTrackDetails, bytes: Buffer) {
  if (bytes.length > MAX_TRACK_BYTES)
    throw createError({ statusCode: 413, message: 'server.MUSIC_FILE_TOO_LARGE', data: { code: 'MUSIC_FILE_TOO_LARGE' } })
  if (!looksLikeMp3(bytes))
    throw createError({ statusCode: 400, message: 'server.MUSIC_FILE_INVALID', data: { code: 'MUSIC_FILE_INVALID' } })
  const duration = await mp3Duration(bytes)
  const slug = musicTrackSlug(details.title)
  const storagePath = `music-library/${slug}.mp3`
  try {
    await uploadBinaryAsset(storagePath, bytes, 'audio/mpeg')
  } catch {
    throw createError({ statusCode: 502, message: 'server.MUSIC_STORAGE_FAILED' })
  }
  try {
    return await rpc('admin_add_music_track', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_slug: slug,
      p_title: details.title,
      p_artist: details.artist,
      p_mood: details.mood,
      p_duration_seconds: duration,
      p_storage_path: storagePath,
      p_license: null,
      p_credit_text: null,
      p_source_url: null,
    })
  } catch (error) {
    await removeAsset(storagePath).catch((cleanup) =>
      console.error('Music upload cleanup failed.', { storagePath, error: String(cleanup) }))
    throw error
  }
}

/**
 * Takes a track out of the library or puts it back. The row and its file stay:
 * a video already made with it keeps its title and credit.
 */
export function setMusicTrackActive(actor: Actor, id: string, active: boolean) {
  return rpc('admin_set_music_track_active', {
    p_track_id: id,
    p_active: active,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
}

/** Adds a mood named after its English name, or renames an existing one. */
export function saveMusicMood(actor: Actor, details: MusicMoodDetails, slug?: string) {
  return rpc('admin_save_music_mood', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_slug: slug ?? musicMoodSlug(details.names.en!),
    p_names: details.names,
    p_create: !slug,
  })
}

/** Only a mood no track uses can go; its tracks are moved or removed first. */
export function deleteMusicMood(actor: Actor, slug: string) {
  return rpc('admin_delete_music_mood', { p_actor_id: actor.id, p_actor_email: actor.email, p_slug: slug })
}
