import sharp, { type OverlayOptions } from 'sharp'
import { PlannerFailure } from './monthly-planner-domain'

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  )
}

/**
 * Removes a flat background from an uploaded logo. The dominant border color is
 * used instead of assuming white, so both light and dark exports work.
 *
 * Three things leave the white fringes a single threshold cannot:
 *  - a compressed export puts ringing around every edge, so pixels just outside
 *    the artwork sit between the background and the logo;
 *  - the gaps enclosed by the artwork, such as the counter of a letter, are
 *    never reached by a fill that starts at the border;
 *  - a pixel that becomes half transparent still carries the background color,
 *    which reads as a pale halo once the logo sits on a photograph.
 * The passes below answer them in that order.
 */
// A pixel this close to the border color is background beyond doubt and can
// start a fill; one within the loose distance only continues a fill already
// touching background, which is what consumes a compressed edge without eating
// into the artwork.
const BACKGROUND_SEED_DISTANCE = 40
const BACKGROUND_EDGE_DISTANCE = 115
// An enclosed gap this small relative to the image is a hole in the artwork
// rather than a part of it, so it is cleared too. A larger pale area is left
// alone, because a logo may legitimately be built on one.
const ENCLOSED_GAP_SHARE = 0.2

export async function removeLogoBackground(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 16000000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  const channels = 4
  const pixels = width * height

  const borderPixels: number[] = []
  for (let x = 0; x < width; x++) borderPixels.push(x, (height - 1) * width + x)
  for (let y = 1; y < height - 1; y++) borderPixels.push(y * width, y * width + width - 1)

  const colorBins = new Map<string, { count: number, red: number, green: number, blue: number }>()
  for (const pixel of borderPixels) {
    const offset = pixel * channels
    if (!data[offset + 3]) continue
    const red = data[offset]!
    const green = data[offset + 1]!
    const blue = data[offset + 2]!
    const key = `${Math.round(red / 16)}:${Math.round(green / 16)}:${Math.round(blue / 16)}`
    const bin = colorBins.get(key) || { count: 0, red: 0, green: 0, blue: 0 }
    bin.count++
    bin.red += red
    bin.green += green
    bin.blue += blue
    colorBins.set(key, bin)
  }

  const background = [...colorBins.values()].sort((left, right) => right.count - left.count)[0]
  if (!background) return input
  const backgroundColor = {
    red: background.red / background.count,
    green: background.green / background.count,
    blue: background.blue / background.count,
  }

  const backgroundDistance = (pixel: number) => {
    const offset = pixel * channels
    const red = data[offset]! - backgroundColor.red
    const green = data[offset + 1]! - backgroundColor.green
    const blue = data[offset + 2]! - backgroundColor.blue
    return Math.sqrt(red * red + green * green + blue * blue)
  }

  // First pass: the background connected to the border, grown with hysteresis
  // so a compressed edge is followed outward from certain background.
  const removed = new Uint8Array(pixels)
  const queue: number[] = []
  const seed = (pixel: number) => {
    if (removed[pixel] || !data[pixel * channels + 3]) return
    if (backgroundDistance(pixel) > BACKGROUND_SEED_DISTANCE) return
    removed[pixel] = 1
    queue.push(pixel)
  }
  const grow = (pixel: number) => {
    if (removed[pixel] || !data[pixel * channels + 3]) return
    if (backgroundDistance(pixel) > BACKGROUND_EDGE_DISTANCE) return
    removed[pixel] = 1
    queue.push(pixel)
  }
  for (const pixel of borderPixels) seed(pixel)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const pixel = queue[cursor]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) grow(pixel - 1)
    if (x + 1 < width) grow(pixel + 1)
    if (y > 0) grow(pixel - width)
    if (y + 1 < height) grow(pixel + width)
  }

  // Second pass: gaps the artwork encloses. A region that never touches the
  // border is a hole, and a small one belongs to the background it is cut out
  // of rather than to the logo.
  const maximumGap = Math.round(pixels * ENCLOSED_GAP_SHARE)
  const seen = new Uint8Array(pixels)
  for (let start = 0; start < pixels; start++) {
    if (seen[start] || removed[start]) continue
    if (backgroundDistance(start) > BACKGROUND_SEED_DISTANCE) continue
    const region: number[] = [start]
    seen[start] = 1
    let touchesBorder = false
    for (let cursor = 0; cursor < region.length; cursor++) {
      const pixel = region[cursor]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true
      const visit = (next: number) => {
        if (seen[next] || removed[next]) return
        if (backgroundDistance(next) > BACKGROUND_EDGE_DISTANCE) return
        seen[next] = 1
        region.push(next)
      }
      if (x > 0) visit(pixel - 1)
      if (x + 1 < width) visit(pixel + 1)
      if (y > 0) visit(pixel - width)
      if (y + 1 < height) visit(pixel + width)
    }
    if (touchesBorder || region.length > maximumGap) continue
    for (const pixel of region) removed[pixel] = 1
  }

  // Third pass: fade each removed pixel by how far it stands from the
  // background, and take the background color back out of what is left. Without
  // that subtraction a half transparent edge still carries white and shows as a
  // halo over a photograph.
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!removed[pixel]) continue
    const offset = pixel * channels
    const distance = backgroundDistance(pixel)
    const alpha = Math.max(
      0,
      Math.min(1, (distance - BACKGROUND_SEED_DISTANCE) / (BACKGROUND_EDGE_DISTANCE - BACKGROUND_SEED_DISTANCE)),
    )
    data[offset + 3] = Math.round(data[offset + 3]! * alpha)
    if (alpha <= 0 || alpha >= 1) continue
    const unmix = (value: number, backgroundValue: number) =>
      Math.max(0, Math.min(255, Math.round((value - backgroundValue * (1 - alpha)) / alpha)))
    data[offset] = unmix(data[offset]!, backgroundColor.red)
    data[offset + 1] = unmix(data[offset + 1]!, backgroundColor.green)
    data[offset + 2] = unmix(data[offset + 2]!, backgroundColor.blue)
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}

