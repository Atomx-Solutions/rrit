/**
 * The single byte range a video player asked for, or null for the whole file.
 * Several ranges at once are answered with the whole file; a range that starts
 * past the end is 'invalid' (416).
 */
export function videoByteRange(header: string | undefined, size: number) {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    // "bytes=-500": the last 500 bytes.
    const suffix = Math.min(Number(match[2]), size)
    return suffix > 0 ? { start: size - suffix, end: size - 1 } : 'invalid'
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || end < start) return 'invalid'
  return { start, end }
}
