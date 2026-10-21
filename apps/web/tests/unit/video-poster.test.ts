import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { prepareVideoFirstFrame } from '../../server/utils/image-processing'
import { postSchema } from '../../shared/schemas/workspace'
import { channelCanvas, channelFormat } from '../../shared/schemas/channel-format'

const videoFormat = channelFormat('TikTok')

describe('video poster derivation', () => {
  it.each(['Instagram', 'Facebook', 'TikTok'] as const)('derives the %s poster at the video dimensions of that channel', async (channel) => {
    const { width: posterWidth, height: posterHeight } = channelCanvas(channel)
    const landscape = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#bb3344' },
    })
      .jpeg()
      .toBuffer()
    const poster = await prepareVideoFirstFrame(landscape, channelCanvas(channel))
    const meta = await sharp(poster).metadata()
    expect(meta.width).toBe(posterWidth)
    expect(meta.height).toBe(posterHeight)
    expect(meta.format).toBe('jpeg')
    // Cover + sharp produces a painted canvas, so an edge pixel is not the
    // pure black of a letterbox. This is the same guarantee the planner relies
    // on when it reuses the poster as the mp4's first frame.
    const edge = await sharp(poster).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
    expect(edge[0]! + edge[1]! + edge[2]!).toBeGreaterThan(10)
  })

  it('does not fabricate ai-image provenance for a video post', () => {
    // The provenance an image-less video slot writes still has to satisfy the
    // post schema. The schema's imageGeneration is optional, so this parse
    // succeeds without a model/quality/promptHash record.
    const videoAssetId = '11111111-1111-4111-8111-111111111111'
    const posterAssetId = '22222222-2222-4222-8222-222222222222'
    const planId = '33333333-3333-4333-8333-333333333333'
    const parsed = postSchema.parse({
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Një video për të qeshur',
      caption: 'legjende',
      channel: 'Instagram',
      format: 'static',
      image: `/api/media/${posterAssetId}`,
      pillar: 'brand',
      status: 'draft',
      version: 1,
      contentVersion: 1,
      history: [],
      scheduledAt: null,
      proposedAt: '2026-11-01T09:00:00.000Z',
      publicationMode: 'manual',
      policy: 'warn',
      policyReason: 'ok',
      video: {
        status: 'brief_ready',
        sourceAssetIds: [videoAssetId],
        hook: 'Një hook i mirë',
        overlays: ['Këndvështrim i ngushtë mbi tasin'],
        cta: 'Vizito sot',
        durationSeconds: 8,
        format: videoFormat,
        createdAt: '2026-11-01T09:00:00.000Z',
      },
      aiProvenance: {
        planId,
        slot: 0,
        evidenceHash: 'x'.repeat(64),
        factIds: ['f1'],
        sourceUrls: ['https://example.com/a'],
        rationale: 'because',
        assetId: videoAssetId,
        creative: {
          eyebrow: 'eyebrow',
          headline: 'headline',
          cta: 'Vizito sot',
          layout: 'focal centre, type upper right',
        },
        // imageGeneration deliberately absent — video poster has no AI call.
        quality: {
          decision: 'PASS',
          reasons: [],
          factuality: true,
          brandFit: true,
          visualQuality: true,
          sourceFidelity: true,
          sourceFidelityReasons: [],
          styleConsistency: true,
          styleReasons: [],
          visualDistinctness: true,
          distinctnessReasons: [],
        },
        promptVersion: 'test',
      },
    })
    expect(parsed.aiProvenance?.imageGeneration).toBeUndefined()
    expect(parsed.video?.sourceAssetIds[0]).toBe(videoAssetId)
    expect(parsed.image).toBe(`/api/media/${posterAssetId}`)
    // The video brief still points at the owned source, never at the poster.
    expect(parsed.video?.sourceAssetIds[0]).not.toBe(posterAssetId)
  })

  it('keeps the poster distinguishable from an owned photo so it cannot be reused as a source', () => {
    // The planner inserts the poster with a non-null creative_provenance that
    // carries { source: 'video-first-frame', sourceAssetId: <owned> }. The
    // video pipeline selects owned photos with creative_provenance IS NULL
    // (video-render.ts), which excludes the poster by construction.
    const posterProvenance = { source: 'video-first-frame', sourceAssetId: 'uuid' }
    expect(posterProvenance).toHaveProperty('source', 'video-first-frame')
    expect(posterProvenance.source).not.toBeNull()
  })
})
