import { z } from 'zod'
import { publishingChannels } from './channel-format'

export const videoMusicSources = ['ai', 'library', 'none'] as const

export const videoMusicSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('ai') }),
  z.object({ source: z.literal('none') }),
  z.object({
    source: z.literal('library'),
    trackId: z.uuid(),
    title: z.string().max(120),
    credit: z.string().max(300).optional(),
  }),
])
export type VideoMusic = z.infer<typeof videoMusicSchema>

// What the business picks; the server fills in the track's title and credit.
export const videoMusicChoiceSchema = z.object({
  source: z.enum(videoMusicSources),
  trackId: z.uuid().optional(),
}).refine((choice) => choice.source !== 'library' || !!choice.trackId)
export type VideoMusicChoice = z.infer<typeof videoMusicChoiceSchema>

// The platform and music of each video a planner request makes. The planner
// decides which video goes where, so music is matched to a video by its
// platform: the first Instagram video takes the first Instagram choice.
export const plannerVideoMusicSchema = z.array(z.object({
  channel: z.enum(publishingChannels),
  music: videoMusicSchema,
})).max(100)
export type PlannerVideoMusic = z.infer<typeof plannerVideoMusicSchema>

/**
 * The music of the request's video for this platform at this position among
 * that platform's videos. Fewer choices than videos (a choice kept from a
 * smaller request) repeat the platform's last; a platform without a choice
 * has none.
 */
export function musicForVideo(choices: PlannerVideoMusic | undefined, channel: string, position: number) {
  const forChannel = (choices || []).filter((choice) => choice.channel === channel)
  return forChannel[Math.min(position, forChannel.length - 1)]?.music
}

// A mood the library is grouped by, kept by the superadmin. Its name is given
// per app language; English is always there and stands in for a missing one.
export const musicMoodSchema = z.object({
  slug: z.string(),
  names: z.record(z.string(), z.string()),
})
export type MusicMood = z.infer<typeof musicMoodSchema>

export function musicMoodName(mood: MusicMood | undefined, language: string) {
  return mood?.names[language]?.trim() || mood?.names.en || ''
}

export const musicTrackSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  artist: z.string().nullable(),
  mood: z.string(),
  durationSeconds: z.number(),
  credit: z.string().nullable(),
})
export type MusicTrack = z.infer<typeof musicTrackSchema>

/**
 * The caption as it goes out. A video laid with a library track whose licence
 * asks for attribution carries that credit at the end, so the business never
 * has to remember it. It is added on the way out rather than written into the
 * caption, so the business's own text stays its own and changing the track
 * never leaves an old credit behind.
 */
export function publishedCaption(post: { caption: string; video?: { music?: VideoMusic } }) {
  const music = post.video?.music
  const credit = music?.source === 'library' ? music.credit?.trim() : undefined
  if (!credit || post.caption.includes(credit)) return post.caption
  return `${post.caption.trimEnd()}\n\n${credit}`
}
