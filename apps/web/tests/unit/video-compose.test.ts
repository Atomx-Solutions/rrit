import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { composeBrandedVideo } from '../../server/utils/video-compose'

const run = promisify(execFile)
const target = { width: 360, height: 640 }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-compose-test-'))
  const path = join(directory, 'motion.mp4')
  try {
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:r=30:d=1',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path,
    ], { timeout: 30_000 })
    return await readFile(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('composeBrandedVideo', () => {
  it('ends on the motion itself', async () => {
    const motion = await fixture()
    const final = await composeBrandedVideo({ motion, target })
    const directory = await mkdtemp(join(tmpdir(), 'rrit-uncarded-probe-'))
    try {
      const path = join(directory, 'final.mp4')
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, final)
      const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path,
      ])
      expect(Number((JSON.parse(stdout) as { format: { duration: string } }).format.duration)).toBeCloseTo(1, 1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 45_000)
  it('rejects a corrupt source video', async () => {
    await expect(composeBrandedVideo({ motion: Buffer.from('bad video'), target })).rejects.toThrow()
  }, 45_000)
})
