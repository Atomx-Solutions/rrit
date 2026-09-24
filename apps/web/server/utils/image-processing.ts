import sharp, { type OverlayOptions } from 'sharp'
import { PlannerFailure } from './monthly-planner-domain'

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  )
}

/**
 * Removes a connected, mostly uniform background from an uploaded logo while
 * preserving artwork that is not connected to the image edge. The dominant
 * border color is used instead of assuming the background is white, so both
 * light and dark logo exports work on different post backgrounds.
 */
export async function removeLogoBackground(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 16000000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  const channels = 4
  const visited = new Uint8Array(width * height)
  const queue: number[] = []

  const borderPixels: number[] = []
  for (let x = 0; x < width; x++) {
    borderPixels.push(x, (height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    borderPixels.push(y * width, y * width + width - 1)
  }

  const colorBins = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >()
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

  const isBackground = (pixel: number) => data[pixel * channels + 3]! > 0 && backgroundDistance(pixel) <= 72

  const enqueue = (pixel: number) => {
    if (!visited[pixel] && isBackground(pixel)) {
      visited[pixel] = 1
      queue.push(pixel)
    }
  }

  for (const pixel of borderPixels) enqueue(pixel)

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const pixel = queue[cursor]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }

  for (const pixel of queue) {
    const offset = pixel * channels
    const distance = backgroundDistance(pixel)
    const remainingAlpha = Math.max(0, Math.min(1, (distance - 20) / 52))
    data[offset + 3] = Math.round(data[offset + 3]! * remainingAlpha)
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer()
}

async function chooseLogoPlacement(image: Buffer, logo: Buffer) {
  const [imageAnalysis, logoAnalysis] = await Promise.all([
    sharp(image).resize(108, 135, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true }),
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

  let best = { left: marginX, top: marginY, score: Number.POSITIVE_INFINITY }
  for (const top of verticalPositions) {
    for (const left of horizontalPositions) {
      const startX = Math.max(0, Math.floor((left / width) * imageAnalysis.info.width))
      const endX = Math.min(
        imageAnalysis.info.width,
        Math.ceil(((left + logoWidth) / width) * imageAnalysis.info.width),
      )
      const startY = Math.max(0, Math.floor((top / height) * imageAnalysis.info.height))
      const endY = Math.min(
        imageAnalysis.info.height,
        Math.ceil(((top + logoHeight) / height) * imageAnalysis.info.height),
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
      const complexity = Math.min(1, variance / 7000 + (edgeDifference / Math.max(1, edgeCount)) / 80)
      const contrastPenalty = 1 - Math.min(1, Math.abs(mean - logoLuminance) / 160)
      const score = complexity + contrastPenalty * 0.6
      if (score < best.score) best = { left, top, score }
    }
  }
  return { left: best.left, top: best.top }
}

// Technical output normalization. A supplied approved logo is the only optional
// deterministic brand element added after generation; no logo means no overlay.
export async function normalizeGeneratedCreative(image: Buffer, logo?: Buffer) {
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
      const placement = await chooseLogoPlacement(base, resizedLogo)
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
