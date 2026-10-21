import { z } from 'zod'

// The most a camera may turn around the subject. A single photograph shows one
// side of it; turning further would make the motion model invent the rest.
export const maxStoryboardRotationDegrees = 45
export const maxStoryboardShots = 3

/**
 * One shot of a video concept, written by the AI creative director for this
 * post. Every creative field is the director's own words; the application
 * fixes only the rules a single photograph imposes, never a scene or a move.
 */
export const storyboardShotSchema = z.object({
  // What this shot does for the video, in one sentence.
  purpose: z.string().trim().min(5).max(300),
  durationSeconds: z.number().int().min(1).max(30),
  camera: z.object({
    // The camera move as a cinematographer would brief it.
    move: z.string().trim().min(5).max(300),
    lens: z.string().trim().min(2).max(120),
    speed: z.string().trim().min(2).max(120),
    ease: z.string().trim().min(2).max(120),
    // How far the camera turns around the subject over the shot.
    rotationDegrees: z.number().min(0).max(maxStoryboardRotationDegrees),
  }),
  // Light, weather, time of day and environment.
  atmosphere: z.string().trim().min(5).max(300),
  // Particles, dust, reflections, light play and other effects; may be "none".
  effects: z.string().trim().min(2).max(300),
  // What the photographed subject itself does: holds still, arrives into its
  // photographed place, or moves the way its kind naturally does.
  subject: z.object({
    motion: z.enum(['still', 'arrives', 'moves_naturally']),
    description: z.string().trim().min(5).max(300),
  }),
  // Whether the shot opens and closes on the real photograph's own view.
  opensOnPhotograph: z.boolean(),
  endsOnPhotograph: z.boolean(),
  // The director's own confirmation that the shot shows only sides of the
  // subject the photograph shows. False is rejected as a problem below.
  showsOnlyPhotographedSides: z.boolean(),
})

export const storyboardSchema = z.object({
  // The idea of this one video, in the director's words.
  concept: z.string().trim().min(10).max(400),
  rationale: z.string().trim().min(10).max(600),
  shots: z.array(storyboardShotSchema).min(1).max(maxStoryboardShots),
  // The call to action and caption set over the motion by the application.
  cta: z.string().trim().min(2).max(32),
  caption: z.string().trim().min(10).max(2200),
})
export type Storyboard = z.infer<typeof storyboardSchema>
export type StoryboardShot = z.infer<typeof storyboardShotSchema>

// Words that describe showing a side of the subject the photograph does not
// show. A concept that needs them cannot be made from one photograph.
const unseenSides = /\b360\b|full (?:orbit|circle|turn|rotation|spin)|orbit(?:s|ing)? (?:around|the)|circl(?:e|es|ing) (?:around|the)|spin(?:s|ning)? around|(?:rear|back|underside|interior|inside) (?:view|side|of the)|behind the (?:car|vehicle|subject|product)/i

/**
 * Everything wrong with a storyboard beyond its schema, worded so it can be
 * handed back to the director as a correction. Empty means it can be made.
 */
export function storyboardProblems(storyboard: Storyboard, totalSeconds: number) {
  const problems: string[] = []
  const total = storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)
  if (total !== totalSeconds)
    problems.push(`The shots must last ${totalSeconds} seconds together; they last ${total}.`)
  const last = storyboard.shots.at(-1)
  if (last && !last.endsOnPhotograph)
    problems.push('The final shot must end on the real photograph, so the video closes on the true subject.')
  storyboard.shots.forEach((shot, index) => {
    const text = [shot.purpose, shot.camera.move, shot.subject.description, shot.atmosphere, shot.effects].join(' ')
    if (!shot.showsOnlyPhotographedSides || unseenSides.test(text))
      problems.push(`Shot ${index + 1} turns around or shows a side of the subject the photograph does not show; keep the turn within ${maxStoryboardRotationDegrees} degrees and on the photographed side.`)
  })
  return problems
}
