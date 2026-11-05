import { ratioLabel, type Canvas } from '../../shared/schemas/channel-format'
import { rateLimitPause, rateLimitSettings, sendWithRateLimitRetry } from './provider-rate-limit'

type OpenRouterVideoStatus = {
  id?: string
  status?: string
  polling_url?: string
  // OpenRouter answers a rejected request with { error: { message, code } }
  // but a failed job with a plain string, so both shapes are accepted.
  error?: string | { message?: string; code?: string | number }
  data?: { url?: string }
  unsigned_urls?: string[]
  // What the provider says the generation actually cost, in USD. It is what the
  // business is charged for, so it is read from the completed job rather than
  // assumed from a configured figure.
  usage?: { cost?: number }
}

function config() {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  const model = (process.env.OPENROUTER_VIDEO_MODEL || process.env.AI_VIDEO_MODEL)?.trim()
  if (!key || !model) return null
  return { key, model, baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '') }
}

function providerError(status: OpenRouterVideoStatus) {
  return typeof status.error === 'string' ? status.error : status.error?.message
}

function positiveSetting(value: string | undefined, fallback: number) {
  const configured = Number(value)
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

/**
 * How the job is followed once submitted: how often it is asked about, how
 * long it may take in all and how many failed asks in a row end it. A
 * submission the provider rate-limited waits for it up to its own budget: the
 * provider takes many videos' shots at once only so far, and a shot that
 * waits its turn is made instead of failing its video.
 */
export function videoProviderSettings(env: Record<string, string | undefined> = process.env) {
  return {
    pollIntervalMs: positiveSetting(env.OPENROUTER_VIDEO_POLL_SECONDS, 2) * 1000,
    timeoutMs: positiveSetting(env.OPENROUTER_VIDEO_TIMEOUT_SECONDS, 600) * 1000,
    maxFailures: positiveSetting(env.OPENROUTER_VIDEO_MAX_FAILURES, 5),
    rateLimit: {
      ...rateLimitSettings(env),
      waitMs: positiveSetting(env.OPENROUTER_VIDEO_RATE_LIMIT_WAIT_SECONDS, 120) * 1000,
    },
  }
}

export type ProviderClock = { now: () => number; sleep: (ms: number) => Promise<void>; random?: () => number }
const realClock: ProviderClock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
const withRandom = (clock: ProviderClock) => ({ ...clock, random: clock.random ?? Math.random })

// A refusal worth asking again about: the provider was busy or briefly down.
function transientStatus(status: number) {
  return status === 429 || status >= 500
}

/**
 * Follows a submitted job until it completes. A failed ask (no answer, a busy
 * or failing provider, or an answer that is not JSON) is asked again, since
 * the job itself goes on and has already been paid for; only a run of
 * `maxFailures` of them in a row, or the job taking longer than `timeoutMs`,
 * gives it up. An ask the provider rate-limited is not a failure: the job is
 * fine and is asked about again after the pause the provider needs. A job the
 * provider reports as failed ends at once.
 */
export async function pollVideoJob(
  ask: () => Promise<Response>,
  settings: ReturnType<typeof videoProviderSettings>,
  clock: ProviderClock = realClock,
): Promise<OpenRouterVideoStatus> {
  const started = clock.now()
  let failures = 0
  let limited = 0
  for (;;) {
    if (clock.now() - started >= settings.timeoutMs)
      throw createError({ statusCode: 504, message: 'server.VIDEO_GENERATION_TIMEOUT' })
    await clock.sleep(settings.pollIntervalMs)
    let status: OpenRouterVideoStatus | undefined
    let pause = 0
    try {
      const response = await ask()
      if (response.ok) status = await response.json() as OpenRouterVideoStatus
      else if (response.status === 429)
        pause = rateLimitPause(++limited, response.headers.get('retry-after'), settings.rateLimit, withRandom(clock))
      else if (!transientStatus(response.status)) {
        const body = await response.json().catch(() => ({})) as OpenRouterVideoStatus
        throw createError({ statusCode: 502, message: providerError(body) || 'OpenRouter video generation failed.' })
      }
    } catch (error) {
      // A refusal decided above is final; anything else was a failed ask.
      if (typeof error === 'object' && error && 'statusCode' in error) throw error
    }
    if (pause) {
      await clock.sleep(pause)
      continue
    }
    limited = 0
    if (!status) {
      failures++
      if (failures >= settings.maxFailures)
        throw createError({ statusCode: 502, message: 'OpenRouter did not answer about the video job.' })
      continue
    }
    failures = 0
    const state = (status.status || '').toLowerCase()
    if (['completed', 'succeeded'].includes(state)) return status
    if (['failed', 'error', 'cancelled'].includes(state))
      throw createError({ statusCode: 502, message: providerError(status) || 'OpenRouter video generation failed.' })
  }
}

/**
 * Downloads a finished video, asking again when the download fails for a
 * reason that can pass: the video is paid for and must not be lost to one
 * dropped connection.
 */
export async function downloadVideoContent(
  download: () => Promise<Response>,
  settings: ReturnType<typeof videoProviderSettings>,
  clock: ProviderClock = realClock,
) {
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined
    try {
      response = await download()
      if (response.ok) return Buffer.from(await response.arrayBuffer())
    } catch {
      // A dropped connection or a timeout; asked again below.
    }
    if ((response && !transientStatus(response.status)) || attempt >= settings.maxFailures)
      throw createError({ statusCode: 502, message: 'server.VIDEO_DOWNLOAD_FAILED' })
    await clock.sleep(response?.status === 429
      ? rateLimitPause(attempt, response.headers.get('retry-after'), settings.rateLimit, withRandom(clock))
      : settings.pollIntervalMs * attempt)
  }
}

