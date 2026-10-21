import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Pool } from 'pg'
import { localPostChecks } from '../../server/utils/post-validation'
import { buildVideoOverlayLayers, chooseLogoPlacement } from '../../server/utils/image-processing'
import { channelFrame, coveredZonesInstruction } from '../../server/utils/monthly-ai'
import { channelCanvas, channelUiInsets } from '../../shared/schemas/channel-format'
import type { Post } from '../../shared/schemas/workspace'

const assetId = '22222222-2222-4222-8222-222222222222'
const limits = {
  caption_characters: 2200,
  image_bytes: 2097152,
  minimum_width: 320,
  maximum_width: 1440,
  minimum_aspect_ratio: 0.8,
  maximum_aspect_ratio: 1.91,
  max_hashtags: 30,
  daily_ai_requests: 30,
}

// Answers only the reads localPostChecks makes for a post without AI evidence.
function fakeDb(media: { asset?: { width: number; height: number }; render?: { width: number; height: number; status?: string } }) {
  return {
    query: async (sql: string) => {
      if (sql.includes('app_settings')) return { rows: [{ value: limits }] }
      if (sql.includes('FROM assets'))
        return { rows: media.asset ? [{ rights: true, size: 1000, ...media.asset }] : [] }
      if (sql.includes('FROM video_renders'))
        return {
          rows: media.render ? [{ status: 'ready', storage_path: 'x.mp4', composed: true, ...media.render }] : [],
        }
      return { rows: [] }
    },
  } as unknown as Pool
}

function post(channel: Post['channel'], extra: Partial<Post> = {}): Post {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Postim',
    caption: 'Një postim i vërtetë.',
    status: 'approved',
    channel,
    format: 'static',
    image: `/api/media/${assetId}`,
    pillar: 'brand',
    scheduledAt: null,
    version: 1,
    history: [],
    policy: 'pass',
    policyReason: '',
    ...extra,
  }
}

const video = {
  status: 'ready' as const,
  sourceAssetIds: ['11111111-1111-4111-8111-111111111111'],
  hook: 'Hook',
  overlays: [],
  cta: 'Vizito',
  durationSeconds: 6,
  format: '1080x1350' as const,
  createdAt: '2026-11-01T09:00:00.000Z',
}

async function canvasCheck(item: Post, media: Parameters<typeof fakeDb>[0]) {
  return (await localPostChecks(item, 'business', fakeDb(media))).find((check) => check.key === 'channel_canvas')
}

