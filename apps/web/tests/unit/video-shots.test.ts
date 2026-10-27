import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { closestDuration, generateStoryboardShots, ShotSubjectChanged } from '../../server/utils/video-shots'
import { extractLastFrame, joinClips, videoDuration } from '../../server/utils/video-compose'
import type { Storyboard } from '../../shared/schemas/storyboard'

const run = promisify(execFile)

async function clip(seconds: number, color: string, size = { width: 1080, height: 1920 }) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-test-clip-'))
  try {
    const path = join(directory, 'clip.mp4')
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=${size.width}x${size.height}:d=${seconds}:r=30`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
    ])
    return await readFile(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function shot(durationSeconds: number, extra: Partial<Storyboard['shots'][number]> = {}): Storyboard['shots'][number] {
  return {
    purpose: 'A shot of the real car.',
    durationSeconds,
    camera: { move: 'A slow rise.', lens: '35mm', speed: 'slow', ease: 'ease-in-out', rotationDegrees: 10 },
    atmosphere: 'Golden hour.',
    effects: 'none',
    subject: { motion: 'still', description: 'The car holds still.' },
    opensOnPhotograph: true,
    endsOnPhotograph: false,
    showsOnlyPhotographedSides: true,
    ...extra,
  }
}

const board = (shots: Storyboard['shots']): Storyboard => ({
  concept: 'An arrival and a reveal of the real car.',
  rationale: 'Premium launch for a rental fleet.',
  cta: 'Rezervo sot',
  caption: 'Rezervo sot.',
  shots,
})

const provider = { canvas: { width: 1080, height: 1920 }, aspectRatio: '9:16' }

async function photo() {
  return sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#335577' } }).jpeg().toBuffer()
}

function fakes(lastFrame = Buffer.from('previous-last-frame')) {
  return {
    generate: vi.fn(async () => ({ bytes: Buffer.from('clip'), costUsd: 0.4 })),
    verify: vi.fn(async () => ({ sameSubject: true, reason: 'same' })),
    lastFrameOf: vi.fn(async () => lastFrame),
    framesOf: vi.fn(async () => [Buffer.from('f')]),
  }
}

describe('generating a storyboard shot by shot', () => {
  it('chains each shot from the last frame of the one before and ends on the photograph', async () => {
    const deps = fakes()
    const fitted = await photo()
    const result = await generateStoryboardShots({
      storyboard: board([shot(4), shot(8)]),
      fitted,
      provider,
      lastFrameSupported: true,
    }, deps)
    expect(result.clips).toHaveLength(2)
    expect(result.costUsd).toBeCloseTo(0.8)
    const [first, second] = deps.generate.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0])
    expect(first!.durationSeconds).toBe(4)
    expect(first!.lastFrame).toBeUndefined()
    expect(second!.durationSeconds).toBe(8)
    expect(second!.image).toEqual(Buffer.from('previous-last-frame'))
    // The final shot is pinned to the photograph at its end.
    expect(second!.lastFrame).toBeInstanceOf(Buffer)
    expect(deps.verify).toHaveBeenCalledTimes(2)
  })

  it('starts a shot from another photograph on that photograph and holds it against it', async () => {
    const deps = fakes()
    const fitted = await photo()
    const side = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#aa3311' } }).jpeg().toBuffer()
    await generateStoryboardShots({
      storyboard: board([shot(4, { photoIndex: 1 }), shot(8, { photoIndex: 0 })]),
      fitted,
      extraFitted: [side],
      provider,
      lastFrameSupported: true,
    }, deps)
    const [first, second] = deps.generate.mock.calls.map((call) => (call as unknown as [Record<string, Buffer>])[0])
    // A new scene opens on its own photograph, not on the last frame before it.
    expect(second!.image).not.toEqual(Buffer.from('previous-last-frame'))
    expect(second!.image).toEqual(second!.lastFrame)
    expect(first!.image).not.toEqual(second!.image)
    const checked = deps.verify.mock.calls.map((call) => (call as unknown as [{ photograph: Buffer }])[0].photograph)
    expect(checked[0]).toEqual(first!.image)
    expect(checked[1]).toEqual(second!.image)
  })

  it('lets an arrival open without the photograph when the model can still end on it', async () => {
    const deps = fakes()
    await generateStoryboardShots({
      storyboard: board([shot(8, { opensOnPhotograph: false, endsOnPhotograph: true, subject: { motion: 'arrives', description: 'The car lands.' } })]),
      fitted: await photo(),
      provider,
      lastFrameSupported: true,
    }, deps)
    const call = (deps.generate.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(call.image).toBeUndefined()
    expect(call.lastFrame).toBeInstanceOf(Buffer)
  })

  it('opens an arrival on the photograph when the model refuses a closing frame alone', async () => {
    const deps = fakes()
    deps.generate.mockRejectedValueOnce(new Error('first frame required'))
    await generateStoryboardShots({
      storyboard: board([shot(8, { opensOnPhotograph: false, endsOnPhotograph: true })]),
      fitted: await photo(),
      provider,
      lastFrameSupported: true,
    }, deps)
    const retry = (deps.generate.mock.calls[1] as unknown as [Record<string, unknown>])[0]
    expect(retry.image).toBeInstanceOf(Buffer)
  })

  it('stops at the first shot that changes the subject, having reported what it paid', async () => {
    const deps = { ...fakes(), onCost: vi.fn() }
    deps.verify.mockResolvedValueOnce({ sameSubject: true, reason: 'same' }).mockResolvedValueOnce({ sameSubject: false, reason: 'different wheels' })
    const result = generateStoryboardShots({ storyboard: board([shot(4), shot(4), shot(4)]), fitted: await photo(), provider, lastFrameSupported: true }, deps)
    await expect(result).rejects.toBeInstanceOf(ShotSubjectChanged)
    await expect(result).rejects.toMatchObject({ shot: 2, reason: 'different wheels' })
    expect(deps.generate).toHaveBeenCalledTimes(2)
    // Two shots and two subject checks were paid for.
    expect(deps.onCost).toHaveBeenCalledTimes(4)
  })

  it('on the delivered take, keeps every shot and reports which changed the subject', async () => {
    const deps = fakes()
    deps.verify.mockResolvedValueOnce({ sameSubject: false, reason: 'different grille' })
    const result = await generateStoryboardShots({
      storyboard: board([shot(6), shot(6)]),
      fitted: await photo(),
      provider,
      lastFrameSupported: true,
      onSubjectChange: 'record',
    }, deps)
    expect(result.clips).toHaveLength(2)
    expect(result.subjectChanges).toEqual([{ shot: 1, reason: 'different grille' }])
  })

  it('reports what each shot and each subject check cost', async () => {
    const deps = { ...fakes(), onCost: vi.fn() }
    deps.verify.mockResolvedValue({ sameSubject: true, reason: 'same', costUsd: 0.002 } as never)
    await generateStoryboardShots({ storyboard: board([shot(6), shot(6)]), fitted: await photo(), provider, lastFrameSupported: true }, deps)
    expect(deps.onCost.mock.calls.map((call) => call[0])).toEqual([0.4, 0.002, 0.4, 0.002])
  })

  it('reports an unknown cost when any shot reports none', async () => {
    const deps = fakes()
    deps.generate.mockResolvedValueOnce({ bytes: Buffer.from('clip'), costUsd: null as unknown as number })
    const result = await generateStoryboardShots({ storyboard: board([shot(6), shot(6)]), fitted: await photo(), provider, lastFrameSupported: true }, deps)
    expect(result.costUsd).toBeNull()
  })

  it('picks the closest shot length the model renders', () => {
    expect(closestDuration(6, [4, 6, 8])).toBe(6)
    expect(closestDuration(7, [4, 8])).toBe(8)
    expect(closestDuration(6, [])).toBe(6)
  })
})

describe('joining shots', () => {
  it('blends two shots into one clip of their combined length minus the crossfade', async () => {
    const joined = await joinClips([await clip(4, 'red'), await clip(8, 'blue')], { width: 1080, height: 1920 }, 0.5)
    expect(await videoDuration(joined)).toBeCloseTo(11.5, 0)
  })

  it('takes the last frame of a shot at the provider canvas', async () => {
    const frame = await extractLastFrame(await clip(2, 'green'), { width: 1080, height: 1920 })
    const meta = await sharp(frame).metadata()
    expect(meta).toMatchObject({ width: 1080, height: 1920 })
    const pixel = await sharp(frame).resize(1, 1).raw().toBuffer()
    expect(pixel[1]!).toBeGreaterThan(pixel[0]!)
  })
})
