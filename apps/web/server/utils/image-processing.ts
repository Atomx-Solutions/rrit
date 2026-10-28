import sharp, { type OverlayOptions } from 'sharp'
import { PlannerFailure } from './monthly-planner-domain'
import {
  channelCanvas,
  channelUiInsets,
  type Canvas,
  type CanvasInsets,
  type PublishingChannel,
} from '../../shared/schemas/channel-format'

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
// The largest colour change between neighbouring pixels that still reads as
// one continuous backdrop rather than the edge of the artwork.
const BACKGROUND_GRADIENT_STEP = 6
// A kept pixel is a speck of backdrop when this share of the pixels within
// SPECK_RADIUS of it are background.
const SPECK_RADIUS = 2
const SPECK_BACKGROUND_SHARE = 0.8
// A kept piece holding this share of everything kept is part of the artwork;
// a smaller one joins it when within ARTWORK_REACH_SHARE of the image's longer
// side from a piece already in it.
const ARTWORK_PIECE_SHARE = 0.005
const ARTWORK_REACH_SHARE = 0.03
// How far, in pixels, the logo's anti-aliased rim reaches into its background.
const LOGO_EDGE_RADIUS = 2

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
  // A background is followed past the edge distance too, as long as it
  // changes smoothly from the neighbour it is reached from: that is how a
  // gradient or a lit corner of a photographed backdrop behaves, while the
  // artwork's own edge is a sharp step and stops the fill.
  const step = (from: number, to: number) => {
    const a = from * channels
    const b = to * channels
    const red = data[a]! - data[b]!
    const green = data[a + 1]! - data[b + 1]!
    const blue = data[a + 2]! - data[b + 2]!
    return Math.sqrt(red * red + green * green + blue * blue)
  }
  const grow = (pixel: number, from: number) => {
    if (removed[pixel] || !data[pixel * channels + 3]) return
    if (backgroundDistance(pixel) > BACKGROUND_EDGE_DISTANCE && step(from, pixel) > BACKGROUND_GRADIENT_STEP) return
    removed[pixel] = 1
    queue.push(pixel)
  }
  for (const pixel of borderPixels) seed(pixel)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const pixel = queue[cursor]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) grow(pixel - 1, pixel)
    if (x + 1 < width) grow(pixel + 1, pixel)
    if (y > 0) grow(pixel - width, pixel)
    if (y + 1 < height) grow(pixel + width, pixel)
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

  // A textured backdrop (paper, grain, a lit corner) leaves scattered single
  // pixels the fill could not reach. A kept pixel the background almost
  // surrounds is one of those specks, not artwork: a stroke of the logo, even
  // a thin one, keeps far more of its neighbourhood.
  for (let pass = 0; pass < 2; pass++) {
    const specks: number[] = []
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (removed[pixel] || !data[pixel * channels + 3]) continue
      const x = pixel % width
      const y = Math.floor(pixel / width)
      let around = 0
      let background = 0
      for (let dy = -SPECK_RADIUS; dy <= SPECK_RADIUS; dy++)
        for (let dx = -SPECK_RADIUS; dx <= SPECK_RADIUS; dx++) {
          const nx = x + dx
          const ny = y + dy
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          around++
          if (removed[ny * width + nx]) background++
        }
      if (around && background / around >= SPECK_BACKGROUND_SHARE) specks.push(pixel)
    }
    for (const pixel of specks) removed[pixel] = 1
  }

  // What survives of a textured backdrop is a scatter of small pieces away
  // from the artwork. The artwork is its substantial pieces; a small piece is
  // kept only near one of them, which is what fine lettering under a mark is,
  // and dropped when it stands apart, which is what a speckled patch is.
  const piece = new Int32Array(pixels).fill(-1)
  const pieces: { size: number; members: number[] }[] = []
  let keptTotal = 0
  for (let start = 0; start < pixels; start++) {
    if (removed[start] || !data[start * channels + 3] || piece[start]! >= 0) continue
    const members = [start]
    piece[start] = pieces.length
    for (let cursor = 0; cursor < members.length; cursor++) {
      const pixel = members[cursor]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (removed[next] || !data[next * channels + 3] || piece[next]! >= 0) continue
          piece[next] = pieces.length
          members.push(next)
        }
    }
    keptTotal += members.length
    pieces.push({ size: members.length, members })
  }
  const reach = Math.max(1, Math.round(Math.max(width, height) * ARTWORK_REACH_SHARE))
  // Each piece's bounding box. A small piece joins the artwork when it lies
  // within reach of a piece already in it, so a line of fine lettering joins
  // letter by letter while a patch across the image never connects.
  const boxes = pieces.map((part) => {
    let left = width, right = 0, top = height, bottom = 0
    for (const pixel of part.members) {
      const x = pixel % width
      const y = Math.floor(pixel / width)
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
    return { left, right, top, bottom }
  })
  const inArtwork = pieces.map((part) => part.size >= keptTotal * ARTWORK_PIECE_SHARE)
  const near = (a: number, b: number) =>
    boxes[a]!.left - reach <= boxes[b]!.right && boxes[b]!.left - reach <= boxes[a]!.right
    && boxes[a]!.top - reach <= boxes[b]!.bottom && boxes[b]!.top - reach <= boxes[a]!.bottom
  const frontier = inArtwork.flatMap((member, index) => (member ? [index] : []))
  while (frontier.length) {
    const joined = frontier.pop()!
    for (let index = 0; index < pieces.length; index++) {
      if (inArtwork[index] || !near(index, joined)) continue
      inArtwork[index] = true
      frontier.push(index)
    }
  }
  pieces.forEach((part, index) => {
    if (!inArtwork[index]) for (const pixel of part.members) removed[pixel] = 1
  })

  // Only background that touches the artwork keeps any opacity: that soft rim
  // is the logo's own anti-aliasing. Background further out is gone entirely,
  // however far a gradient or a highlight in it strays from the average
  // background color, so a lit corner does not survive as a faint patch.
  const nearArtwork = new Uint8Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (removed[pixel]) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    for (let dy = -LOGO_EDGE_RADIUS; dy <= LOGO_EDGE_RADIUS; dy++)
      for (let dx = -LOGO_EDGE_RADIUS; dx <= LOGO_EDGE_RADIUS; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) nearArtwork[ny * width + nx] = 1
      }
  }

  // Third pass: fade each removed pixel by how far it stands from the
  // background, and take the background color back out of what is left. Without
  // that subtraction a half transparent edge still carries white and shows as a
  // halo over a photograph.
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!removed[pixel]) continue
    const offset = pixel * channels
    if (!nearArtwork[pixel]) {
      data[offset + 3] = 0
      continue
    }
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
// Fine enough for set type to register as edges; the former 108px width
// averaged a headline away into flat sky. The height follows the canvas.
const PLACEMENT_ANALYSIS_WIDTH = 216
// The share of the free height, from the top and from the bottom, where a logo
// may sit. Brand marks read as part of the frame along its edges; deeper in,
// they compete with the subject.
const LOGO_EDGE_BAND = 0.3

