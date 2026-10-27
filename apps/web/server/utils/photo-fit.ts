import sharp from 'sharp'
import { z } from 'zod'
import {
  channelCanvas,
  ratioLabel,
  type Canvas,
  type PublishingChannel,
} from '../../shared/schemas/channel-format'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
} from './ai-provider'
import { providerCreativeCanvas } from './monthly-planner-domain'
import { parseMonthlyProviderResponse, REVIEW_MAX_OUTPUT_TOKENS, responseText } from './monthly-ai'

/**
 * Fitting a business photograph to the canvas of the channel it is for.
 *
 * How far a photograph is from the canvas is measured as the share of it a
 * plain crop would throw away. Close enough, it is used as it is; a little
 * off, it is cropped around its subject; further off, it is cropped only as
 * far as that is safe and the rest of the canvas is painted by the image model
 * around it. The photograph's own pixels are then laid back over the painting
 * unchanged, so the subject is never redrawn, only surrounded.
 */
export type PhotoFitMode = 'as_is' | 'crop' | 'outpaint' | 'crop_fallback'

export type PhotoFitThresholds = {
  // A crop that discards no more than this share counts as the same shape.
  exactLoss: number
  // The most of the photograph a crop may discard before the canvas is
  // extended instead.
  cropLoss: number
}

function share(variable: string, fallback: number) {
  const value = Number(process.env[variable])
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : fallback
}

export function photoFitThresholds(): PhotoFitThresholds {
  return {
    exactLoss: share('PHOTO_FIT_EXACT_LOSS', 0.02),
    cropLoss: share('PHOTO_FIT_MAX_CROP_LOSS', 0.2),
  }
}

/** The share of a photograph a crop to the canvas shape would discard. */
export function cropLoss(source: Canvas, target: Canvas) {
  const sourceAspect = source.width / source.height
  const targetAspect = target.width / target.height
  return 1 - Math.min(sourceAspect, targetAspect) / Math.max(sourceAspect, targetAspect)
}

export function planPhotoFit(source: Canvas, target: Canvas, thresholds = photoFitThresholds()): Exclude<PhotoFitMode, 'crop_fallback'> {
  const loss = cropLoss(source, target)
  if (loss <= thresholds.exactLoss) return 'as_is'
  if (loss <= thresholds.cropLoss) return 'crop'
  return 'outpaint'
}

async function orientedSize(image: Buffer) {
  const meta = await sharp(image, { limitInputPixels: 24000000 }).metadata()
  const rotated = (meta.orientation || 1) >= 5
  return { width: (rotated ? meta.height : meta.width) || 0, height: (rotated ? meta.width : meta.height) || 0 }
}

// A uniform scale and a crop, never a stretch. Attention keeps the salient
// subject in frame; an image sharp cannot judge falls back to the centre.
async function coverResize(image: Buffer, size: Canvas) {
  const base = sharp(image, { limitInputPixels: 24000000 }).rotate()
  try {
    return await base.clone().resize(size.width, size.height, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 94, mozjpeg: true }).toBuffer()
  } catch {
    return await base.resize(size.width, size.height, { fit: 'cover', position: 'centre' }).jpeg({ quality: 94, mozjpeg: true }).toBuffer()
  }
}

export async function smartCropToCanvas(image: Buffer, canvas: Canvas) {
  return coverResize(image, canvas)
}

export type OutpaintLayout = {
  // The canvas sent to the model: the photograph in place, the rest a blurred
  // stretch of itself that the model is asked to repaint.
  guide: Buffer
  // The photograph at its size on the canvas, laid back over the painting.
  photo: Buffer
  placement: { left: number; top: number; width: number; height: number }
}

/**
 * Where the photograph sits on the canvas before the model paints around it.
 * It is first cropped toward the canvas shape by no more than the allowed
 * crop, so the model invents as little as it can, then placed whole.
 */
