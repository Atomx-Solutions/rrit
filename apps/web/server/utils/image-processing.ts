import sharp, { type OverlayOptions } from 'sharp'
import { PlannerFailure } from './monthly-planner-domain'

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  )
}

// Technical output normalization only. This function never adds typography,
// frames, panels, colors or any other designed element to the AI result.
export async function normalizeGeneratedCreative(image: Buffer) {
  const result = await sharp(image, { limitInputPixels: 24000000 })
    .rotate()
    // The image prompt reserves a centered 4:5 safe region inside providers that
    // only expose a native 3:4 portrait canvas. A deterministic centre crop keeps
    // that contract; attention-based cropping could unexpectedly move typography.
    .resize(1080, 1350, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 91, mozjpeg: true })
    .toBuffer()
  if (result.length > 2097152) throw new PlannerFailure('CREATIVE_TOO_LARGE')
  return result
}

// The sheet is internal model context, never a customer-facing post design.
export async function assetContactSheet(assets: { id: string; bytes: Buffer }[]) {
  if (!assets.length || assets.length > 40) throw new PlannerFailure('OWNED_PHOTOS_REQUIRED')
  const width = 1000
  const cellWidth = 250
  const cellHeight = 230
  const composites: OverlayOptions[] = []
  for (const [index, asset] of assets.entries()) {
    const top = Math.floor(index / 4) * cellHeight
    const left = (index % 4) * cellWidth
    composites.push({
      input: await sharp(asset.bytes)
        .rotate()
        .resize(240, 185, { fit: 'inside', background: '#ffffff' })
        .toBuffer(),
      top,
      left,
    })
    composites.push({
      input: Buffer.from(
        `<svg width="250" height="40" xmlns="http://www.w3.org/2000/svg"><text x="6" y="26" font-family="sans-serif" font-size="18" fill="#172126">${escapeXml(`Photo ${index + 1}`)}</text></svg>`,
      ),
      top: top + 187,
      left,
    })
  }
  return sharp({
    create: {
      width,
      height: Math.ceil(assets.length / 4) * cellHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .jpeg({ quality: 78 })
    .toBuffer()
}
