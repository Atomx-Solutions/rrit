type OpenRouterVideoStatus = {
  id?: string
  status?: string
  polling_url?: string
  error?: string
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

export async function generateAiVideo(input: {
  image: Buffer
  prompt: string
  durationSeconds: number
  format: string
}) {
  const provider = config()
  if (!provider) return null
  const { aspectRatio, resolution } = canvas(input.format)
  const imageDataUrl = `data:image/jpeg;base64,${input.image.toString('base64')}`
  const response = await fetch(`${provider.baseUrl}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      prompt: input.prompt,
      duration: input.durationSeconds,
      aspect_ratio: aspectRatio,
      resolution,
      generate_audio: false,
      frame_images: [{ type: 'image_url', image_url: { url: imageDataUrl }, frame_type: 'first_frame' }],
    }),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
  const submitted = await response.json() as OpenRouterVideoStatus
  if (!response.ok || !submitted.id)
    throw createError({ statusCode: 502, message: submitted.error || 'OpenRouter nuk e pranoi kërkesën për video.' })

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
      throw createError({ statusCode: 502, message: completed.error || 'OpenRouter video generation failed.' })
  }
  if (!completed || !['completed', 'succeeded'].includes((completed.status || '').toLowerCase()))
    throw createError({ statusCode: 504, message: 'server.VIDEO_GENERATION_TIMEOUT' })
  const contentUrl = completed.unsigned_urls?.[0] || completed.data?.url || `${provider.baseUrl}/videos/${submitted.id}/content`
  const video = await fetch(contentUrl, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(120000), redirect: 'error' })
  if (!video.ok) throw createError({ statusCode: 502, message: 'server.VIDEO_DOWNLOAD_FAILED' })
  return { bytes: Buffer.from(await video.arrayBuffer()), costUsd: completed.usage?.cost ?? null }
}
