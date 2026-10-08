import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { prepareVideoFirstFrame } from '../../server/utils/image-processing'

describe('prepareVideoFirstFrame', () => {
  it('converts a landscape source to the exact target vertical dimensions with no padding', async () => {
    const landscape = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#44aa88' },
    })
      .jpeg()
      .toBuffer()
    const prepared = await prepareVideoFirstFrame(landscape, { width: 1080, height: 1920 })
    const meta = await sharp(prepared).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1920)
    expect(meta.format).toBe('jpeg')
    const sampled = await sharp(prepared).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
    // Cover keeps the full canvas painted with content, so an edge pixel is not
    // the pure black that letterboxing would produce.
    expect(sampled[0]! + sampled[1]! + sampled[2]!).toBeGreaterThan(10)
  })
  it('leaves the source buffer untouched', async () => {
    const landscape = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#223344' },
    })
      .jpeg()
      .toBuffer()
    const copy = Buffer.from(landscape)
    await prepareVideoFirstFrame(landscape, { width: 1080, height: 1920 })
    expect(landscape.equals(copy)).toBe(true)
  })
})
