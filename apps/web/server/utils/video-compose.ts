import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)
export const VIDEO_END_CARD_SECONDS = 2
const MAX_FINAL_VIDEO_BYTES = 50 * 1024 * 1024 // Smallest current video delivery limit (TikTok).

// Existing rows contain the requested motion duration; newly composed rows
// store motion plus the deterministic card. Used to keep old raw renders from
// being mistaken for publishable branded MP4s.
export function hasComposedEndCard(storedSeconds: number, motionSeconds: number | null | undefined) {
  return typeof motionSeconds === 'number'
    && storedSeconds === motionSeconds + VIDEO_END_CARD_SECONDS
}

type VideoInfo = { width: number; height: number; duration: number }

async function probe(path: string): Promise<VideoInfo> {
  const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', path,
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 })
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } }
  const width = parsed.streams?.[0]?.width || 0
  const height = parsed.streams?.[0]?.height || 0
  const duration = Number(parsed.format?.duration)
  if (!width || !height || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Invalid video stream or duration')
  return { width, height, duration }
}

/** Deterministically append the already-rendered RRIT card to one provider clip. */
export async function composeBrandedVideo(input: {
  motion: Buffer
  endCard: Buffer
  target: { width: number; height: number }
}): Promise<Buffer> {
  const { width, height } = input.target
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('Invalid video composition dimensions')
  const card = await sharp(input.endCard).metadata()
  if (card.format !== 'jpeg' || card.width !== width || card.height !== height)
    throw new Error('End-card must be a JPEG matching the video canvas')

  const directory = await mkdtemp(join(tmpdir(), 'rrit-video-'))
  try {
    const motionPath = join(directory, 'motion.mp4')
    const cardPath = join(directory, 'end-card.jpg')
    const outputPath = join(directory, 'final.mp4')
    await Promise.all([writeFile(motionPath, input.motion), writeFile(cardPath, input.endCard)])
    const source = await probe(motionPath)
    const frame = (label: string) => `fps=30,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p,${label}`
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', motionPath, '-loop', '1', '-framerate', '30', '-t', String(VIDEO_END_CARD_SECONDS), '-i', cardPath,
      '-filter_complex', `[0:v]${frame('setpts=PTS-STARTPTS')}[motion];[1:v]${frame(`trim=duration=${VIDEO_END_CARD_SECONDS},setpts=PTS-STARTPTS`)}[card];[motion][card]concat=n=2:v=1:a=0[out]`,
      '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
    const final = await probe(outputPath)
    if (final.width !== width || final.height !== height || Math.abs(final.duration - source.duration - VIDEO_END_CARD_SECONDS) > 0.2)
      throw new Error('Composed video dimensions or duration are invalid')
    const bytes = await readFile(outputPath)
    if (bytes.length > MAX_FINAL_VIDEO_BYTES) throw new Error('Composed video exceeds delivery size limit')
    return bytes
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
