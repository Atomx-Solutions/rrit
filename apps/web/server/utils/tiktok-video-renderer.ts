import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

function runFfmpeg(args: string[]) {
  const binary = process.env.FFMPEG_PATH || 'ffmpeg'
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-y', ...args], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000) })
    child.on('error', () => reject(createError({ statusCode: 503, message: 'FFmpeg nuk është i disponueshëm për renderim video.' })))
    child.on('close', (code) => code === 0 ? resolve() : reject(createError({ statusCode: 502, message: 'Renderimi i videos nuk përfundoi.', data: { code, detail: stderr.slice(-500) } })))
  })
}

export async function renderTikTokPhotoVideo(source: Buffer, logo?: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-tiktok-'))
  const input = join(directory, 'source.jpg')
  const logoInput = join(directory, 'logo.png')
  const output = join(directory, 'render.mp4')
  try {
    await writeFile(input, source)
    if (logo) await writeFile(logoInput, logo)
    const baseFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,zoompan=z='min(zoom+0.00045,1.10)':d=360:s=1080x1920:fps=30,format=yuv420p"
    const filter = logo
      ? `[0:v]${baseFilter}[base];[1:v]scale=160:-1[logo];[base][logo]overlay=W-w-48:H-h-56:format=auto,format=yuv420p`
      : baseFilter
    await runFfmpeg([
      '-loop', '1', '-i', input,
      ...(logo ? ['-loop', '1', '-i', logoInput] : []),
      '-t', '12',
      ...(logo ? ['-filter_complex', filter] : ['-vf', filter]),
      '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', '-an', output,
    ])
    return await readFile(output)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
