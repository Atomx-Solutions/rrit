import { describe, expect, it } from 'vitest'
import { galleryAssets } from '../../app/utils/gallery-assets'

describe('gallery assets', () => {
  it('shows uploaded and brand assets but excludes AI-generated post assets', () => {
    const assets = [
      { id: 'logo', generated: false, kind: 'brand' },
      { id: 'upload', generated: false, kind: 'photo' },
      { id: 'generated', generated: true, kind: 'photo' },
    ]

    expect(galleryAssets(assets as never).map((asset) => asset.id)).toEqual(['logo', 'upload'])
  })
})