/**
 * The corner the composing model left free, when it said which one. Scoring is
 * still what picks the exact spot inside that corner, and still decides alone
 * when no corner was named or the named one turned out to be occupied after all.
 */
export type LogoZone = 'auto' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export async function chooseLogoPlacement(
  image: Buffer,
  logo: Buffer,
  zone?: LogoZone,
  // Where the channel's own interface covers the image; the logo never goes there.
  covered: CanvasInsets = { top: 0, right: 0, bottom: 0, left: 0 },
) {
  const imageMeta = await sharp(image).metadata()
  const width = imageMeta.width || 0
  const height = imageMeta.height || 0
  const analysisHeight = Math.max(1, Math.round(PLACEMENT_ANALYSIS_WIDTH * height / Math.max(1, width)))
  const [imageAnalysis, logoAnalysis] = await Promise.all([
    sharp(image)
      .resize(PLACEMENT_ANALYSIS_WIDTH, analysisHeight, { fit: 'fill' })
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

  const logoMetadata = await sharp(logo).metadata()
  const logoWidth = logoMetadata.width || 0
  const logoHeight = logoMetadata.height || 0
  const marginX = 48
  const marginY = 48
  // The free area: inside the margins and outside whatever the channel's own
  // interface covers. On a feed post that is the whole canvas; on TikTok it is
  // what its interface leaves visible, so every format searches its own frame.
  const minLeft = Math.max(marginX, Math.ceil(width * covered.left))
  const maxLeft = width - Math.max(56, Math.ceil(width * covered.right)) - logoWidth
  const minTop = Math.max(marginY, Math.ceil(height * covered.top))
  const maxTop = height - Math.max(marginY, Math.ceil(height * covered.bottom)) - logoHeight
  // Candidates are spread along the top and the bottom of that area rather
  // than fixed at a few offsets: a handful of fixed spots often all touched the
  // type or the subject, while a calm patch a little further in went unseen.
  const spread = (from: number, to: number, step: number) =>
    to < from
      ? []
      : [...new Set([
          ...Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step),
          to,
        ])]
  const horizontalPositions = spread(minLeft, maxLeft, Math.max(1, Math.round(logoWidth / 2)))
  const edgeBand = Math.round((maxTop - minTop) * LOGO_EDGE_BAND)
  const verticalPositions = [...new Set([
    ...spread(minTop, Math.min(maxTop, minTop + edgeBand), Math.max(1, logoHeight)),
    ...spread(Math.max(minTop, maxTop - edgeBand), maxTop, Math.max(1, logoHeight)),
  ])]

  // The named corner is the composing model's own statement of where it kept
  // the frame free, so it wins unless the measurement shows that corner is
  // busier than a typical spot on this image: a model that says it left the
  // bottom free and then sets its copy block there must not push the logo onto
  // its own type. Without a usable corner the calmest spot decides alone.
  const inZone = (left: number, top: number) => {
    if (!zone || zone === 'auto') return false
    const onLeft = left + logoWidth / 2 < width / 2
    const onTop = top + logoHeight / 2 < height / 2
    return zone === `${onTop ? 'top' : 'bottom'}-${onLeft ? 'left' : 'right'}`
  }

  const candidates: { left: number; top: number; score: number; complexity: number }[] = []
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
      candidates.push({ left, top, score: complexity + contrastPenalty * 0.5, complexity })
    }
  }
  if (!candidates.length)
    return { left: horizontalPositions[0] ?? marginX, top: verticalPositions[0] ?? marginY }
  const byScore = (a: { score: number }, b: { score: number }) => a.score - b.score
  const complexities = candidates.map((candidate) => candidate.complexity).sort((a, b) => a - b)
  const typical = complexities[Math.floor((complexities.length - 1) / 2)]!
  const named = candidates
    .filter((candidate) => inZone(candidate.left, candidate.top) && candidate.complexity <= typical)
    .sort(byScore)[0]
  const best = named || candidates.sort(byScore)[0]!
  return { left: best.left, top: best.top }
}