/**
 * Submits a job. Only a submission the provider turned away as rate-limited
 * is sent again, after the wait it asks for and within the video's wait
 * budget: that one was never accepted. Any other failure may have started a
 * paid job, so it is never sent twice.
 */
export async function submitVideoJob(
  send: () => Promise<Response>,
  settings: ReturnType<typeof videoProviderSettings>,
  clock: ProviderClock = realClock,
) {
  const response = await sendWithRateLimitRetry(send, settings.rateLimit, withRandom(clock))
  const submitted = await response.json().catch(() => ({})) as OpenRouterVideoStatus
  if (!response.ok || !submitted.id)
    throw createError({ statusCode: 502, message: providerError(submitted) || 'OpenRouter nuk e pranoi kërkesën për video.' })
  return submitted
}

// OpenRouter's catalogue does not publish a model's prompt limit, so it is
// configured beside the model it belongs to. Unset means no limit is applied.
export function aiVideoPromptLimit() {
  const value = Number(process.env.OPENROUTER_VIDEO_PROMPT_MAX_CHARS)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export function aiVideoConfigured() {
  return !!config()
}


// Framic's provider-independent video request. The planner and renderer build
// this shape; adapters convert it into provider-specific payloads. Adding a
// future provider only means adding another adapter — the rest of the
// pipeline keeps speaking this type.
export type VideoProviderRequest = {
  // Where the motion starts. Left out for a shot that opens away from the
  // photograph and only has to arrive at it.
  firstFrame?: Buffer
  // Where the motion must end. Sent only to a model that accepts a closing
  // frame; it pins the subject at both ends so the model cannot redraw it.
  lastFrame?: Buffer
  prompt: string
  durationSeconds: number
  aspectRatio: string
  resolution: string
}

export type VideoProviderResult = { bytes: Buffer; costUsd: number | null }

// What the configured model accepts, as OpenRouter publishes it. Read once per
// process: the catalogue changes with the model, not between renders.
type OpenRouterVideoModel = {
  id: string
  supported_resolutions?: string[]
  supported_aspect_ratios?: string[]
  supported_frame_images?: string[]
  supported_durations?: number[]
  pricing_skus?: Record<string, string>
}

/**
 * What one second of video costs in USD at a resolution, read from the price
 * list OpenRouter publishes for the model. Videos are made without audio, so
 * the silent price is preferred; a price in cents is converted. A model priced
 * some other way (per token, for instance) has no per-second price here and
 * the caller falls back on the configured reservation.
 */
export function pricePerSecondUsd(skus: Record<string, string> | undefined, resolution: string): number | null {
  const prices = Object.entries(skus || {}).flatMap(([key, value]) => {
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount <= 0 || !/second/.test(key)) return []
    if (/reference|video_input|continuation|image/.test(key)) return []
    return [{ key, usd: key.startsWith('cents_per') ? amount / 100 : amount }]
  })
  const silent = prices.filter((price) => price.key.includes('without_audio'))
  const pool = silent.length ? silent : prices.filter((price) => !price.key.includes('with_audio'))
  const candidates = pool.length ? pool : prices
  const sized = /_(\d+p|\dk)$/i
  const exact = candidates.find((price) => price.key.toLowerCase().endsWith(`_${resolution.toLowerCase()}`))
  const general = candidates.find((price) => !sized.test(price.key))
  const chosen = exact || general
  return chosen ? chosen.usd : null
}

