import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  channelCanvas,
  channelFormat,
  matchesChannelCanvas,
  videoFormats,
} from '../../shared/schemas/channel-format'
import { postSchema } from '../../shared/schemas/workspace'
import { providerCanvasFor } from '../../server/utils/ai-video-provider'
import { padFrameToCanvas } from '../../server/utils/image-processing'

function videoPost(channel: 'Instagram' | 'Facebook' | 'TikTok', format: string) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Një video',
    caption: 'legjende',
    channel,
    format: 'static',
    image: '/api/media/22222222-2222-4222-8222-222222222222',
    pillar: 'brand',
    status: 'draft',
    version: 1,
    history: [],
    scheduledAt: null,
    policy: 'warn',
    policyReason: 'ok',
    video: {
      status: 'ready',
      sourceAssetIds: ['11111111-1111-4111-8111-111111111111'],
      hook: 'Një hook',
      overlays: [],
      cta: 'Vizito sot',
      durationSeconds: 6,
      format,
      createdAt: '2026-11-01T09:00:00.000Z',
    },
  }
}

describe('channel canvas', () => {
  it('gives Instagram and Facebook the 4:5 feed canvas for photos and videos', () => {
    for (const channel of ['Instagram', 'Facebook'] as const) {
      expect(channelCanvas(channel)).toEqual({ width: 1080, height: 1350 })
      expect(channelFormat(channel)).toBe('1080x1350')
    }
  })

  it('gives TikTok the full-screen 9:16 canvas for photos and videos', () => {
    expect(channelCanvas('TikTok')).toEqual({ width: 1080, height: 1920 })
    expect(channelFormat('TikTok')).toBe('1080x1920')
  })

  it('accepts a delivered file only on its own channel canvas', () => {
    expect(matchesChannelCanvas('Instagram', { width: 1080, height: 1350 })).toBe(true)
    expect(matchesChannelCanvas('Instagram', { width: 1080, height: 1920 })).toBe(false)
    expect(matchesChannelCanvas('TikTok', { width: 1080, height: 1920 })).toBe(true)
    expect(matchesChannelCanvas('TikTok', { width: 1080, height: 1350 })).toBe(false)
    // Encoder rounding is still the same canvas.
    expect(matchesChannelCanvas('Facebook', { width: 1080, height: 1352 })).toBe(true)
  })
})

describe('stored video briefs', () => {
  it('accepts the new per-channel formats', () => {
    expect(postSchema.parse(videoPost('Instagram', '1080x1350')).video?.format).toBe('1080x1350')
    expect(postSchema.parse(videoPost('TikTok', '1080x1920')).video?.format).toBe('1080x1920')
  })

  it('keeps reading videos rendered at the old universal 1080x1920 on any channel', () => {
    for (const channel of ['Instagram', 'Facebook', 'TikTok'] as const)
      expect(postSchema.parse(videoPost(channel, '1080x1920')).video?.format).toBe('1080x1920')
  })

  it('rejects a format no channel uses', () => {
    expect(() => postSchema.parse(videoPost('Instagram', '1080x1080'))).toThrow()
    expect(videoFormats).toEqual(['1080x1350', '1080x1920'])
  })
})

describe('video provider canvas', () => {
  const veo = ['16:9', '9:16']

  it('places a 4:5 feed video whole inside the 9:16 Veo canvas', () => {
    expect(providerCanvasFor(channelCanvas('Instagram'), veo)).toEqual({
      canvas: { width: 1080, height: 1920 },
      aspectRatio: '9:16',
    })
  })

  it('asks for TikTok 9:16 as it is', () => {
    expect(providerCanvasFor(channelCanvas('TikTok'), veo)).toEqual({
      canvas: { width: 1080, height: 1920 },
      aspectRatio: '9:16',
    })
  })

  it('uses the closest ratio a model offers, and the canvas itself when none are published', () => {
    expect(providerCanvasFor(channelCanvas('Facebook'), ['3:4', '9:16', '16:9'])).toEqual({
      canvas: { width: 1080, height: 1440 },
      aspectRatio: '3:4',
    })
    expect(providerCanvasFor(channelCanvas('Facebook'), [])).toEqual({
      canvas: { width: 1080, height: 1350 },
      aspectRatio: '4:5',
    })
  })

  it('pads a frame to the provider canvas without cutting or moving any of its pixels', async () => {
    const frame = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#2050a0' } })
      .png()
      .toBuffer()
    const padded = await padFrameToCanvas(frame, { width: 1080, height: 1920 })
    const meta = await sharp(padded).metadata()
    expect(meta).toMatchObject({ width: 1080, height: 1920 })
    // The centre crop the composer performs gives the frame back.
    const top = Math.round((1920 - 1350) / 2)
    const centre = await sharp(padded)
      .extract({ left: 0, top, width: 1080, height: 1350 })
      .resize(1, 1)
      .raw()
      .toBuffer()
    expect(Math.abs(centre[0]! - 0x20)).toBeLessThan(8)
    expect(Math.abs(centre[1]! - 0x50)).toBeLessThan(8)
    expect(Math.abs(centre[2]! - 0xa0)).toBeLessThan(8)
  })
})
