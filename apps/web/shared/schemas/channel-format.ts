// The canvas every post is delivered at, decided by the one channel it is for.
// A photo and a video for the same channel share the canvas: Instagram and
// Facebook show both in the 4:5 feed, TikTok shows both full screen at 9:16.
// Nothing else in the application restates these sizes; it asks for the
// channel's canvas instead.
export const publishingChannels = ['Instagram', 'Facebook', 'TikTok'] as const
export type PublishingChannel = (typeof publishingChannels)[number]

export type Canvas = { width: number; height: number }

const channelCanvases = {
  Instagram: { width: 1080, height: 1350 },
  Facebook: { width: 1080, height: 1350 },
  TikTok: { width: 1080, height: 1920 },
} as const satisfies Record<PublishingChannel, Canvas>

// Every "<width>x<height>" a stored video brief may carry. Videos rendered
// before canvases followed the channel are all 1080x1920, which TikTok still
// uses, so every stored brief keeps parsing.
export const videoFormats = ['1080x1350', '1080x1920'] as const
export type VideoFormat = (typeof videoFormats)[number]

export function channelCanvas(channel: PublishingChannel): Canvas {
  return channelCanvases[channel]
}

export function channelFormat(channel: PublishingChannel): VideoFormat {
  const { width, height } = channelCanvases[channel]
  return `${width}x${height}` as VideoFormat
}

export function formatCanvas(format: string): Canvas {
  const [width, height] = format.split('x').map(Number)
  if (!width || !height) throw new Error(`Invalid canvas format: ${format}`)
  return { width, height }
}

export function ratioLabel(canvas: Canvas) {
  const divisor = (a: number, b: number): number => (b ? divisor(b, a % b) : a)
  const factor = divisor(canvas.width, canvas.height)
  return `${canvas.width / factor}:${canvas.height / factor}`
}

// Whether a delivered file is the channel's canvas. Encoders may round odd
// sizes, so a pixel or two either way is still the same canvas; anything more
// is a different shape and must not be published to that channel.
export function matchesChannelCanvas(
  channel: PublishingChannel,
  actual: { width: number; height: number },
  tolerancePx = 2,
) {
  const expected = channelCanvases[channel]
  return (
    Math.abs(actual.width - expected.width) <= tolerancePx &&
    Math.abs(actual.height - expected.height) <= tolerancePx
  )
}
