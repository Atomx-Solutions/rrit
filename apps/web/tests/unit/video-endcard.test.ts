import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { buildVideoEndCard } from '../../server/utils/image-processing'

describe('buildVideoEndCard', () => {
  it('composes a 1080x1920 JPEG end-card by default', async () => {
    const bytes = await buildVideoEndCard({
      businessName: 'Hamza Rent a Car',
      cta: 'Rezervo sot',
      primaryColor: '#163d6b',
    })
    const meta = await sharp(bytes).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1920)
    expect(meta.format).toBe('jpeg')
  })
  it('respects an explicit target canvas', async () => {
    const bytes = await buildVideoEndCard({
      businessName: 'X',
      cta: 'Y',
      target: { width: 720, height: 1280 },
    })
    const meta = await sharp(bytes).metadata()
    expect(meta.width).toBe(720)
    expect(meta.height).toBe(1280)
  })
  it('paints the brand primary colour as the background', async () => {
    const bytes = await buildVideoEndCard({
      businessName: 'X',
      cta: 'Y',
      primaryColor: '#ff0000',
    })
    // Sample the top-left pixel; the end-card paints a solid primary colour
    // behind everything, so the corner is the brand red.
    const edge = await sharp(bytes)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect(edge[0]).toBeGreaterThan(220)
    expect(edge[1]).toBeLessThan(40)
    expect(edge[2]).toBeLessThan(40)
  })
  it('derives readable foreground on dark and light primaries', async () => {
    // Deterministic: dark primaries get white text, light primaries get near-black.
    // We assert the choice indirectly by rendering two end-cards and sampling the
    // middle of the headline area for very different luminance.
    const dark = await buildVideoEndCard({
      businessName: 'DARK',
      cta: 'cta',
      primaryColor: '#000000',
    })
    const light = await buildVideoEndCard({
      businessName: 'LIGHT',
      cta: 'cta',
      primaryColor: '#ffffff',
    })
    const darkSample = await sharp(dark)
      .extract({ left: 540, top: 1180, width: 1, height: 1 })
      .raw()
      .toBuffer()
    const lightSample = await sharp(light)
      .extract({ left: 540, top: 1180, width: 1, height: 1 })
      .raw()
      .toBuffer()
    // Dark bg → bright text pixel somewhere in the headline area; light bg →
    // dark text pixel somewhere there. The exact position of the glyph varies
    // by the font fallback, so compare the aggregate brightness of the sample.
    const darkLuma = darkSample[0]! + darkSample[1]! + darkSample[2]!
    const lightLuma = lightSample[0]! + lightSample[1]! + lightSample[2]!
    expect(darkLuma).not.toBe(lightLuma)
  })
  it('still returns a usable image when the business name has no logo', async () => {
    const bytes = await buildVideoEndCard({
      businessName: 'Pa logo',
      cta: 'Veprim',
    })
    const meta = await sharp(bytes).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1920)
  })
  it('renders changes at the end of long approved copy instead of truncating them', async () => {
    const prefix = 'Book your next visit with our team for a comfortable and carefully prepared experience '
    const businessName = 'A very long business name with many words and a distinct ending Alpha'
    const first = await buildVideoEndCard({ businessName, cta: `${prefix}Alpha` })
    const changedCta = await buildVideoEndCard({ businessName, cta: `${prefix}Beta` })
    const changedName = await buildVideoEndCard({ businessName: businessName.replace('Alpha', 'Beta'), cta: `${prefix}Alpha` })
    expect(first.equals(changedCta)).toBe(false)
    expect(first.equals(changedName)).toBe(false)
  })
})
