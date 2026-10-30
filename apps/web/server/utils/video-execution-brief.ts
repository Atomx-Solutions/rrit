import type { Storyboard } from '../../shared/schemas/storyboard'
import { sceneDressingRule } from './scene-dressing'

// What every motion prompt says about the photographed subject, whoever
// directed the video.
const subjectRules = [
  'Preserve the exact primary subject, people, products, existing signage and environment visible in the frames. The photograph is the visual truth.',
  'Keep the subject identical in every frame: the same make, model, generation, body shape, colour, wheels, lights, badges, proportions and details. Never morph, replace, restyle or swap it for a similar subject.',
  'Show only what the photograph shows. Never reveal or invent a side, angle, interior or part of the subject that is not visible in the frames.',
  'Never draw, write or animate any letters, words, numbers, captions or titles anywhere in the video; the application sets all text afterwards.',
  sceneDressingRule,
]

const subjectMotion: Record<Storyboard['shots'][number]['subject']['motion'], string> = {
  still: 'The subject holds perfectly still in its photographed place.',
  arrives: 'The subject arrives into its photographed place and settles exactly as photographed.',
  moves_naturally: 'The subject moves only the way its kind naturally does, and remains the very same subject.',
}

/**
 * The motion prompt for one shot of a storyboard from the creative director,
 * written as a cinematographer's brief. Each shot is generated on its own, so
 * the prompt says where it starts and ends: on the photograph, where the
 * previous shot ended, or on a view the director invents for an arrival.
 */
export function buildShotExecutionBrief(input: {
  storyboard: Storyboard
  index: number
  // What the shot is pinned to.
  start: 'photograph' | 'previous_shot' | 'free'
  endsOnPhotograph: boolean
  guardrails?: string[]
  maxLength?: number
}) {
  const { storyboard, index } = input
  const shot = storyboard.shots[index]!
  const guardrails = (input.guardrails || []).map(rule => rule.trim()).filter(Boolean)
  const opening = input.start === 'photograph'
    ? 'It starts exactly on the supplied first frame, a real photograph.'
    : input.start === 'previous_shot'
      ? 'It starts exactly on the supplied first frame, the last frame of the previous shot, and continues its motion without a jump.'
      : 'It opens on the scene this shot describes, before the subject is in its photographed place.'
  const closing = input.endsOnPhotograph
    ? 'It ends exactly on the supplied last frame, the real photograph.'
    : ''
  const build = (detail: number) => {
    const clip = (value: string) => value.length > detail ? `${value.slice(0, detail).trimEnd()}…` : value
    return [
      `Create one continuous ${shot.durationSeconds}-second shot, shot ${index + 1} of ${storyboard.shots.length} of one video. ${opening} ${closing}`.trim(),
      'CONCEPT',
      clip(storyboard.concept),
      'THIS SHOT',
      clip(shot.purpose),
      'SUBJECT',
      ...subjectRules,
      `${subjectMotion[shot.subject.motion]} ${clip(shot.subject.description)}`,
      'CAMERA',
      `${shot.shotSize ? `A ${shot.shotSize} shot. ` : ''}${clip(shot.camera.move)} Lens: ${clip(shot.camera.lens)}. Speed: ${clip(shot.camera.speed)}. Ease: ${clip(shot.camera.ease)}. Turn around the subject no more than ${shot.camera.rotationDegrees} degrees.`,
      'LIGHT AND ATMOSPHERE',
      clip(shot.atmosphere),
      'EFFECTS',
      clip(shot.effects),
      'AVOID',
      'No cuts, scene changes, invented people, changes to anything photographed, subject distortion, flicker, watermarks, padding, letterboxing or black bars. Fill the prepared frame edge to edge.',
      'Do not generate typography, marketing copy, business name, logos, new signage or an end-card; Framic adds exact branding and text later.',
      ...(guardrails.length ? [`Business restrictions take precedence over all creative direction: ${guardrails.join('; ')}`] : []),
    ].join('\n')
  }
  // The rules are always sent whole; the director's prose is shortened, field
  // by field, until the brief fits the motion model's limit.
  let detail = 300
  let brief = build(detail)
  while (input.maxLength && brief.length > input.maxLength && detail > 40) {
    detail -= 20
    brief = build(detail)
  }
  return brief
}
