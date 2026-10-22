import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  blendBand,
  cropLoss,
  fitPhotoToChannel,
  outpaintLayout,
  planPhotoFit,
  photoFitThresholds,
  restorePhotograph,
  seamLimit,
  seamStrength,
} from '../../server/utils/photo-fit'
import { channelCanvas } from '../../shared/schemas/channel-format'

afterEach(() => vi.unstubAllEnvs())

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).jpeg({ quality: 100 }).toBuffer()

// A photograph with a round subject: if anything stretches it, it stops being round.
const roundSubject = (width: number, height: number) =>
  sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#000000"/></svg>`,
  )).jpeg({ quality: 100 }).toBuffer()

async function roundness(image: Buffer) {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true })
  // The width and height of the dark subject's bounding box: equal for a circle.
  let left = info.width, right = -1, top = info.height, bottom = -1
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[y * info.width + x]! < 128) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
  return Math.abs((right - left) - (bottom - top))
}

describe('how far a photograph is from its channel canvas', () => {
  it('uses a photograph already in the channel shape as it is', () => {
    expect(planPhotoFit({ width: 2160, height: 2700 }, channelCanvas('Instagram'))).toBe('as_is')
    expect(planPhotoFit({ width: 1080, height: 1920 }, channelCanvas('TikTok'))).toBe('as_is')
  })

  it('crops a photograph that is a little off', () => {
    // 3:4 into 4:5 discards about 6%.
    expect(cropLoss({ width: 3000, height: 4000 }, channelCanvas('Facebook'))).toBeCloseTo(0.0625, 3)
    expect(planPhotoFit({ width: 3000, height: 4000 }, channelCanvas('Facebook'))).toBe('crop')
  })

  it('extends a photograph that is far off instead of cutting it to a fragment', () => {
    expect(planPhotoFit({ width: 1920, height: 1080 }, channelCanvas('TikTok'))).toBe('outpaint')
    expect(planPhotoFit({ width: 1920, height: 1080 }, channelCanvas('Instagram'))).toBe('outpaint')
  })

  it('takes its limits from configuration', () => {
    vi.stubEnv('PHOTO_FIT_MAX_CROP_LOSS', '0.6')
    expect(photoFitThresholds().cropLoss).toBe(0.6)
    expect(planPhotoFit({ width: 1920, height: 1080 }, channelCanvas('Instagram'))).toBe('crop')
  })
})

describe('extending a photograph to the canvas', () => {
  it('crops only as far as allowed, then places the photograph whole', async () => {
    const layout = await outpaintLayout(await solid(1920, 1080, '#336699'), channelCanvas('TikTok'), 0.2)
    // 16:9 narrowed by 20% is about 1.42:1, set across the full 1080 width.
    expect(layout.placement.width).toBe(1080)
    expect(layout.placement.height).toBe(Math.round(1080 / ((1920 / 1080) * 0.8)))
    expect(layout.placement.top).toBe(Math.round((1920 - layout.placement.height) / 2))
    expect(await sharp(layout.guide).metadata()).toMatchObject({ width: 1080, height: 1920 })
  })

  it('lays the photograph back over the painting with its own pixels', async () => {
    const canvas = channelCanvas('TikTok')
    const layout = await outpaintLayout(await solid(1920, 1080, '#2050a0'), canvas, 0.2)
    // A painting that redrew the middle in another colour must not survive.
    const painted = await solid(canvas.width, canvas.height, '#c03020')
    const restored = await restorePhotograph(painted, layout, canvas)
    expect(await sharp(restored).metadata()).toMatchObject(canvas)
    const band = blendBand(canvas)
    const { placement } = layout
    const inner = await sharp(restored)
      .extract({ left: placement.left + band, top: placement.top + band, width: placement.width - band * 2, height: placement.height - band * 2 })
      .resize(1, 1)
      .raw()
      .toBuffer()
    expect(Math.abs(inner[0]! - 0x20)).toBeLessThan(6)
    expect(Math.abs(inner[1]! - 0x50)).toBeLessThan(6)
    expect(Math.abs(inner[2]! - 0xa0)).toBeLessThan(6)
  })

  it('detects a hard line where the photograph ends', async () => {
    const canvas = channelCanvas('TikTok')
    const layout = await outpaintLayout(await solid(1920, 1080, '#ffffff'), canvas, 0.2)
    const hard = await restorePhotograph(await solid(canvas.width, canvas.height, '#000000'), layout, canvas)
    const seamless = await restorePhotograph(await solid(canvas.width, canvas.height, '#ffffff'), layout, canvas)
    expect(await seamStrength(hard, layout.placement)).toBeGreaterThan(seamLimit())
    expect(await seamStrength(seamless, layout.placement)).toBeLessThanOrEqual(seamLimit())
  })
})