/**
 * What the configured model (OPENROUTER_VIDEO_MODEL) can do, as OpenRouter
 * publishes it: the shot lengths it renders and the frames it can be pinned
 * to. Nothing here is assumed about a particular model.
 */
export async function aiVideoCapabilities(canvas?: { width: number; height: number }) {
  const provider = config()
  const model = provider ? await configuredModel(provider) : undefined
  // The resolution actually asked of the model for this canvas, the same
  // one the adapter sends, so the price matches the call.
  const resolution = canvas
    ? providerResolution(resolutionCap(`${Math.min(canvas.width, canvas.height)}p`), model?.supported_resolutions || [])
    : undefined
  return {
    model: provider?.model,
    pricePerSecondUsd: resolution ? pricePerSecondUsd(model?.pricing_skus, resolution) : null,
    durations: [...new Set(model?.supported_durations || [])].filter((value) => Number.isInteger(value) && value > 0).sort((a, b) => a - b),
    firstFrame: !model?.supported_frame_images || model.supported_frame_images.includes('first_frame'),
    lastFrame: !!model?.supported_frame_images?.includes('last_frame'),
  }
}
let modelCatalogue: Promise<OpenRouterVideoModel[]> | undefined

async function configuredModel(provider: NonNullable<ReturnType<typeof config>>) {
  modelCatalogue ||= fetch(`${provider.baseUrl}/videos/models`, {
    headers: { Authorization: `Bearer ${provider.key}` },
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
    .then(async (response) => (response.ok ? ((await response.json()) as { data?: OpenRouterVideoModel[] }).data || [] : []))
    .catch(() => [])
  const models = await modelCatalogue
  // An empty catalogue is a failed lookup, so it is not kept: the next render
  // asks again instead of sending unchecked resolutions for the process's life.
  if (!models.length) modelCatalogue = undefined
  return models.find((model) => model.id === provider.model)
}

// The brief's canvas is what the composed MP4 is delivered at; the provider
// clip is scaled into it afterwards. A model that cannot produce that size is
// asked for the largest size it can, rather than rejecting the whole render.
function providerResolution(requested: string, supported: string[]) {
  const height = (value: string) => Number.parseInt(value, 10)
  const usable = supported.filter((value) => /^\d+p$/.test(value))
  if (!usable.length || usable.includes(requested)) return requested
  const byHeight = [...usable].sort((a, b) => height(a) - height(b))
  const below = byHeight.filter((value) => height(value) <= height(requested))
  // The largest size not above the brief; failing that, the smallest offered.
  return below.at(-1) || byHeight[0]!
}

// The largest size worth paying the provider for. The delivered MP4 keeps the
// brief's canvas either way, so a lower figure trades motion sharpness for
// cost; unset asks for the canvas itself.
function resolutionCap(requested: string) {
  const cap = process.env.OPENROUTER_VIDEO_MAX_RESOLUTION?.trim()
  if (!cap || !/^\d+p$/.test(cap)) return requested
  return Number.parseInt(cap, 10) < Number.parseInt(requested, 10) ? cap : requested
}

// OpenRouter is the only adapter today. The function is kept narrow so the
// OpenRouter-specific field names (`frame_images`, `polling_url`,
// `unsigned_urls`, `generate_audio`) never leak back into Framic's own code.
async function openrouterAdapter(request: VideoProviderRequest): Promise<VideoProviderResult | null> {
  const provider = config()
  if (!provider) return null
  const model = await configuredModel(provider)
  const frame = (image: Buffer, frameType: 'first_frame' | 'last_frame') => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
    frame_type: frameType,
  })
  const settings = videoProviderSettings()
  const submitted = await submitVideoJob(() => fetch(`${provider.baseUrl}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      prompt: request.prompt,
      duration: request.durationSeconds,
      aspect_ratio: request.aspectRatio,
      resolution: providerResolution(resolutionCap(request.resolution), model?.supported_resolutions || []),
      generate_audio: false,
      frame_images: [
        ...(request.firstFrame ? [frame(request.firstFrame, 'first_frame')] : []),
        ...(request.lastFrame && model?.supported_frame_images?.includes('last_frame')
          ? [frame(request.lastFrame, 'last_frame')]
          : []),
      ],
    }),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  }), settings)

  const pollUrl = submitted.polling_url?.startsWith('http')
    ? submitted.polling_url
    : `${provider.baseUrl}/videos/${submitted.id}`
  const completed = await pollVideoJob(
    () => fetch(pollUrl, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(30000), redirect: 'error' }),
    settings,
  )
  const contentUrl = completed.unsigned_urls?.[0] || completed.data?.url || `${provider.baseUrl}/videos/${submitted.id}/content`
  const bytes = await downloadVideoContent(
    () => fetch(contentUrl, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(120000), redirect: 'error' }),
    settings,
  )
  return { bytes, costUsd: completed.usage?.cost ?? null }
}

/**
 * The canvas the configured model is asked to paint for a delivered canvas.
 *
 * A model offers only some aspect ratios (Veo: 16:9 and 9:16, never 4:5), so
 * the delivered canvas is placed whole inside the offered ratio that wastes
 * the least of it: the frames sent are the delivered frames padded out to that
 * ratio, and the composer centre-crops the clip back to the delivered canvas.
 * Nothing of the photograph is cut to fit the provider. A model that does not
 * publish its ratios is asked for the delivered canvas itself.
 */
export async function aiVideoCanvas(target: Canvas): Promise<{ canvas: Canvas; aspectRatio: string }> {
  const provider = config()
  const model = provider ? await configuredModel(provider) : undefined
  return providerCanvasFor(target, model?.supported_aspect_ratios || [])
}

export function providerCanvasFor(target: Canvas, supported: string[]) {
  const targetAspect = target.width / target.height
  const ratios = supported.flatMap((value) => {
    const [width, height] = value.split(':').map(Number)
    return width && height ? [{ label: value, aspect: width / height }] : []
  })
  if (!ratios.length || ratios.some((ratio) => Math.abs(ratio.aspect - targetAspect) < 0.005))
    return { canvas: target, aspectRatio: ratioLabel(target) }
  const kept = (aspect: number) => Math.min(aspect, targetAspect) / Math.max(aspect, targetAspect)
  const best = ratios.reduce((winner, ratio) => (kept(ratio.aspect) > kept(winner.aspect) ? ratio : winner))
  // Taller than the target: keep its width and add height. Wider: the reverse.
  const canvas = best.aspect < targetAspect
    ? { width: target.width, height: Math.round(target.width / best.aspect) }
    : { width: Math.round(target.height * best.aspect), height: target.height }
  return { canvas, aspectRatio: best.label }
}

// Framic entry point. Builds the provider-independent request from what the
// renderer already has, then hands it to the single configured adapter. Keeps
// the renderer blind to which provider is in use so a future adapter is a
// one-file addition. `canvas` and `aspectRatio` come from aiVideoCanvas.
export async function generateAiVideo(input: {
  image?: Buffer
  lastFrame?: Buffer
  prompt: string
  durationSeconds: number
  canvas: Canvas
  aspectRatio: string
}): Promise<VideoProviderResult | null> {
  return openrouterAdapter({
    firstFrame: input.image,
    lastFrame: input.lastFrame,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    resolution: `${Math.min(input.canvas.width, input.canvas.height)}p`,
  })
}