export async function outpaintLayout(image: Buffer, canvas: Canvas, maxCropLoss = photoFitThresholds().cropLoss): Promise<OutpaintLayout> {
  const source = await orientedSize(image)
  const sourceAspect = source.width / source.height
  const targetAspect = canvas.width / canvas.height
  const keptAspect = sourceAspect > targetAspect
    ? Math.max(targetAspect, sourceAspect * (1 - maxCropLoss))
    : Math.min(targetAspect, sourceAspect / (1 - maxCropLoss))
  const wide = keptAspect > targetAspect
  const placement = wide
    ? { width: canvas.width, height: Math.round(canvas.width / keptAspect) }
    : { width: Math.round(canvas.height * keptAspect), height: canvas.height }
  const photo = await coverResize(image, placement)
  const left = Math.round((canvas.width - placement.width) / 2)
  const top = Math.round((canvas.height - placement.height) / 2)
  const fill = await sharp(photo)
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(canvas.width / 30)))
    .modulate({ brightness: 0.85 })
    .toBuffer()
  const guide = await sharp(fill).composite([{ input: photo, left, top }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
  return { guide, photo, placement: { ...placement, left, top } }
}

/**
 * The model's painting with the photograph laid back over it. Only a thin band
 * along the edges the painting meets is blended so the join does not show;
 * everything inside that band is the photograph's own pixels, unchanged.
 */
export async function restorePhotograph(painted: Buffer, layout: OutpaintLayout, canvas: Canvas) {
  const { placement } = layout
  const base = await sharp(painted, { limitInputPixels: 24000000 })
    .rotate()
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'centre' })
    .toBuffer()
  const band = blendBand(canvas)
  const touches = {
    left: placement.left > 0,
    right: placement.left + placement.width < canvas.width,
    top: placement.top > 0,
    bottom: placement.top + placement.height < canvas.height,
  }
  const alpha = Buffer.alloc(placement.width * placement.height)
  for (let y = 0; y < placement.height; y++) {
    for (let x = 0; x < placement.width; x++) {
      const distance = Math.min(
        touches.left ? x : Number.POSITIVE_INFINITY,
        touches.right ? placement.width - 1 - x : Number.POSITIVE_INFINITY,
        touches.top ? y : Number.POSITIVE_INFINITY,
        touches.bottom ? placement.height - 1 - y : Number.POSITIVE_INFINITY,
      )
      alpha[y * placement.width + x] = distance >= band ? 255 : Math.round(255 * (distance + 1) / (band + 1))
    }
  }
  const photo = await sharp(layout.photo)
    .removeAlpha()
    .joinChannel(alpha, { raw: { width: placement.width, height: placement.height, channels: 1 } })
    .png()
    .toBuffer()
  return sharp(base)
    .composite([{ input: photo, left: placement.left, top: placement.top }])
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer()
}

/** How many pixels along a join are blended, from the canvas width. */
export function blendBand(canvas: Canvas) {
  return Math.max(4, Math.round(canvas.width * 0.015))
}

/**
 * How strongly the joins between the photograph and the painting show, as the
 * brightness step across each join relative to the ordinary step between
 * neighbouring rows or columns beside it. Around 1 is invisible; a hard line
 * stands well above it.
 */
export async function seamStrength(image: Buffer, placement: OutpaintLayout['placement']) {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[y * info.width + x]!
  const rowStep = (y: number) => {
    let total = 0
    for (let x = 0; x < info.width; x++) total += Math.abs(at(x, y) - at(x, y - 1))
    return total / info.width
  }
  const columnStep = (x: number) => {
    let total = 0
    for (let y = 0; y < info.height; y++) total += Math.abs(at(x, y) - at(x - 1, y))
    return total / info.height
  }
  const strength = (step: (index: number) => number, edge: number, limit: number) => {
    if (edge <= 12 || edge >= limit - 12) return 0
    const around = [-10, -8, -6, 6, 8, 10].map((offset) => step(edge + offset))
    const ordinary = around.reduce((sum, value) => sum + value, 0) / around.length
    const join = Math.max(step(edge - 1), step(edge), step(edge + 1))
    return join / (ordinary + 1)
  }
  return Math.max(
    strength(rowStep, placement.top, info.height),
    strength(rowStep, placement.top + placement.height, info.height),
    strength(columnStep, placement.left, info.width),
    strength(columnStep, placement.left + placement.width, info.width),
  )
}

