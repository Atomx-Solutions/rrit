export const contentFormatRegistry = {
  static: {
    channels: {
      Facebook: { supported: true, mediaFit: 'natural' },
      Instagram: { supported: true, mediaFit: 'natural' },
      // The photograph a video is animated from is held as a static post, which
      // is why the format is supported here even though what reaches TikTok is
      // always the rendered video rather than the photograph. TikTok takes no
      // other deliverable, which the planner enforces.
      TikTok: { supported: true, mediaFit: 'natural' },
    },
  },
  carousel: {
    channels: {
      Facebook: { supported: false, mediaFit: 'natural' },
      Instagram: { supported: false, mediaFit: 'natural' },
      TikTok: { supported: false, mediaFit: 'natural' },
    },
  },
} as const

export type ContentFormat = keyof typeof contentFormatRegistry
export type ContentChannel = keyof (typeof contentFormatRegistry)['static']['channels']

export function channelFormatCapability(channel: ContentChannel, format: ContentFormat) {
  return contentFormatRegistry[format].channels[channel]
}