describe('fitting a photograph to its channel', () => {
  it('returns the extension when it passes the seam check and review', async () => {
    // A painting that continues the plain scene leaves no seam.
    const scene = await solid(1080, 1920, '#4a7a4a')
    const outpaint = vi.fn(async () => ({ bytes: scene, costUsd: 0.04 }))
    const review = vi.fn(async () => ({ natural: true, reason: 'ok' }))
    const fit = await fitPhotoToChannel(await solid(1920, 1080, '#4a7a4a'), 'TikTok', { outpaint, review })
    expect(fit.mode).toBe('outpaint')
    expect(fit.costUsd).toBeCloseTo(0.04)
    expect(await sharp(fit.bytes).metadata()).toMatchObject(channelCanvas('TikTok'))
    expect(outpaint).toHaveBeenCalledTimes(1)
  })

  it('charges what the extension review cost too', async () => {
    const scene = await solid(1080, 1920, '#4a7a4a')
    const fit = await fitPhotoToChannel(await solid(1920, 1080, '#4a7a4a'), 'TikTok', {
      outpaint: async () => ({ bytes: scene, costUsd: 0.04 }),
      review: async () => ({ natural: true, reason: 'ok', costUsd: 0.003 }),
    })
    expect(fit.costUsd).toBeCloseTo(0.043)
  })

  it('tries once more after a rejected extension, then crops instead', async () => {
    const canvas = channelCanvas('Instagram')
    const scene = await solid(canvas.width, canvas.height, '#4a7a4a')
    const outpaint = vi.fn(async () => ({ bytes: scene, costUsd: 0.04 }))
    const review = vi.fn(async () => ({ natural: false, reason: 'light does not match' }))
    const fit = await fitPhotoToChannel(await solid(1920, 1080, '#4a7a4a'), 'Instagram', { outpaint, review })
    expect(outpaint).toHaveBeenCalledTimes(2)
    expect(fit.mode).toBe('crop_fallback')
    // Both attempts were paid for, so both are charged.
    expect(fit.costUsd).toBeCloseTo(0.08)
    expect(fit.reasons).toEqual(['review:light does not match', 'review:light does not match'])
    expect(await sharp(fit.bytes).metadata()).toMatchObject(canvas)
  })

  it('rejects an extension with a visible line and crops instead', async () => {
    const outpaint = vi.fn(async (guide: Buffer) => ({ bytes: guide }))
    const fit = await fitPhotoToChannel(await solid(1920, 1080, '#4a7a4a'), 'TikTok', { outpaint })
    expect(outpaint).toHaveBeenCalledTimes(2)
    expect(fit.mode).toBe('crop_fallback')
    expect(fit.reasons.every((reason) => reason.startsWith('seam:'))).toBe(true)
  })

  it('crops instead when the provider fails', async () => {
    const outpaint = vi.fn(async () => {
      throw new Error('outpaint_rejected:500')
    })
    const fit = await fitPhotoToChannel(await solid(1920, 1080, '#4a7a4a'), 'TikTok', { outpaint })
    expect(fit.mode).toBe('crop_fallback')
    expect(fit.reasons[0]).toContain('outpaint_rejected')
  })

  it('never stretches the subject, whichever way the photograph is fitted', async () => {
    const landscape = await roundSubject(1920, 1080)
    const white = await solid(1080, 1920, '#ffffff')
    const outpaint = async () => ({ bytes: white })
    for (const channel of ['Instagram', 'TikTok'] as const) {
      const cropped = await fitPhotoToChannel(landscape, channel)
      const extended = await fitPhotoToChannel(landscape, channel, { outpaint })
      expect(extended.mode).toBe('outpaint')
      expect(await roundness(cropped.bytes)).toBeLessThanOrEqual(4)
      expect(await roundness(extended.bytes)).toBeLessThanOrEqual(4)
    }
  })

  it('gives the video a photograph on the channel canvas, never turned on its side', async () => {
    for (const channel of ['Instagram', 'TikTok'] as const) {
      const fitted = (await fitPhotoToChannel(await solid(1920, 1080, '#888888'), channel)).bytes
      expect(await sharp(fitted).metadata()).toMatchObject(channelCanvas(channel))
    }
  })
})