/** A join this much stronger than the image around it reads as a line. */
export function seamLimit() {
  const value = Number(process.env.PHOTO_FIT_SEAM_LIMIT)
  return Number.isFinite(value) && value > 1 ? value : 3
}

export function outpaintPrompt(channel: PublishingChannel, placement: OutpaintLayout['placement'], canvas: Canvas) {
  const sides = [
    placement.top > 0 ? 'above' : '',
    placement.top + placement.height < canvas.height ? 'below' : '',
    placement.left > 0 ? 'to the left of' : '',
    placement.left + placement.width < canvas.width ? 'to the right of' : '',
  ].filter(Boolean)
  return [
    `The supplied image is a ${ratioLabel(canvas)} canvas for ${channel}. A real business photograph sits in it unchanged; the blurred area ${sides.join(' and ')} it is only a placeholder.`,
    'Repaint only the placeholder area so the real scene simply continues beyond the photograph: the same place, ground, sky, walls and surfaces, with the same light direction, colour temperature, perspective, horizon, lens and grain, and no visible line where the photograph ends.',
    'Leave everything inside the photograph exactly as it is. Do not move, redraw, extend, duplicate or mirror its subject, and do not add any person, animal, vehicle, product, sign, text, logo, number plate or watermark. When unsure what lies beyond, continue the plain background.',
    'Return one opaque image of the whole canvas, with no explanation.',
  ].join('\n')
}

const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(100) })).min(1),
  usage: z.object({ cost: z.number().nonnegative().optional() }).passthrough().optional(),
})

/**
 * One outpainting call made directly to the configured image provider, for
 * work outside a monthly plan. Its cost is returned so the caller charges it
 * with the rest of the job.
 */