// Technical output normalization. A supplied approved logo is the only optional
// deterministic brand element added after generation; no logo means no overlay.
export async function normalizeGeneratedCreative(
  image: Buffer,
  channel: PublishingChannel,
  logo?: Buffer,
  logoZone?: LogoZone,
) {
  const canvas = channelCanvas(channel)
  const normalized = sharp(image, { limitInputPixels: 24000000 })
    .rotate()
    // The image prompt reserves a centered safe region of the channel's canvas
    // inside the provider's closest portrait ratio. A deterministic centre crop
    // keeps that contract; attention-based cropping could move typography.
    // `cover` scales uniformly, so the picture is cropped, never stretched.
    .resize(canvas.width, canvas.height, {
      fit: 'cover',
      position: 'centre',
    })
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
      const placement = await chooseLogoPlacement(base, resizedLogo, logoZone, channelUiInsets(channel))
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

/**
 * A finished image brought to another canvas without cutting or stretching
 * it: the whole image is scaled to fit and set over a blurred, darkened fill
 * of itself, so its type and subject stay complete. Used only when a file
 * reaches publishing in the wrong shape.
 */
export async function conformImageToCanvas(image: Buffer, canvas: Canvas) {
  const source = sharp(image, { limitInputPixels: 24000000 }).rotate()
  const fill = await source.clone()
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(canvas.width / 40)))
    .modulate({ brightness: 0.78 })
    .toBuffer()
  const fitted = await source.resize(canvas.width, canvas.height, { fit: 'inside' }).toBuffer({ resolveWithObject: true })
  return sharp(fill)
    .composite([{
      input: fitted.data,
      left: Math.round((canvas.width - fitted.info.width) / 2),
      top: Math.round((canvas.height - fitted.info.height) / 2),
    }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

/**
 * A delivered frame placed whole and untouched in the centre of a larger
 * provider canvas, with a blurred, darkened stretch of itself filling the
 * rest. The provider paints its own ratio; the composer centre-crops the clip
 * back to the frame, so the padding is never delivered and no pixel of the
 * frame is cut or distorted to fit the provider.
 */
export async function padFrameToCanvas(frame: Buffer, canvas: Canvas) {
  const meta = await sharp(frame).metadata()
  const width = meta.width || 0
  const height = meta.height || 0
  if (width === canvas.width && height === canvas.height) return frame
  if (width > canvas.width || height > canvas.height) throw new Error('Frame is larger than the provider canvas')
  const fill = await sharp(frame)
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(canvas.width / 40)))
    .modulate({ brightness: 0.78 })
    .toBuffer()
  return sharp(fill)
    .composite([{
      input: frame,
      left: Math.round((canvas.width - width) / 2),
      top: Math.round((canvas.height - height) / 2),
    }])
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer()
}

