/**
 * The widths /api/media will resize an uploaded image to. A fixed set keeps
 * the number of distinct variants (and resize work) small, whatever width a
 * caller asks for.
 */
export const MEDIA_WIDTHS = [128, 256, 512, 1024] as const

/** Smallest allowed width that covers the request, or undefined past the largest. */
export function mediaWidthFor(requested: number): number | undefined {
  if (!Number.isFinite(requested) || requested <= 0) return undefined
  return MEDIA_WIDTHS.find((width) => width >= requested)
}

const MEDIA_PATH = /^\/api\/media\/[0-9a-f-]+$/i

/**
 * The URL of an uploaded image sized for a box `displayWidth` CSS pixels
 * wide, at twice that for high-density screens. Any other URL, or a box wider
 * than the largest variant, is returned unchanged so it loads the original.
 */
export function sizedMediaUrl(src: string, displayWidth: number | string | undefined) {
  const width = mediaWidthFor(Number(displayWidth) * 2)
  if (!width || !MEDIA_PATH.test(src)) return src
  return `${src}?w=${width}`
}
