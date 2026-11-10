import { describe, expect, it } from 'vitest'
import { MEDIA_WIDTHS, mediaWidthFor, sizedMediaUrl } from '../../shared/utils/media-width'

const asset = '/api/media/3f2b1c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d'

describe('mediaWidthFor', () => {
  it('rounds a request up to the next allowed width', () => {
    expect(mediaWidthFor(MEDIA_WIDTHS[0] + 1)).toBe(MEDIA_WIDTHS[1])
    expect(mediaWidthFor(MEDIA_WIDTHS[0])).toBe(MEDIA_WIDTHS[0])
  })

  it('has no width past the largest, or for a missing or bad request', () => {
    expect(mediaWidthFor(MEDIA_WIDTHS.at(-1)! + 1)).toBeUndefined()
    expect(mediaWidthFor(Number.NaN)).toBeUndefined()
    expect(mediaWidthFor(0)).toBeUndefined()
  })
})

describe('sizedMediaUrl', () => {
  it('asks for twice the box width of an uploaded image', () => {
    expect(sizedMediaUrl(asset, 64)).toBe(`${asset}?w=${mediaWidthFor(128)}`)
    expect(sizedMediaUrl(asset, '64')).toBe(`${asset}?w=${mediaWidthFor(128)}`)
  })

  it('leaves other URLs, unsized boxes and boxes past the largest width alone', () => {
    expect(sizedMediaUrl('https://cdn.example/a.jpg', 64)).toBe('https://cdn.example/a.jpg')
    expect(sizedMediaUrl(asset, undefined)).toBe(asset)
    expect(sizedMediaUrl(asset, MEDIA_WIDTHS.at(-1)!)).toBe(asset)
  })
})
