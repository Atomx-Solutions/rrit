// One instrumental track for the whole finished video. The video is made of
// separately generated shots, so music made per shot would change at every
// cut; it is made once, from frames of the finished video, and laid under it.

function config() {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  const model = process.env.OPENROUTER_MUSIC_MODEL?.trim()
  if (!key || !model) return null
  return { key, model, baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '') }
}

/** Whether a music model is configured; without one videos stay silent. */
export function videoMusicConfigured() {
  return config() !== null
}

type MusicChunk = {
  choices?: { delta?: { audio?: { data?: string } } }[]
  usage?: { cost?: number }
  error?: { message?: string }
}

/**
 * Asks the music model for a track that suits what the video shows. Audio
 * output only arrives streamed, as base64 pieces of one MP3.
 */
export async function generateVideoMusic(input: {
  frames: Buffer[]
  caption: string
  brandName: string
  durationSeconds: number
}) {
  const provider = config()
  if (!provider) return null
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(180000),
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      modalities: ['text', 'audio'],
      audio: { format: 'mp3' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Compose instrumental background music for a ${Math.round(input.durationSeconds)}-second social media video of ${input.brandName}. `
              + 'The images are frames of the video in order. Match the place, the mood, the light and the pace you see in them. '
              + `The post says: "${input.caption.slice(0, 600)}". `
              + 'No vocals, no lyrics, no spoken words. A clear start and a calm ending, mixed to sit under the picture.',
          },
          ...input.frames.map((frame) => ({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${frame.toString('base64')}` },
          })),
        ],
      }],
    }),
  })
  if (!response.ok) throw new Error(`music_unavailable:${response.status}`)
  let audio = ''
  let costUsd: number | null = null
  for (const line of (await response.text()).split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    let chunk: MusicChunk
    try {
      chunk = JSON.parse(line.slice(6)) as MusicChunk
    } catch {
      continue
    }
    if (chunk.error) throw new Error(`music_failed:${chunk.error.message || 'unknown'}`)
    audio += chunk.choices?.[0]?.delta?.audio?.data || ''
    if (typeof chunk.usage?.cost === 'number') costUsd = chunk.usage.cost
  }
  if (!audio) throw new Error('music_empty')
  return { audio: Buffer.from(audio, 'base64'), costUsd }
}
