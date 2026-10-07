import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { prepareVideoFirstFrame } from '../../server/utils/image-processing'
import { postVideoPrompt } from '../../server/utils/monthly-ai'

const baseBrief = {
  hook: 'Nise ditën me kafen tonë',
  overlays: [],
  cta: 'Vizito sot',
  durationSeconds: 8,
  format: '1080x1920',
  intent: 'inspire' as const,
  purpose: 'Fto audiencën lokale të fillojë mëngjesin këtu',
  assetDirection: 'Këndvështrim i ngushtë mbi tasin e kafes, kamera lëviz ngadalë',
  visualLayout: 'focal-subject-centre, warm-golden-light',
}
const baseBrand = { name: 'Rrit', industry: 'kafene', audience: 'urbanë', voice: 'ngrohtë' }
const basePost = { channel: 'Instagram' as const, title: 't', caption: 'c', pillar: 'p' }

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

describe('postVideoPrompt', () => {
  it('names Albanian for sq-XK and marks the copy as authoritative in that language', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief, locale: 'sq-XK' })
    expect(prompt).toContain('written in Albanian')
    expect(prompt).toContain(`Hook: "${baseBrief.hook}"`)
    expect(prompt).toContain(`Call to action: "${baseBrief.cta}"`)
    expect(prompt).toContain('Never translate')
  })
  it('names English for en-US', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief, locale: 'en-US' })
    expect(prompt).toContain('written in English')
  })
  it('names German for de-DE', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief, locale: 'de-DE' })
    expect(prompt).toContain('written in German')
  })
  it('defaults to Albanian when no locale is passed', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief })
    expect(prompt).toContain('written in Albanian')
  })
  it('includes the prepared-first-frame contract and forbids letterboxing', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief })
    expect(prompt).toContain('already been prepared by the application')
    expect(prompt).toContain('no letterbox')
    expect(prompt).toContain('do not add black, white or blurred bars')
  })
  it('carries the strategy direction and does not restore the fixed camera-move menu', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief })
    expect(prompt).toContain('Content intent: inspire')
    expect(prompt).toContain('Purpose of this specific video')
    expect(prompt).toContain(baseBrief.assetDirection)
    expect(prompt).toContain(baseBrief.visualLayout)
    expect(prompt).not.toMatch(/a slow push, a gentle parallax drift, a restrained handheld settle or a single arc/)
  })
  it('replaces the "dissolve naturally" instruction with stable-text rules', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief })
    expect(prompt).not.toContain('dissolve naturally')
    expect(prompt).toContain('Overlay stability contract')
    expect(prompt).toContain('must remain visually stable')
    expect(prompt).toContain('do not regenerate letters individually')
    expect(prompt).toContain('leave that one phrase out')
  })
  it('still parses a legacy brief that lacks the Phase 1 fields', () => {
    const legacy = { hook: 'x', overlays: [], cta: 'y', durationSeconds: 8, format: '1080x1920' }
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: legacy })
    expect(prompt).toContain('Hook: "x"')
    expect(prompt).toContain('Call to action: "y"')
    expect(prompt).not.toContain('Content intent:')
  })
})