// The logo needs air around it, so a position is judged on a band wider than
// the logo itself. Headline type set beside the logo is what makes a placement
// look wrong, and a region limited to the logo's own box never sees it.
const LOGO_CLEARANCE = 88
// Fine enough for set type to register as edges; the former 108x135 averaged a
// headline away into flat sky.
const PLACEMENT_ANALYSIS_WIDTH = 216
const PLACEMENT_ANALYSIS_HEIGHT = 270

/**
 * The corner the composing model left free, when it said which one. Scoring is
 * still what picks the exact spot inside that corner, and still decides alone
 * when no corner was named or the named one turned out to be occupied after all.
 */
export type LogoZone = 'auto' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export async function chooseLogoPlacement(image: Buffer, logo: Buffer, zone?: LogoZone) {
  const [imageAnalysis, logoAnalysis] = await Promise.all([
    sharp(image)
      .resize(PLACEMENT_ANALYSIS_WIDTH, PLACEMENT_ANALYSIS_HEIGHT, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(logo).resize(64, 36, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  const imageChannels = imageAnalysis.info.channels
  const logoChannels = logoAnalysis.info.channels
  let logoLuminance = 0
  let visibleLogoPixels = 0
  for (let pixel = 0; pixel < logoAnalysis.info.width * logoAnalysis.info.height; pixel++) {
    const offset = pixel * logoChannels
    if ((logoAnalysis.data[offset + 3] || 0) < 16) continue
    logoLuminance += logoAnalysis.data[offset]!
    visibleLogoPixels++
  }
  if (!visibleLogoPixels) return { left: 48, top: 48 }
  logoLuminance /= visibleLogoPixels

  const width = 1080
  const height = 1350
  const logoMetadata = await sharp(logo).metadata()
  const logoWidth = logoMetadata.width || 0
  const logoHeight = logoMetadata.height || 0
  const marginX = 48
  const marginY = 48
  const horizontalPositions = [...new Set([
    marginX,
    Math.round((width - logoWidth) / 2),
    width - logoWidth - 56,
  ])].filter((left) => left >= marginX && left + logoWidth <= width - marginX)
  const verticalPositions = [...new Set([
    marginY,
    140,
    height - logoHeight - 140,
    height - logoHeight - marginY,
  ])].filter((top) => top >= marginY && top + logoHeight <= height - marginY)

  // The named corner is a preference, not a rule. A model that says it left the
  // bottom free and then sets its copy block there would otherwise push the
  // logo onto its own type, so the measurement still decides and the hint only
  // breaks a tie.
  const inZone = (left: number, top: number) => {
    if (!zone || zone === 'auto') return false
    const onLeft = left + logoWidth / 2 < width / 2
    const onTop = top + logoHeight / 2 < height / 2
    return zone === `${onTop ? 'top' : 'bottom'}-${onLeft ? 'left' : 'right'}`
  }

  let best = { left: marginX, top: marginY, score: Number.POSITIVE_INFINITY }
  for (const top of verticalPositions) {
    for (const left of horizontalPositions) {
      const startX = Math.max(
        0,
        Math.floor(((left - LOGO_CLEARANCE) / width) * imageAnalysis.info.width),
      )
      const endX = Math.min(
        imageAnalysis.info.width,
        Math.ceil(((left + logoWidth + LOGO_CLEARANCE) / width) * imageAnalysis.info.width),
      )
      const startY = Math.max(
        0,
        Math.floor(((top - LOGO_CLEARANCE) / height) * imageAnalysis.info.height),
      )
      const endY = Math.min(
        imageAnalysis.info.height,
        Math.ceil(((top + logoHeight + LOGO_CLEARANCE) / height) * imageAnalysis.info.height),
      )
      const values: number[] = []
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++)
          values.push(imageAnalysis.data[(y * imageAnalysis.info.width + x) * imageChannels]!)
      }
      if (!values.length) continue
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      let edgeDifference = 0
      let edgeCount = 0
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const current = imageAnalysis.data[(y * imageAnalysis.info.width + x) * imageChannels]!
          if (x + 1 < endX) {
            edgeDifference += Math.abs(current - imageAnalysis.data[(y * imageAnalysis.info.width + x + 1) * imageChannels]!)
            edgeCount++
          }
          if (y + 1 < endY) {
            edgeDifference += Math.abs(current - imageAnalysis.data[((y + 1) * imageAnalysis.info.width + x) * imageChannels]!)
            edgeCount++
          }
        }
      }
      // Left uncapped on purpose: set type is far busier than a textured
      // surface, and a ceiling of one made the two look equally bad.
      const complexity = variance / 7000 + edgeDifference / Math.max(1, edgeCount) / 80
      const contrastPenalty = 1 - Math.min(1, Math.abs(mean - logoLuminance) / 160)
      const score = complexity + contrastPenalty * 0.5 - (inZone(left, top) ? 0.3 : 0)
      if (score < best.score) best = { left, top, score }
    }
  }
  return { left: best.left, top: best.top }
}

