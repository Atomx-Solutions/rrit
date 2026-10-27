import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Pool } from 'pg'
import { conformDeliveredMedia, type DeliveredMediaTools } from '../../server/utils/delivered-media'
import { conformImageToCanvas } from '../../server/utils/image-processing'
import { conformVideoToCanvas, videoInfo } from '../../server/utils/video-compose'
import type { Post } from '../../shared/schemas/workspace'

const run = promisify(execFile)

async function clip(width: number, height: number) {
  const directory = await mkdtemp(join(tmpdir(), 'rrit-delivered-'))
  try {
    const path = join(directory, 'clip.mp4')
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=1:r=30`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
    ])
    return await readFile(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// A design with a round mark in it: if anything stretches it, it stops being round.
const design = (width: number, height: number) =>
  sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#000000"/></svg>`,
  )).jpeg({ quality: 100 }).toBuffer()

const assetId = '22222222-2222-4222-8222-222222222222'

function post(channel: Post['channel'], extra: Partial<Post> = {}): Post {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Postim',
    caption: 'Tekst',
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
  // The stored brief says the right size; only the file can say otherwise.
  format: '1080x1350' as const,
  createdAt: '2026-11-01T09:00:00.000Z',
}

const generated = {
  planId: '33333333-3333-4333-8333-333333333333',
  slot: 0,
  evidenceHash: 'x'.repeat(64),
  factIds: ['f1'],
  sourceUrls: ['https://example.com/a'],
  rationale: 'because',
  assetId: '11111111-1111-4111-8111-111111111111',
  creative: { eyebrow: 'e', headline: 'headline', cta: 'cta', layout: 'layout', logoZone: 'auto' },
  promptVersion: 'test',
} as Post['aiProvenance']

// Storage holds the given file; the database only points at it. Every write
// is recorded so the test sees what the fix changed.
function world(file: Buffer | null, options: { existingConform?: string } = {}) {
  const writes: { sql: string; values: unknown[] }[] = []
  const uploads: { path: string; bytes: Buffer; type: string }[] = []
  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      if (/^\s*(UPDATE|INSERT)/.test(sql)) {
        writes.push({ sql, values })
        return { rows: [] }
      }
      if (sql.includes('FROM video_renders')) return { rows: file ? [{ id: 'render-1', storage_path: 'video.mp4' }] : [] }
      if (sql.includes("'channel-conform'")) return { rows: options.existingConform ? [{ id: options.existingConform }] : [] }
      if (sql.includes('FROM assets')) return { rows: file ? [{ storage_path: 'image.jpg', bytes: null, name: 'Postim' }] : [] }
      if (sql.includes('FROM businesses')) return { rows: [{ slug: 'hamza' }] }
      return { rows: [] }
    },
  } as unknown as Pool
  const tools: DeliveredMediaTools = {
    download: async () => {
      if (!file) throw new Error('missing')
      return file
    },
    upload: async (path, bytes, type) => {
      uploads.push({ path, bytes, type })
    },
    imageSize: async (bytes) => {
      const meta = await sharp(bytes).metadata()
      return { width: meta.width || 0, height: meta.height || 0 }
    },
    videoSize: (bytes) => videoInfo(bytes),
    conformImage: conformImageToCanvas,
    conformVideo: conformVideoToCanvas,
    reserveStorage: async () => undefined,
  }
  return { db, tools, writes, uploads }
}

const actor = '55555555-5555-4555-8555-555555555555'

describe('the file a channel receives is fixed, never blocked', () => {
  it('publishes a file already on the channel canvas as it is', async () => {
    const { db, tools, writes, uploads } = world(await clip(1080, 1350))
    const result = await conformDeliveredMedia(post('Instagram', { video }), 'business', actor, db, tools)
    expect(result.checks[0]).toMatchObject({ passed: true, message: 'validation.deliveredFormatConfirmed' })
    expect(writes).toEqual([])
    expect(uploads).toEqual([])
  })

  it.each([
    ['Instagram', 1080, 1920, { width: 1080, height: 1350 }],
    ['TikTok', 1080, 1350, { width: 1080, height: 1920 }],
  ] as const)('brings a %s video of %ix%i to the channel canvas and keeps the original', async (channel, width, height, canvas) => {
    const { db, tools, writes, uploads } = world(await clip(width, height))
    const result = await conformDeliveredMedia(post(channel, { video }), 'business', actor, db, tools)
    expect(result.checks[0]).toMatchObject({ passed: true, message: 'validation.deliveredFormatFixed' })
    expect(uploads).toHaveLength(1)
    expect(await videoInfo(uploads[0]!.bytes)).toMatchObject(canvas)
    const update = writes.find((write) => write.sql.includes('UPDATE video_renders'))!
    expect(update.sql).toContain('original_storage_path=COALESCE(original_storage_path,storage_path)')
    expect(update.values.slice(2, 4)).toEqual([canvas.width, canvas.height])
    expect(writes.some((write) => write.sql.includes("'media.channel_conformed'"))).toBe(true)
  })

  it('publishes a conformed copy of an image in the wrong shape, whole and unstretched', async () => {
    const { db, tools, writes, uploads } = world(await design(1080, 1350))
    const result = await conformDeliveredMedia(post('TikTok', { aiProvenance: generated }), 'business', actor, db, tools)
    expect(result.checks[0]).toMatchObject({ passed: true, message: 'validation.deliveredFormatFixed' })
    expect(result.imageAssetId).toBeTruthy()
    const conformed = uploads[0]!.bytes
    expect(await sharp(conformed).metadata()).toMatchObject({ width: 1080, height: 1920 })
    const { data, info } = await sharp(conformed).greyscale().raw().toBuffer({ resolveWithObject: true })
    let left = info.width, right = -1, top = info.height, bottom = -1
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[y * info.width + x]! < 60) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
        }
    expect(Math.abs((right - left) - (bottom - top))).toBeLessThanOrEqual(4)
    const insert = writes.find((write) => write.sql.includes('INSERT INTO assets'))!
    expect(JSON.parse(insert.values[8] as string)).toMatchObject({ source: 'channel-conform', sourceAssetId: assetId, channel: 'TikTok' })
  })

  it('reuses a copy already made for that channel', async () => {
    const { db, tools, uploads } = world(await design(1080, 1350), { existingConform: '66666666-6666-4666-8666-666666666666' })
    const result = await conformDeliveredMedia(post('TikTok'), 'business', actor, db, tools)
    expect(result.imageAssetId).toBe('66666666-6666-4666-8666-666666666666')
    expect(uploads).toEqual([])
  })

  it('leaves a hand-uploaded feed photo to the platform limits', async () => {
    const { db, tools } = world(await design(1080, 1080))
    expect((await conformDeliveredMedia(post('Instagram'), 'business', actor, db, tools)).checks).toEqual([])
  })

  it('reports a file that is missing or unreadable, the only case with nothing to publish', async () => {
    const missing = world(null)
    expect((await conformDeliveredMedia(post('Instagram', { video }), 'business', actor, missing.db, missing.tools)).checks[0])
      .toMatchObject({ passed: false, message: 'server.DELIVERED_FILE_UNAVAILABLE', params: { actual: 'missing' } })
    const broken = world(Buffer.from('not a video'))
    expect((await conformDeliveredMedia(post('Instagram', { video }), 'business', actor, broken.db, broken.tools)).checks[0])
      .toMatchObject({ passed: false, params: { actual: 'unreadable' } })
  })
})
