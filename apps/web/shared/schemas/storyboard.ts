import { z } from 'zod'

// A call to action is set over an image or video, so it stays short. Prompts
// state this limit so the model writes a complete one instead of being cut off.
export const ctaMaxLength = 32

// The most a camera may turn around the subject. A single photograph shows one
// side of it; turning further would make the motion model invent the rest.
export const maxStoryboardRotationDegrees = 45
export const maxStoryboardShots = 3
// A video takes at most one photograph of its subject per shot.
export const maxVideoPhotos = maxStoryboardShots
// A video is told in separate scenes, so it has at least this many shots
// whenever the length allowed for it can hold them.
export const minStoryboardShots = 2

/**
 * One shot of a video concept, written by the AI creative director for this
 * post. Every creative field is the director's own words; the application
 * fixes only the rules a single photograph imposes, never a scene or a move.
 */
const shotSizeSchema = z.enum(['wide', 'medium', 'close', 'detail'])
const subjectFrameSchema = z.object({
  top: z.number().min(0).max(1),
  bottom: z.number().min(0).max(1),
})

export const storyboardShotSchema = z.object({
  // What this shot does for the video, in one sentence.
  purpose: z.string().trim().min(5).max(300),
  durationSeconds: z.number().int().min(1).max(30),
  // How much of the scene the frame holds. Consecutive shots differ in it, so
  // each scene reads as a scene of its own rather than one continued move.
  // Optional only so storyboards stored before it still read; the director
  // must give it (directorStoryboardSchema).
  shotSize: shotSizeSchema.optional(),
  // Which of the supplied photographs this shot is made from; 0 is the main
  // one. Optional so storyboards from one photograph read as before.
  photoIndex: z.number().int().min(0).max(maxVideoPhotos - 1).optional(),
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
  // Where the subject spans vertically in the supplied photograph, as shares
  // of its height from the top. The application keeps its text off this band.
  subjectFrame: subjectFrameSchema.optional(),
  // The call to action and caption set over the motion by the application.
  cta: z.string().trim().min(2).max(ctaMaxLength),
  caption: z.string().trim().min(10).max(2200),
})
export type Storyboard = z.infer<typeof storyboardSchema>

// What the director must answer: every field a new storyboard needs, framing
// and subject position included. Stored storyboards are read with the looser
// schema above.
export const directorStoryboardSchema = storyboardSchema.extend({
  shots: z.array(storyboardShotSchema.extend({
    shotSize: shotSizeSchema,
    photoIndex: z.number().int().min(0).max(maxVideoPhotos - 1),
  })).min(1).max(maxStoryboardShots),
  subjectFrame: subjectFrameSchema,
})
export type StoryboardShot = z.infer<typeof storyboardShotSchema>

// Words that describe showing a side of the subject the photograph does not
// show. A concept that needs them cannot be made from one photograph.
const unseenSides = /\b360\b|full (?:orbit|circle|turn|rotation|spin)|orbit(?:s|ing)? (?:around|the)|circl(?:e|es|ing) (?:around|the)|spin(?:s|ning)? around|(?:rear|back|underside|interior|inside) (?:view|side|of the)|behind the (?:car|vehicle|subject|product)/i

// How long a video may be and the shot lengths the configured motion model
// renders; both come from configuration and the model, never from here.
export type StoryboardLimits = {
  durations: number[]
  minSeconds: number
  maxSeconds: number
  // How many photographs of the subject the video is made from; one when unset.
  photos?: number
}

export function storyboardSeconds(storyboard: Storyboard) {
  return storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)
}

/**
 * The shape every storyboard must take: as many shots as the length can hold
 * (at least minStoryboardShots when it can), together lasting the longest
 * total the model's shot lengths reach within maxSeconds, so the video uses
 * the whole length it is allowed. A model without listed lengths fills
 * maxSeconds itself.
 */
export function storyboardShape(limits: StoryboardLimits) {
  const totals = (count: number): number[] => count === 0
    ? [0]
    : totals(count - 1).flatMap((sum) => limits.durations.map((length) => sum + length))
  const best = (count: number) => {
    if (!limits.durations.length) return count <= limits.maxSeconds ? limits.maxSeconds : null
    const fitting = totals(count).filter((sum) => sum >= limits.minSeconds && sum <= limits.maxSeconds)
    return fitting.length ? Math.max(...fitting) : null
  }
  const counts = Array.from({ length: maxStoryboardShots }, (_, index) => index + 1)
    .filter((count) => best(count) !== null)
  const multiShot = counts.filter((count) => count >= minStoryboardShots)
  const allowed = multiShot.length ? multiShot : counts
  if (!allowed.length) return null
  return {
    minShots: Math.min(...allowed),
    maxShots: Math.max(...allowed),
    totalSeconds: Math.max(...allowed.map((count) => best(count)!)),
  }
}

/**
 * Everything wrong with a storyboard beyond its schema, worded so it can be
 * handed back to the director as a correction. Empty means it can be made.
 */
export function storyboardProblems(storyboard: Storyboard, limits: StoryboardLimits) {
  const problems: string[] = []
  const total = storyboardSeconds(storyboard)
  const shape = storyboardShape(limits)
  if (shape) {
    if (storyboard.shots.length < shape.minShots || storyboard.shots.length > shape.maxShots)
      problems.push(`Tell the video in ${shape.minShots} to ${shape.maxShots} separate shots; it has ${storyboard.shots.length}.`)
    if (total !== shape.totalSeconds)
      problems.push(`The shots must last ${shape.totalSeconds} seconds together, the full length of the video; they last ${total}.`)
  } else if (total < limits.minSeconds || total > limits.maxSeconds)
    problems.push(`The shots must last between ${limits.minSeconds} and ${limits.maxSeconds} seconds together; they last ${total}.`)
  storyboard.shots.forEach((shot, index) => {
    if (limits.durations.length && !limits.durations.includes(shot.durationSeconds))
      problems.push(`Shot ${index + 1} lasts ${shot.durationSeconds} seconds; each shot must last one of ${limits.durations.join(', ')} seconds.`)
  })
  storyboard.shots.forEach((shot, index) => {
    const previous = storyboard.shots[index - 1]
    if (previous?.shotSize && previous.shotSize === shot.shotSize)
      problems.push(`Shot ${index + 1} has the same ${shot.shotSize} framing as shot ${index}; give each scene its own framing, so the video moves from one scene to the next.`)
  })
  // With several photographs, every shot names one that exists, as many of
  // them are used as the shots allow, and the video closes on the main one.
  const photos = limits.photos || 1
  const used = new Set(storyboard.shots.map((shot) => shot.photoIndex ?? 0))
  storyboard.shots.forEach((shot, index) => {
    if ((shot.photoIndex ?? 0) >= photos)
      problems.push(`Shot ${index + 1} uses photograph ${(shot.photoIndex ?? 0) + 1}, but only ${photos} ${photos === 1 ? 'was' : 'were'} supplied.`)
  })
  if (photos > 1 && used.size < Math.min(photos, storyboard.shots.length))
    problems.push(`Use ${Math.min(photos, storyboard.shots.length)} different photographs across the shots, so each scene shows the subject from its own angle; the storyboard uses ${used.size}.`)
  if (photos > 1 && (storyboard.shots.at(-1)?.photoIndex ?? 0) !== 0)
    problems.push('The final shot must be made from photograph 1, the main one, so the video closes on it.')
  if (storyboard.subjectFrame && storyboard.subjectFrame.bottom <= storyboard.subjectFrame.top)
    problems.push('subjectFrame.bottom must be below subjectFrame.top: give where the subject starts and ends in the photograph, from the top.')
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