export async function requestOutpaint(guide: Buffer, prompt: string, channel: PublishingChannel) {
  const provider = aiProviderConfiguration()
  const model = aiProviderModel('AI_IMAGE_MODEL')
  let response: Response
  if (provider.name === 'openrouter') {
    response = await fetch(provider.imagesUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
      headers: provider.headers,
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: ratioLabel(providerCreativeCanvas(channel)),
        background: 'opaque',
        n: 1,
        input_references: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${guide.toString('base64')}` } }],
      }),
    })
  } else {
    const body = new FormData()
    body.set('model', model)
    body.set('prompt', prompt)
    body.set('size', '1024x1536')
    body.set('image[]', new Blob([new Uint8Array(guide)], { type: 'image/jpeg' }), 'canvas.jpg')
    const headers = { ...provider.headers }
    delete headers['Content-Type']
    response = await fetch(provider.imagesUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000), headers, body })
  }
  if (!response.ok) throw new Error(`outpaint_rejected:${response.status}`)
  const result = imageResponseSchema.parse(await response.json())
  return { bytes: Buffer.from(result.data[0]!.b64_json, 'base64'), costUsd: result.usage?.cost ?? null }
}

const extensionReviewSchema = z.object({
  natural: z.boolean(),
  reason: z.string().max(400),
})

/**
 * Whether an extended photograph reads as one real photograph. A review that
 * cannot run is a failure: an unchecked extension is not delivered.
 */
export async function reviewExtension(original: Buffer, extended: Buffer) {
  try {
    const provider = aiProviderConfiguration()
    const image = (bytes: Buffer) => ({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      detail: 'high',
    })
    const response = await fetch(provider.responsesUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: provider.headers,
      body: JSON.stringify({
        model: aiProviderModel('AI_PLANNER_MODEL'),
        store: false,
        instructions:
          'The first image is a real photograph. The second is the same photograph extended to a new canvas by an image model. Answer natural=true only if the second reads as one real photograph: no visible line or change of texture where the original ends, the same light direction, colour and perspective throughout, nothing duplicated or mirrored, and no added person, vehicle, product, sign, text or logo. Give a short reason in English.',
        max_output_tokens: REVIEW_MAX_OUTPUT_TOKENS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Original, then extended.' }, image(original), image(extended)] }],
        ...aiProviderStructuredRouting(provider.name),
        text: {
          format: {
            type: 'json_schema',
            name: 'photo_extension_review',
            strict: true,
            schema: aiProviderJsonSchema(z.toJSONSchema(extensionReviewSchema)),
          },
        },
      }),
    })
    if (!response.ok) return { natural: false, reason: `review_unavailable:${response.status}`, costUsd: 0 }
    const raw = parseMonthlyProviderResponse(await response.json())
    // What the review itself cost, charged with the fit.
    return { ...extensionReviewSchema.parse(JSON.parse(responseText(raw))), costUsd: raw.usage.cost ?? 0 }
  } catch (error) {
    return { natural: false, reason: `review_unavailable:${error instanceof Error ? error.message : 'unknown'}`, costUsd: 0 }
  }
}

export type PhotoFitDependencies = {
  // Paints the guide; returns the painting and what it cost, if known.
  outpaint: (guide: Buffer, prompt: string, attempt: number) => Promise<{ bytes: Buffer; costUsd?: number | null }>
  review?: (original: Buffer, extended: Buffer) => Promise<{ natural: boolean; reason: string; costUsd?: number }>
  attempts?: number
  thresholds?: PhotoFitThresholds
}

export type PhotoFit = {
  bytes: Buffer
  mode: PhotoFitMode
  costUsd: number
  reasons: string[]
}

/**
 * The photograph on the channel's canvas. An extension that shows a seam or
 * fails review is painted once more; if that fails too, the photograph is
 * cropped around its subject instead, which is always available.
 */
export async function fitPhotoToChannel(image: Buffer, channel: PublishingChannel, dependencies?: PhotoFitDependencies): Promise<PhotoFit> {
  const canvas = channelCanvas(channel)
  const thresholds = dependencies?.thresholds || photoFitThresholds()
  const mode = planPhotoFit(await orientedSize(image), canvas, thresholds)
  if (mode !== 'outpaint' || !dependencies)
    return { bytes: await smartCropToCanvas(image, canvas), mode: mode === 'outpaint' ? 'crop_fallback' : mode, costUsd: 0, reasons: [] }
  const layout = await outpaintLayout(image, canvas, thresholds.cropLoss)
  const prompt = outpaintPrompt(channel, layout.placement, canvas)
  const reasons: string[] = []
  let costUsd = 0
  const attempts = dependencies.attempts ?? 2
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const painted = await dependencies.outpaint(layout.guide, prompt, attempt)
      costUsd += painted.costUsd || 0
      const extended = await restorePhotograph(painted.bytes, layout, canvas)
      const seam = await seamStrength(extended, layout.placement)
      if (seam > seamLimit()) {
        reasons.push(`seam:${seam.toFixed(2)}`)
        continue
      }
      const review = dependencies.review ? await dependencies.review(image, extended) : { natural: true, reason: '' }
      costUsd += ('costUsd' in review && review.costUsd) || 0
      if (!review.natural) {
        reasons.push(`review:${review.reason}`)
        continue
      }
      return { bytes: extended, mode: 'outpaint', costUsd, reasons }
    } catch (error) {
      reasons.push(`outpaint_failed:${error instanceof Error ? error.message : 'unknown'}`)
    }
  }
  return { bytes: await smartCropToCanvas(image, canvas), mode: 'crop_fallback', costUsd, reasons }
}
