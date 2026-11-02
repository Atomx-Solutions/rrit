// Fills the music library from a folder of MP3s described by
// database/music-library.json. Run again at any time: a track already in the
// library is replaced with the file and details given now.
//
//   npm run music:import -- <folder with the MP3s>
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const folder = process.argv[2]
if (!folder) throw new Error('Name the folder that holds the MP3s: npm run music:import -- <folder>')
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set MIGRATION_DATABASE_URL in the root .env.')
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env.')

const manifest = JSON.parse(await readFile(new URL('../database/music-library.json', import.meta.url), 'utf8'))
const bucket = process.env.MEDIA_BUCKET || 'assets'
const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
}).storage.from(bucket)
const run = promisify(execFile)

const slugOf = (title) => title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

async function durationOf(path) {
  const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read the length of ${path}`)
  return Math.round(seconds * 100) / 100
}

const pool = new pg.Pool({ connectionString: databaseUrl })
try {
  for (const track of manifest.tracks) {
    const file = join(folder, track.file)
    const slug = slugOf(track.title)
    const storagePath = `music-library/${slug}.mp3`
    const duration = await durationOf(file)
    const { error } = await storage.upload(storagePath, await readFile(file), {
      contentType: 'audio/mpeg',
      cacheControl: '3600',
      upsert: true,
    })
    if (error) throw new Error(`Upload of ${track.file} failed: ${error.message}`)
    await pool.query(
      `INSERT INTO music_tracks (slug,title,artist,mood,duration_seconds,storage_path,license,credit_text,source_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title,artist=EXCLUDED.artist,mood=EXCLUDED.mood,
         duration_seconds=EXCLUDED.duration_seconds,storage_path=EXCLUDED.storage_path,license=EXCLUDED.license,
         credit_text=EXCLUDED.credit_text,source_url=EXCLUDED.source_url,active=true`,
      [
        slug,
        track.title,
        manifest.artist,
        track.mood,
        duration,
        storagePath,
        manifest.license,
        manifest.credit.replace('{title}', track.title),
        manifest.sourceUrl,
      ],
    )
    console.log(`Imported: ${track.title} (${duration}s, ${track.mood})`)
  }
} finally {
  await pool.end()
}
