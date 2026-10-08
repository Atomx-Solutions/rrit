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

// OpenRouter's catalogue does not publish a model's prompt limit, so it is
// configured beside the model it belongs to. Unset means no limit is applied.
export function aiVideoPromptLimit() {
  const value = Number(process.env.OPENROUTER_VIDEO_PROMPT_MAX_CHARS)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export function aiVideoConfigured() {
  return !!config()
}

// The canvas and the length come from the post's own motion brief, so the
// provider call never restates them: `format` is the brief's "<width>x<height>".
function canvas(format: string) {
  const [width, height] = format.split('x').map(Number)
  if (!width || !height) throw createError({ statusCode: 422, message: 'server.VIDEO_FORMAT_INVALID' })
  const divisor = (a: number, b: number): number => (b ? divisor(b, a % b) : a)
  const gcd = divisor(width, height)
  return { aspectRatio: `${width / gcd}:${height / gcd}`, resolution: `${Math.min(width, height)}p` }
}

// RRIT's provider-independent video request. The planner and renderer build
// this shape; adapters convert it into provider-specific payloads. Adding a
// future provider only means adding another adapter — the rest of the
// pipeline keeps speaking this type.
export type VideoProviderRequest = {
  firstFrame: Buffer
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
type OpenRouterVideoModel = { id: string; supported_resolutions?: string[]; supported_frame_images?: string[] }
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
// `unsigned_urls`, `generate_audio`) never leak back into RRIT's own code.
async function openrouterAdapter(request: VideoProviderRequest): Promise<VideoProviderResult | null> {
  const provider = config()
  if (!provider) return null
  const model = await configuredModel(provider)
  const frame = (image: Buffer, frameType: 'first_frame' | 'last_frame') => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` },
    frame_type: frameType,
  })
  const response = await fetch(`${provider.baseUrl}/videos`, {
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
        frame(request.firstFrame, 'first_frame'),
        ...(request.lastFrame && model?.supported_frame_images?.includes('last_frame')
          ? [frame(request.lastFrame, 'last_frame')]
          : []),
      ],
    }),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
  const submitted = await response.json() as OpenRouterVideoStatus
  if (!response.ok || !submitted.id)
    throw createError({ statusCode: 502, message: providerError(submitted) || 'OpenRouter nuk e pranoi kërkesën për video.' })

  const pollUrl = submitted.polling_url?.startsWith('http')
    ? submitted.polling_url
    : `${provider.baseUrl}/videos/${submitted.id}`
  let completed: OpenRouterVideoStatus | undefined
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const poll = await fetch(pollUrl, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(30000), redirect: 'error' })
    completed = await poll.json() as OpenRouterVideoStatus
    if (['completed', 'succeeded'].includes((completed.status || '').toLowerCase())) break
    if (['failed', 'error', 'cancelled'].includes((completed.status || '').toLowerCase()))
      throw createError({ statusCode: 502, message: providerError(completed) || 'OpenRouter video generation failed.' })
  }
  if (!completed || !['completed', 'succeeded'].includes((completed.status || '').toLowerCase()))
    throw createError({ statusCode: 504, message: 'server.VIDEO_GENERATION_TIMEOUT' })
  const contentUrl = completed.unsigned_urls?.[0] || completed.data?.url || `${provider.baseUrl}/videos/${submitted.id}/content`
  const video = await fetch(contentUrl, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(120000), redirect: 'error' })
  if (!video.ok) throw createError({ statusCode: 502, message: 'server.VIDEO_DOWNLOAD_FAILED' })
  return { bytes: Buffer.from(await video.arrayBuffer()), costUsd: completed.usage?.cost ?? null }
}

// RRIT entry point. Builds the provider-independent request from the
// (image, prompt, duration, format) tuple callers already have, then hands it
// to the single configured adapter. Keeps the renderer blind to which
// provider is in use so a future adapter is a one-file addition.
export async function generateAiVideo(input: {
  image: Buffer
  lastFrame?: Buffer
  prompt: string
  durationSeconds: number
  format: string
}): Promise<VideoProviderResult | null> {
  const { aspectRatio, resolution } = canvas(input.format)
  return openrouterAdapter({
    firstFrame: input.image,
    lastFrame: input.lastFrame,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    aspectRatio,
    resolution,
  })
}