/**
 * The designed layers set over a video's generated motion.
 *
 * The motion model is never asked to draw type, because it warps letters; the
 * post's approved copy is instead rasterised here, exactly, in the brand's
 * colours, as three transparent full-canvas PNGs the composer reveals one
 * after another: the brand and the eyebrow label, then the headline, then the
 * supporting line and the call to action. They sit in the zone the strategy
 * told the motion model to keep clear, inside the area the TikTok and Reels
 * interface leaves visible.
 */
export async function buildVideoOverlayLayers(input: {
  businessName: string
  eyebrow?: string
  headline: string
  subline?: string
  cta?: string
  zone: 'top' | 'bottom'
  // Where the subject spans vertically, as shares of the height from the top.
  // The text then takes the free side with more room and is sized to fit
  // there, so it never covers the subject.
  avoid?: { top: number; bottom: number }
  primaryColor?: string
  onPrimary?: string
  fontFamily?: string
  weightHook?: number
  weightCta?: number
  // The approved logo, shown in place of the business name when there is one.
  logo?: Buffer
  target: { width: number; height: number }
  // Where the channel's own interface covers the video, beyond the general
  // header and footer bands below.
  covered?: CanvasInsets
}) {
  const { width, height } = input.target
  const covered = input.covered || { top: 0, right: 0, bottom: 0, left: 0 }
  const primary = sanitizeHex(input.primaryColor) || '#0F172A'
  const onPrimary = sanitizeHex(input.onPrimary) || readableOn(primary)
  const font = `${(input.fontFamily?.trim() || 'Inter').replace(/["<>]/g, '')}, 'Helvetica Neue', Arial, sans-serif`
  const weightHook = clampWeight(input.weightHook, 800)
  const weightCta = clampWeight(input.weightCta, 600)
  const margin = Math.round(Math.max(width * 0.075, width * covered.left))
  const textWidth = width - margin - Math.round(Math.max(width * 0.075, width * covered.right))
  // The platforms draw their own header across the top and their caption,
  // actions and progress bar across the bottom, so the type stays between.
  const safeTop = Math.round(height * Math.max(0.11, covered.top))
  const safeBottom = Math.round(height * Math.min(0.78, 1 - covered.bottom))

  const wrap = (value: string, size: number, widthFactor: number) => {
    const maxChars = Math.max(6, Math.floor(textWidth / (size * widthFactor)))
    const lines: string[] = []
    let line = ''
    for (const word of value.split(/\s+/).filter(Boolean)) {
      if (line && `${line} ${word}`.length > maxChars) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line) lines.push(line)
    return lines
  }
  // The largest size at which the whole approved headline fits in three lines;
  // the copy is never cut to make it fit. A video is read in a glance, so the
  // block stays short enough to leave most of the frame to the motion.
  const headlineText = input.headline.trim().toLocaleUpperCase()
  let headlineSize = Math.round(width * 0.115)
  let headlineLines = wrap(headlineText, headlineSize, 0.62)
  while (headlineSize > 40 && (headlineLines.length > 3 || headlineLines.some((part) => part.length * headlineSize * 0.62 > textWidth))) {
    headlineSize -= 4
    headlineLines = wrap(headlineText, headlineSize, 0.62)
  }
  const brandSize = Math.round(width * 0.04)
  const eyebrowSize = Math.round(width * 0.03)
  const eyebrow = input.eyebrow?.trim().toLocaleUpperCase() || ''
  const sublineSize = Math.round(width * 0.052)
  // A headline that already fills three lines carries the message alone.
  let sublineLines = input.subline?.trim() && headlineLines.length < 3
    ? wrap(input.subline.trim(), sublineSize, 0.52).slice(0, 2)
    : []
  // A call to action reads as a button only while it is button-sized.
  const cta = input.cta?.trim() && input.cta.trim().length <= 40 ? input.cta.trim() : ''
  const ctaSize = Math.round(width * 0.04)
  const ctaHeight = Math.round(ctaSize * 2.3)
  const ctaWidth = Math.min(textWidth, Math.round(Array.from(cta).length * ctaSize * 0.56 + ctaSize * 2.2))

  const gap = Math.round(height * 0.02)
  const ruleHeight = Math.max(4, Math.round(brandSize * 0.18))
  let headlineStep = Math.round(headlineSize * 1.02)
  const sublineStep = Math.round(sublineSize * 1.25)
  // Every row's height in reading order, so the block can be placed from
  // either edge of the safe area with the same arithmetic.
  // The brand line: the logo cut from its background and trimmed to its
  // artwork, or the business name when there is no logo.
  const brandMark = input.logo
    ? await sharp(await sharp(await removeLogoBackground(input.logo)).trim().png().toBuffer())
      .resize(Math.round(width * 0.4), Math.round(brandSize * 3.4), { fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
    : undefined
  const brandHeight = brandMark ? (await sharp(brandMark).metadata()).height || brandSize : brandSize
  const measure = () => [
    brandHeight, gap, ruleHeight, gap,
    ...(eyebrow ? [eyebrowSize, gap] : []),
    headlineLines.length * headlineStep, gap,
    ...(sublineLines.length ? [sublineLines.length * sublineStep, gap] : []),
    cta ? ctaHeight : 0,
  ].reduce((total, value) => total + value, 0)
  let blockHeight = measure()
  // With the subject's band known, the text goes to the free side with more
  // room, and the headline steps down until the whole block fits there. The
  // copy itself is never cut; at the smallest size it keeps the room it needs.
  let zone = input.zone
  if (input.avoid) {
    const above = Math.round(height * input.avoid.top) - safeTop - gap
    const below = safeBottom - Math.round(height * input.avoid.bottom) - gap
    zone = above >= below ? 'top' : 'bottom'
    const room = Math.max(above, below)
    while (blockHeight > room && headlineSize > 40) {
      headlineSize -= 4
      headlineLines = wrap(headlineText, headlineSize, 0.62)
      headlineStep = Math.round(headlineSize * 1.02)
      sublineLines = headlineLines.length < 3 ? sublineLines : []
      blockHeight = measure()
    }
  }
  let y = zone === 'top' ? safeTop : safeBottom - blockHeight
  const top = y
  const brandTop = y
  const brandY = (y += brandHeight)
  const ruleY = (y += gap)
  y += ruleHeight + gap
  const eyebrowY = eyebrow ? (y += eyebrowSize) : y
  if (eyebrow) y += gap
  const headlineY = y + headlineSize
  y += headlineLines.length * headlineStep + gap
  const sublineY = y + sublineSize
  if (sublineLines.length) y += sublineLines.length * sublineStep + gap
  const ctaY = y

  // A soft scrim behind the type keeps it legible on any photograph without
  // boxing the motion in.
  const reach = Math.round(height * 0.12)
  const scrimStart = zone === 'top' ? 0 : Math.max(0, top - reach)
  const scrimEnd = zone === 'top' ? Math.min(height, top + blockHeight + reach) : height
  const scrim = zone === 'top'
    ? '<stop offset="0" stop-color="#000" stop-opacity="0.66"/><stop offset="0.7" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0"/>'
    : '<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.3" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0.66"/>'
  const layer = (body: string) => sharp(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)).png().toBuffer()
  const lines = (parts: string[], first: number, step: number) =>
    parts.map((part, index) => `<tspan x="${margin}" y="${first + index * step}">${escapeXml(part)}</tspan>`).join('')

  const layers = await Promise.all([
    layer(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${scrim}</linearGradient></defs>
  <rect x="0" y="${scrimStart}" width="${width}" height="${scrimEnd - scrimStart}" fill="url(#s)"/>
  ${brandMark ? '' : `<text font-family="${font}" font-size="${brandSize}" font-weight="${weightCta}" fill="#ffffff">${lines([input.businessName.trim()], brandY, 0)}</text>`}
  <rect x="${margin}" y="${ruleY}" width="${Math.round(width * 0.12)}" height="${ruleHeight}" rx="2" fill="${primary}"/>
  ${eyebrow ? `<text font-family="${font}" font-size="${eyebrowSize}" font-weight="${weightCta}" fill="#ffffff" fill-opacity="0.85" letter-spacing="3">${lines([eyebrow], eyebrowY, 0)}</text>` : ''}`),
    layer(`<text font-family="${font}" font-size="${headlineSize}" font-weight="${weightHook}" fill="#ffffff" letter-spacing="-1">${lines(headlineLines, headlineY, headlineStep)}</text>`),
    layer(`${sublineLines.length ? `<text font-family="${font}" font-size="${sublineSize}" font-weight="600" fill="#ffffff" fill-opacity="0.94">${lines(sublineLines, sublineY, sublineStep)}</text>` : ''}
  ${cta ? `<rect x="${margin}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${primary}"/>
  <text x="${margin + Math.round(ctaWidth / 2)}" y="${ctaY + Math.round(ctaHeight / 2 + ctaSize * 0.36)}" font-family="${font}" font-size="${ctaSize}" font-weight="${weightCta}" fill="${onPrimary}" text-anchor="middle">${escapeXml(cta)}</text>` : ''}`),
  ])
  if (brandMark) {
    // A soft dark halo cut from the logo's own shape keeps a dark or fine logo
    // legible over a bright photograph without boxing it in.
    const shadowBlur = Math.max(2, Math.round(brandSize * 0.25))
    const markMeta = await sharp(brandMark).metadata()
    const halo = await sharp(brandMark)
      .extend({ top: shadowBlur * 2, bottom: shadowBlur * 2, left: shadowBlur * 2, right: shadowBlur * 2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .modulate({ brightness: 0 })
      .blur(shadowBlur)
      .png()
      .toBuffer()
    layers[0] = await sharp(layers[0]!)
      .composite([
        { input: halo, left: Math.max(0, margin - shadowBlur * 2), top: Math.max(0, brandTop - shadowBlur * 2) },
        { input: halo, left: Math.max(0, margin - shadowBlur * 2), top: Math.max(0, brandTop - shadowBlur * 2) },
        { input: brandMark, left: margin, top: brandTop },
      ])
      .png()
      .toBuffer()
    if (!markMeta.width) throw new Error('Approved logo could not be composed')
  }
  // Where the type sits, so a photograph placed into the canvas can be set
  // clear of it rather than under it.
  return { layers, extent: { top, bottom: top + blockHeight } }
}

function sanitizeHex(value?: string) {
  if (!value) return undefined
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim())
  if (!match) return undefined
  const hex = match[1]!
  return `#${hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex}`.toLowerCase()
}

function readableOn(hex: string) {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  // ITU-R BT.601 luma; dark backgrounds get white text, light backgrounds get
  // near-black. Deterministic and perfectly inverse-of-background.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  return luma < 140 ? '#ffffff' : '#0f172a'
}

function clampWeight(value: number | undefined, fallback: number) {
  if (!value || !Number.isInteger(value)) return fallback
  return Math.max(300, Math.min(900, value))
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
