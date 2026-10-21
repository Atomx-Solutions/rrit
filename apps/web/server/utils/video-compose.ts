import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)
export const VIDEO_END_CARD_SECONDS = 2
const MAX_FINAL_VIDEO_BYTES = 50 * 1024 * 1024 // Smallest current video delivery limit (TikTok).

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

/** How long a clip runs, in seconds. */
export async function videoDuration(video: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-probe-'))
  try {
    const path = join(directory, 'clip.mp4')
    await writeFile(path, video)
    return (await probe(path)).duration
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * The very last frame of a clip at the given size, so the next shot can start
 * exactly where this one ended.
 */
export async function extractLastFrame(video: Buffer, size: { width: number; height: number }) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-last-'))
  try {
    const videoPath = join(directory, 'clip.mp4')
    const framePath = join(directory, 'last.jpg')
    await writeFile(videoPath, video)
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-sseof', '-0.1', '-i', videoPath, '-update', '1', '-q:v', '2',
      '-vf', `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1`,
      framePath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    return await readFile(framePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Joins the shots of a video into one clip, each blending into the next over
 * `crossfadeSeconds`. Every shot is brought to the same size and frame rate
 * first, without stretching, so shots a model returned at slightly different
 * sizes still join cleanly.
 */
export async function joinClips(clips: Buffer[], size: { width: number; height: number }, crossfadeSeconds: number) {
  if (clips.length === 1) return clips[0]!
  const directory = await mkdtemp(join(tmpdir(), 'rrit-join-'))
  try {
    const paths = clips.map((_, index) => join(directory, `shot-${index}.mp4`))
    await Promise.all(clips.map((clip, index) => writeFile(paths[index]!, clip)))
    const durations = (await Promise.all(paths.map(probe))).map((info) => info.duration)
    const fade = Math.max(0, Math.min(crossfadeSeconds, ...durations.map((value) => value / 2)))
    const normalized = paths
      .map((_, index) => `[${index}:v]fps=30,scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1,format=yuv420p,settb=AVTB[s${index}];`)
      .join('')
    let elapsed = durations[0]!
    let previous = 's0'
    const joins = durations.slice(1).map((duration, index) => {
      const offset = elapsed - fade
      elapsed += duration - fade
      const label = `j${index + 1}`
      const step = `[${previous}][s${index + 1}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[${label}];`
      previous = label
      return step
    }).join('')
    const outputPath = join(directory, 'joined.mp4')
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      ...paths.flatMap((path) => ['-i', path]),
      '-filter_complex', `${normalized}${joins}[${previous}]null[out]`,
      '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
      '-pix_fmt', 'yuv420p', outputPath,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
    return await readFile(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Stills from a clip at the given fractions of its length, as small JPEGs. */
export async function extractVideoFrames(video: Buffer, fractions: number[]) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-frames-'))
  try {
    const videoPath = join(directory, 'clip.mp4')
    await writeFile(videoPath, video)
    const { duration } = await probe(videoPath)
    return await Promise.all(fractions.map(async (fraction, index) => {
      const framePath = join(directory, `frame-${index}.jpg`)
      await run(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-ss', String(Math.max(0, Math.min(duration - 0.05, duration * fraction))),
        '-i', videoPath, '-frames:v', '1', '-vf', 'scale=768:-2', framePath,
      ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
      return readFile(framePath)
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// How a designed overlay layer arrives: it fades in while rising this far.
const OVERLAY_REVEAL_SECONDS = 0.5
const OVERLAY_RISE_RATIO = 0.016

/**
 * Deterministically compose one provider clip into the delivered MP4: the
 * designed overlay layers are revealed over the motion at their start times,
 * then the already-rendered Framic card is appended when the video has one.
 */
export async function composeBrandedVideo(input: {
  motion: Buffer
  endCard?: Buffer
  target: { width: number; height: number }
  // Transparent full-canvas PNGs, each shown from `start` (seconds into the
  // motion) to the end of the motion.
  overlays?: { image: Buffer; start: number }[]
  // A clip made on a wider canvas than the delivery canvas: it is placed whole
  // across the canvas with its top edge at `y` pixels, over a blurred,
  // darkened fill of itself, instead of being cropped to fill.
  placement?: { y: number }
}): Promise<Buffer> {
  const { width, height } = input.target
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('Invalid video composition dimensions')
  if (input.endCard) {
    const card = await sharp(input.endCard).metadata()
    if (card.format !== 'jpeg' || card.width !== width || card.height !== height)
      throw new Error('End-card must be a JPEG matching the video canvas')
  }
  const cardSeconds = input.endCard ? VIDEO_END_CARD_SECONDS : 0

  const directory = await mkdtemp(join(tmpdir(), 'rrit-video-'))
  try {
    const motionPath = join(directory, 'motion.mp4')
    const cardPath = join(directory, 'end-card.jpg')
    const outputPath = join(directory, 'final.mp4')
    const overlays = input.overlays || []
    const overlayPaths = overlays.map((_, index) => join(directory, `overlay-${index}.png`))
    await Promise.all([
      writeFile(motionPath, input.motion),
      ...(input.endCard ? [writeFile(cardPath, input.endCard)] : []),
      ...overlays.map((overlay, index) => writeFile(overlayPaths[index]!, overlay.image)),
    ])
    const source = await probe(motionPath)
    const frame = (label: string) => `fps=30,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p,${label}`
    const rise = Math.round(height * OVERLAY_RISE_RATIO)
    const motion = input.placement
      ? `[0:v]fps=30,setpts=PTS-STARTPTS,split[fill][subject];`
        + `[fill]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=${Math.round(width / 40)}:2,eq=brightness=-0.22[blurred];`
        + `[subject]scale=${width}:-2[placed];`
        + `[blurred][placed]overlay=x=0:y='max(0,min(H-h,${Math.round(input.placement.y)}))',setsar=1,format=yuv420p[motion];`
      : `[0:v]${frame('setpts=PTS-STARTPTS')}[motion];`
    // Each layer fades in while sliding up into place, then stays until the
    // motion ends; the overlays run on the motion only, never on the card.
    const layered = overlays.map((overlay, index) => {
      const start = Math.max(0, Math.min(overlay.start, source.duration))
      const end = start + OVERLAY_REVEAL_SECONDS
      return `[${index + 2}:v]format=rgba,fade=in:st=${start}:d=${OVERLAY_REVEAL_SECONDS}:alpha=1[o${index}];`
        + `[${index ? `m${index}` : 'motion'}][o${index}]overlay=x=0:y='if(lt(t,${end}),${rise}*(1-max(0,t-${start})/${OVERLAY_REVEAL_SECONDS}),0)':eval=frame:shortest=1,format=yuv420p[m${index + 1}];`
    }).join('')
    const composed = overlays.length ? `m${overlays.length}` : 'motion'
    // Overlay inputs follow the motion and, when present, the card.
    const firstOverlay = input.endCard ? 2 : 1
    const layeredInputs = layered.replace(/\[(\d+):v\]/g, (_, index: string) => `[${Number(index) - 2 + firstOverlay}:v]`)
    const closing = input.endCard
      ? `[1:v]${frame(`trim=duration=${VIDEO_END_CARD_SECONDS},setpts=PTS-STARTPTS`)}[card];[${composed}][card]concat=n=2:v=1:a=0[out]`
      : `[${composed}]null[out]`
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', motionPath,
      ...(input.endCard ? ['-loop', '1', '-framerate', '30', '-t', String(VIDEO_END_CARD_SECONDS), '-i', cardPath] : []),
      ...overlayPaths.flatMap((path) => ['-loop', '1', '-framerate', '30', '-t', String(source.duration), '-i', path]),
      '-filter_complex', `${motion}${layeredInputs}${closing}`,
      '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
    const final = await probe(outputPath)
    if (final.width !== width || final.height !== height || Math.abs(final.duration - source.duration - cardSeconds) > 0.2)
      throw new Error('Composed video dimensions or duration are invalid')
    const bytes = await readFile(outputPath)
    if (bytes.length > MAX_FINAL_VIDEO_BYTES) throw new Error('Composed video exceeds delivery size limit')
    return bytes
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
