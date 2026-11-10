import { describe, expect, it } from 'vitest'
import { videoByteRange } from '../../server/utils/video-range'

describe('video byte ranges', () => {
  it('sends the whole file when no single range is asked for', () => {
    expect(videoByteRange(undefined, 1000)).toBeNull()
    expect(videoByteRange('bytes=0-10,20-30', 1000)).toBeNull()
    expect(videoByteRange('bytes=-', 1000)).toBeNull()
  })

  it('answers an open, a closed and a suffix range', () => {
    expect(videoByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(videoByteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(videoByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(videoByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
  })

  it('refuses a range outside the file', () => {
    expect(videoByteRange('bytes=1000-', 1000)).toBe('invalid')
    expect(videoByteRange('bytes=500-100', 1000)).toBe('invalid')
  })
})
