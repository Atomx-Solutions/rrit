import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { bestBrandColor, dominantColor, firstHexColor } from '../../server/utils/brand-palette'

const square = (background: string, ink?: string) =>
  sharp({ create: { width: 40, height: 40, channels: 4, background } })
    .composite(
      ink
        ? [{ input: { create: { width: 20, height: 20, channels: 4, background: ink } }, left: 10, top: 10 }]
        : [],
    )
    .png()
    .toBuffer()

describe('choosing the brand colour', () => {
  it('takes the ink of a logo, not the white paper around it', async () => {
    const logo = await square('#ffffff', '#c0392b')
    const color = await dominantColor(logo)
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
    expect(parseInt(color!.slice(1, 3), 16)).toBeGreaterThan(150)
  })

  it('picks the vivid colour of a logo over its small dark details', async () => {
    // A logo mostly in shades of blue, with a dark brown coffee detail.
    const shades = ['#0d47a1', '#1565c0', '#1e88e5', '#42a5f5', '#29b6f6']
    const logo = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } })
      .composite([
        ...shades.map((background, index) => ({
          input: { create: { width: 100, height: 12, channels: 4 as const, background } },
          left: 0,
          top: index * 12,
        })),
        { input: { create: { width: 100, height: 30, channels: 4 as const, background: '#381000' } }, left: 0, top: 65 },
      ])
      .png()
      .toBuffer()
    const color = (await dominantColor(logo))!
    const [r, , b] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16)) as [number, number, number]
    expect(b).toBeGreaterThan(r + 80)
  })

  it('finds no colour in an image that is only white, black or grey', async () => {
    expect(await dominantColor(await square('#ffffff', '#000000'))).toBeUndefined()
    expect(await dominantColor(await square('#808080'))).toBeUndefined()
  })

  it('reads the first real hex from the page style palette notes', () => {
    expect(firstHexColor(['warm wood tones', 'deep green #1C8764 accents', '#fff'])).toBe('#1c8764')
    expect(firstHexColor(['no colours here'])).toBeUndefined()
    expect(firstHexColor(undefined)).toBeUndefined()
  })

  it('prefers the logo, then the page, then the kind of business', async () => {
    const logo = await square('#ffffff', '#2e86de')
    const industry = vi.fn(async () => '#aa5500')
    const fromLogo = await bestBrandColor({}, { logo: async () => logo, pagePalette: async () => ['#1c8764'], industry })
    expect(fromLogo?.source).toBe('logo')
    expect(industry).not.toHaveBeenCalled()
    const fromPage = await bestBrandColor({}, { logo: async () => undefined, pagePalette: async () => ['#1c8764'], industry })
    expect(fromPage).toEqual({ primary: '#1c8764', onPrimary: '#ffffff', source: 'page' })
    const fromIndustry = await bestBrandColor(
      { industry: 'Kafene' },
      { logo: async () => undefined, pagePalette: async () => undefined, industry },
    )
    expect(fromIndustry?.source).toBe('industry')
  })

  it('never replaces a better colour with a weaker one', async () => {
    const industry = vi.fn(async () => '#aa5500')
    const logo = vi.fn(async () => undefined)
    const kept = await bestBrandColor(
      { palette: { primary: '#2e86de', source: 'page' } },
      { logo, pagePalette: async () => ['#1c8764'], industry },
    )
    expect(kept).toBeUndefined()
    expect(logo).toHaveBeenCalled()
    expect(industry).not.toHaveBeenCalled()
  })

  it('lets a new logo replace the colour an older logo gave', async () => {
    const logo = await square('#ffffff', '#1e88e5')
    const sources = { logo: async () => logo, pagePalette: async () => undefined, industry: async () => undefined }
    const current = { palette: { primary: '#381000', source: 'logo' as const } }
    expect(await bestBrandColor(current, sources)).toBeUndefined()
    expect((await bestBrandColor(current, sources, 'logo'))?.source).toBe('logo')
  })

  it('gives up quietly when every source fails, so generation goes on', async () => {
    const failing = async () => {
      throw new Error('down')
    }
    await expect(
      bestBrandColor({ industry: 'Kafene' }, { logo: failing, pagePalette: failing, industry: failing }),
    ).resolves.toBeUndefined()
  })
})
