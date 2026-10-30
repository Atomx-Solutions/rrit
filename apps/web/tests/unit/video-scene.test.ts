import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { dressVideoScene } from '../../server/utils/video-scene'
import { sceneDressingRule } from '../../server/utils/scene-dressing'

async function photo(width = 720, height = 1280, background = '#335577') {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer()
}

const input = async () => ({
  photograph: await photo(),
  channel: 'TikTok' as const,
  brand: { name: "Alt's Caffe", industry: 'Kafene' },
  post: { title: 'Pauza', caption: 'Kafja e mëngjesit.' },
})

describe('dressVideoScene', () => {
  it('dresses the scene without type and keeps the canvas of the photograph', async () => {
    const paint = vi.fn(async () => ({ bytes: await photo(1024, 1536, '#aa7744'), costUsd: 0.04 }))
    const result = await dressVideoScene(await input(), { paint })
    const prompt = (paint.mock.calls[0] as unknown as [Buffer, string])[1]
    expect(prompt).toContain(sceneDressingRule)
    expect(prompt).toContain('Add no letters')
    expect(result).toMatchObject({ dressed: true, costUsd: 0.04 })
    expect(await sharp(result.bytes).metadata()).toMatchObject({ width: 720, height: 1280 })
  })

  it('shoots the photograph as it is when the scene cannot be dressed', async () => {
    const source = await input()
    const result = await dressVideoScene(source, { paint: vi.fn(async () => { throw new Error('rejected') }) })
    expect(result).toEqual({ bytes: source.photograph, costUsd: 0, dressed: false })
  })
})