// Technical output normalization. A supplied approved logo is the only optional
// deterministic brand element added after generation; no logo means no overlay.
export async function normalizeGeneratedCreative(image: Buffer, logo?: Buffer, logoZone?: LogoZone) {
  const normalized = sharp(image, { limitInputPixels: 24000000 })
    .rotate()
    // The image prompt reserves a centered 4:5 safe region inside providers that
    // only expose a native 3:4 portrait canvas. A deterministic centre crop keeps
    // that contract; attention-based cropping could unexpectedly move typography.
    .resize(1080, 1350, { fit: 'cover', position: 'centre' })
  let result: Buffer
  if (logo) {
    const logoBuffer = await removeLogoBackground(logo)
    const resizedLogo = await sharp(logoBuffer)
      .resize(320, 180, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer()
    const logoMetadata = await sharp(resizedLogo).metadata()
    const logoWidth = logoMetadata.width || 0
    const logoHeight = logoMetadata.height || 0
    if (logoWidth && logoHeight) {
      const base = await normalized.png().toBuffer()
      const placement = await chooseLogoPlacement(base, resizedLogo, logoZone)
      result = await sharp(base)
        .composite([{ input: resizedLogo, left: placement.left, top: placement.top }])
        .jpeg({ quality: 94, mozjpeg: true })
        .toBuffer()
    } else {
      result = await normalized.jpeg({ quality: 94, mozjpeg: true }).toBuffer()
    }
  } else {
    result = await normalized.jpeg({ quality: 94, mozjpeg: true }).toBuffer()
  }
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
