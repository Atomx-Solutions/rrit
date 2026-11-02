import { describe, expect, it } from 'vitest'
import { musicForVideo, publishedCaption, videoMusicChoiceSchema, videoMusicSchema } from '../../shared/schemas/music'
import { promptEvidence, type PlannerEvidence } from '../../server/utils/monthly-planner-domain'

const trackId = '7f1c2a9e-3b4d-4e5f-8a6b-1c2d3e4f5a6b'
const credit = 'Music: "Leblon" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0'

describe('publishedCaption', () => {
  it('adds the credit of a library track at the end', () => {
    expect(publishedCaption({
      caption: 'Na gjeni sot.  ',
      video: { music: { source: 'library', trackId, title: 'Leblon', credit } },
    })).toBe(`Na gjeni sot.\n\n${credit}`)
  })

  it('leaves the caption alone without a credit to give', () => {
    for (const music of [
      { source: 'ai' as const },
      { source: 'none' as const },
      { source: 'library' as const, trackId, title: 'Leblon' },
      undefined,
    ])
      expect(publishedCaption({ caption: 'Na gjeni sot.', video: { music } })).toBe('Na gjeni sot.')
    expect(publishedCaption({ caption: 'Pa video.' })).toBe('Pa video.')
  })

  it('never repeats a credit the business already wrote', () => {
    const caption = `Na gjeni sot.\n\n${credit}`
    expect(publishedCaption({
      caption,
      video: { music: { source: 'library', trackId, title: 'Leblon', credit } },
    })).toBe(caption)
  })
})

describe('musicForVideo', () => {
  const library = { source: 'library' as const, trackId, title: 'Leblon', credit }
  const request = [
    { channel: 'Instagram' as const, music: { source: 'ai' as const } },
    { channel: 'TikTok' as const, music: library },
    { channel: 'Instagram' as const, music: { source: 'none' as const } },
  ]

  it('gives each video the music chosen for it on its own platform', () => {
    expect(musicForVideo(request, 'Instagram', 0)).toEqual({ source: 'ai' })
    expect(musicForVideo(request, 'Instagram', 1)).toEqual({ source: 'none' })
    expect(musicForVideo(request, 'TikTok', 0)).toEqual(library)
  })

  it('repeats a platform\'s last choice, and has nothing for a platform without one', () => {
    expect(musicForVideo(request, 'TikTok', 3)).toEqual(library)
    expect(musicForVideo(request, 'Facebook', 0)).toBeUndefined()
    expect(musicForVideo(undefined, 'Instagram', 0)).toBeUndefined()
  })
})

describe('videoMusicChoiceSchema', () => {
  it('needs a track only when the music comes from the library', () => {
    expect(videoMusicChoiceSchema.safeParse({ source: 'library' }).success).toBe(false)
    expect(videoMusicChoiceSchema.safeParse({ source: 'library', trackId }).success).toBe(true)
    expect(videoMusicChoiceSchema.safeParse({ source: 'none' }).success).toBe(true)
    expect(videoMusicChoiceSchema.safeParse({ source: 'loud' }).success).toBe(false)
  })
})

describe('promptEvidence', () => {
  it('keeps the chosen music out of what the writer sees', () => {
    const evidence = {
      photoSelection: {
        mode: 'auto',
        selectedAssetIds: [],
        selectedVideoAssetIds: [],
        videoMusic: [{ channel: 'TikTok', music: { source: 'library', trackId, title: 'Leblon', credit } }],
      },
    } as unknown as PlannerEvidence
    expect(promptEvidence(evidence).photoSelection).toEqual({ mode: 'auto', selectedAssetIds: [], selectedVideoAssetIds: [] })
  })
})

describe('videoMusicSchema', () => {
  it('requires a track for library music', () => {
    expect(videoMusicSchema.safeParse({ source: 'library' }).success).toBe(false)
    expect(videoMusicSchema.safeParse({ source: 'library', trackId, title: 'Leblon' }).success).toBe(true)
    expect(videoMusicSchema.safeParse({ source: 'ai' }).success).toBe(true)
  })
})
