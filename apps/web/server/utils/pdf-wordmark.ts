import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The full Framic wordmark for PDFs, drawn from the logo image itself. The
// vector "F" it replaces showed only the first letter of the brand.
const fileName = 'framic-wordmark-pdf.jpg'
// The resource name pages use to draw it.
export const wordmarkResource = '/Logo'

type Wordmark = { bytes: Buffer; width: number; height: number }
let cached: Wordmark | undefined

// Width and height are read from the JPEG's frame header, so replacing the
// image needs no change here.
function jpegSize(bytes: Buffer) {
  let offset = 2
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]!
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    offset += 2 + length
  }
  throw new Error('Framic wordmark is not a readable JPEG')
}

export function pdfWordmark(): Wordmark {
  if (cached) return cached
  const path = [
    resolve(process.cwd(), 'public', fileName),
    resolve(process.cwd(), '.output/public', fileName),
    resolve(process.cwd(), 'apps/web/public', fileName),
  ].find((candidate) => existsSync(candidate))
  if (!path) throw new Error('Framic PDF wordmark asset is missing')
  const bytes = readFileSync(path)
  cached = { bytes, ...jpegSize(bytes) }
  return cached
}

/** The image object a PDF embeds once and every page draws. */
export function wordmarkImageObject() {
  const { bytes, width, height } = pdfWordmark()
  return `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n${bytes.toString('latin1')}\nendstream`
}

const round = (n: number) => String(Math.round(n * 100) / 100)

/**
 * Draws the wordmark `logoWidth` wide, `topMargin` below the top of an A4 page,
 * at `left`, or right aligned with that margin when no left is given.
 */
export function wordmarkPdfOps(pageWidth = 595, topMargin = 45, logoWidth = 110, left?: number) {
  const { width, height } = pdfWordmark()
  const logoHeight = logoWidth * (height / width)
  const x = left ?? pageWidth - topMargin - logoWidth
  const y = 842 - topMargin - logoHeight
  return `q\n${round(logoWidth)} 0 0 ${round(logoHeight)} ${round(x)} ${round(y)} cm\n${wordmarkResource} Do\nQ`
}
