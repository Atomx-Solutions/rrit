import { describe, expect, it } from 'vitest'
import { looksLikeMp3, musicMoodDetailsSchema, musicMoodSlug, musicTrackDetailsSchema, musicTrackSlug } from '../../server/utils/admin-music'

describe('admin music library', () => {
  it('accepts an MP3 with an ID3 tag or a bare MPEG frame, and nothing else', () => {
    expect(looksLikeMp3(Buffer.from('ID3\u0004\u0000rest', 'latin1'))).toBe(true)
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe(true)
    expect(looksLikeMp3(Buffer.from('RIFF....WAVE', 'latin1'))).toBe(false)
    expect(looksLikeMp3(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(looksLikeMp3(Buffer.from('ID'))).toBe(false)
  })

  it('names a track after its title, so a second track of the same title still gets its own file', () => {
    expect(musicTrackSlug('Local Forecast - Elevator', 'a1b2c3d4')).toBe('local-forecast-elevator-a1b2c3d4')
    expect(musicTrackSlug('Këngë e Qetë', 'a1b2c3d4')).toBe('kenge-e-qete-a1b2c3d4')
    expect(musicTrackSlug('音楽', 'a1b2c3d4')).toBe('track-a1b2c3d4')
    expect(musicTrackSlug('Leblon')).not.toBe(musicTrackSlug('Leblon'))
    expect(musicTrackSlug('Leblon', 'a1b2c3d4')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('takes a track with a title and mood, and an artist when there is one', () => {
    const details = { title: ' Leblon ', artist: 'Kevin MacLeod', mood: 'calm' }
    expect(musicTrackDetailsSchema.parse(details)).toEqual({ title: 'Leblon', artist: 'Kevin MacLeod', mood: 'calm' })
    expect(musicTrackDetailsSchema.parse({ title: 'Leblon', mood: 'calm' })).toEqual({ title: 'Leblon', artist: '', mood: 'calm' })
    expect(musicTrackDetailsSchema.safeParse({ ...details, title: '  ' }).success).toBe(false)
    expect(musicTrackDetailsSchema.safeParse({ ...details, mood: 'Not A Slug' }).success).toBe(false)
  })

  it('names a mood in each app language with English required, and drops empty names', () => {
    expect(musicMoodDetailsSchema.parse({ names: { en: 'Romantic', sq: 'Romantike', de: '' } }))
      .toEqual({ names: { en: 'Romantic', sq: 'Romantike' } })
    expect(musicMoodDetailsSchema.safeParse({ names: { sq: 'Romantike' } }).success).toBe(false)
    expect(musicMoodDetailsSchema.safeParse({ names: { en: 'Romantic', xx: 'Other' } }).success).toBe(false)
  })

  it('gives a new mood the slug of its English name', () => {
    expect(musicMoodSlug('Chill Lounge')).toBe('chill-lounge')
    expect(musicMoodSlug('Café')).toBe('cafe')
    expect(musicMoodSlug('音楽', 'abc123')).toBe('mood-abc123')
  })
})