describe('publishing validation of the channel canvas', () => {
  it.each([
    ['Instagram', { width: 1080, height: 1350 }, true],
    ['Facebook', { width: 1080, height: 1350 }, true],
    ['TikTok', { width: 1080, height: 1920 }, true],
    // A video rendered at the old universal size reads fine but cannot go to a feed.
    ['Instagram', { width: 1080, height: 1920 }, false],
    ['Facebook', { width: 1080, height: 1920 }, false],
    ['TikTok', { width: 1080, height: 1350 }, false],
  ] as const)('%s video %o passes: %s', async (channel, render, passed) => {
    const check = await canvasCheck(post(channel, { video }), { asset: { width: 1080, height: 1350 }, render })
    expect(check?.passed).toBe(passed)
    if (!passed) expect(check?.message).toBe('server.VIDEO_CHANNEL_FORMAT_MISMATCH')
  })

  it.each([
    ['Instagram', { width: 1080, height: 1350 }, true],
    ['Facebook', { width: 1080, height: 1350 }, true],
    ['TikTok', { width: 1080, height: 1920 }, true],
    ['TikTok', { width: 1080, height: 1350 }, false],
    ['Instagram', { width: 1080, height: 1920 }, false],
  ] as const)('%s generated image %o passes: %s', async (channel, asset, passed) => {
    const generated = post(channel, {
      aiProvenance: {
        planId: '33333333-3333-4333-8333-333333333333',
        slot: 0,
        evidenceHash: 'x'.repeat(64),
        factIds: ['f1'],
        sourceUrls: ['https://example.com/a'],
        rationale: 'because',
        assetId: '11111111-1111-4111-8111-111111111111',
        creative: { eyebrow: 'e', headline: 'headline', cta: 'cta', layout: 'layout', logoZone: 'auto' },
        promptVersion: 'test',
      } as Post['aiProvenance'],
    })
    const check = await canvasCheck(generated, { asset })
    expect(check?.passed).toBe(passed)
  })

  it('never publishes a video whose latest render was blocked', async () => {
    const checks = await localPostChecks(
      post('Instagram', { video: { ...video, status: 'failed', failure: { code: 'subject_changed', detail: 'different wheels', at: '2026-10-21T10:00:00.000Z' } } }),
      'business',
      fakeDb({ asset: { width: 1080, height: 1350 }, render: { width: 1080, height: 1350, status: 'failed' } }),
    )
    expect(checks.find((check) => check.key === 'video_render')?.passed).toBe(false)
  })

  it('warns about a delivered video the subject check doubted, without blocking it', async () => {
    const checks = await localPostChecks(
      post('Instagram', { video: { ...video, subjectWarning: { detail: 'Shot 2: different wheels', at: '2026-10-21T10:00:00.000Z' } } }),
      'business',
      fakeDb({ asset: { width: 1080, height: 1350 }, render: { width: 1080, height: 1350 } }),
    )
    const warning = checks.find((check) => check.key === 'video_subject')
    expect(warning).toMatchObject({ passed: false, advisory: true, params: { detail: 'Shot 2: different wheels' } })
    expect(checks.find((check) => check.key === 'video_render')?.passed).toBe(true)
  })

  it('leaves a hand-uploaded photo to the platform size limits', async () => {
    expect(await canvasCheck(post('Instagram'), { asset: { width: 1080, height: 1080 } })).toBeUndefined()
  })
})

describe('channel interface zones', () => {
  it('keeps the logo out of the zones TikTok covers', async () => {
    const canvas = channelCanvas('TikTok')
    const image = await sharp({ create: { ...canvas, channels: 3, background: '#808080' } }).jpeg().toBuffer()
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#000000ff' } }).png().toBuffer()
    const covered = channelUiInsets('TikTok')
    for (const zone of ['auto', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const placement = await chooseLogoPlacement(image, logo, zone, covered)
      expect(placement.top).toBeGreaterThanOrEqual(canvas.height * covered.top)
      expect(placement.top + 100).toBeLessThanOrEqual(canvas.height * (1 - covered.bottom))
      expect(placement.left + 200).toBeLessThanOrEqual(canvas.width * (1 - covered.right))
    }
  })

  it('keeps video type inside the area TikTok leaves visible', async () => {
    const canvas = channelCanvas('TikTok')
    const covered = channelUiInsets('TikTok')
    for (const zone of ['top', 'bottom'] as const) {
      const overlay = await buildVideoOverlayLayers({
        businessName: 'Hamza Rent a Car',
        headline: 'Makina gati për udhëtimin tënd',
        cta: 'Rezervo sot',
        zone,
        target: canvas,
        covered,
      })
      expect(overlay.extent.bottom).toBeLessThanOrEqual(canvas.height * (1 - covered.bottom))
      expect(overlay.extent.top).toBeGreaterThanOrEqual(canvas.height * covered.top)
    }
  })

  it('tells the image model and the reviewer about the covered zones, only for TikTok', () => {
    expect(coveredZonesInstruction('TikTok')).toContain('the top 7%, the right 13%, the bottom 25%')
    expect(coveredZonesInstruction('Instagram')).toBe('')
    expect(channelFrame('TikTok')).toMatchObject({ pixels: '1080x1920', ratio: '9:16' })
    expect(channelFrame('Facebook').coveredByInterface).toEqual({ top: '0%', right: '0%', bottom: '0%', left: '0%' })
  })
})
