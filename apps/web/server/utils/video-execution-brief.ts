import type { VideoCreativePlan } from './video-plan'
import type { Storyboard } from '../../shared/schemas/storyboard'

// What every motion prompt says about the photographed subject, whoever
// directed the video.
const subjectRules = [
  'Preserve the exact primary subject, people, products, existing signage and environment visible in the frames. The photograph is the visual truth.',
  'Keep the subject identical in every frame: the same make, model, generation, body shape, colour, wheels, lights, badges, proportions and details. Never morph, replace, restyle or swap it for a similar subject.',
  'Show only what the photograph shows. Never reveal or invent a side, angle, interior or part of the subject that is not visible in the frames.',
  'Never draw, write or animate any letters, words, numbers, captions or titles anywhere in the video; the application sets all text afterwards.',
]

type SourceContext = {
  assetDirection?: string
  visualLayout?: string
  verifiedFacts?: string[]
  researchFindings?: string
  researchSources?: string[]
  businessBrain?: string
}

const cameraInstructions: Record<VideoCreativePlan['shot']['camera'], string> = {
  static: 'Locked camera; only natural movement within the scene.',
  slow_push: 'One slow push toward the subject.',
  slow_pull: 'One slow pull away from the subject.',
  // The closing frame is a different crop of the same photograph, so these
  // travel across the photographed view rather than around the subject.
  arc: 'One slow, continuous sideways glide across the photographed view that comes to rest on the subject; never orbit or turn around it.',
  parallax_drift: 'Gentle sideways drift across the photographed view with natural depth; never orbit or turn around the subject.',
  handheld_settle: 'Restrained handheld movement that settles on the subject.',
}

const actionInstructions: Record<VideoCreativePlan['shot']['action'], string> = {
  camera_only: 'Only the camera moves. The subject and everything in the scene stay perfectly still.',
  ambient: 'The subject stays perfectly still in place. Add only the life the photograph already holds: lights or lamps on the subject may switch on, light and reflections may slide across its surfaces, and leaves, clouds, steam or water may move naturally.',
  subject_moves: 'The photographed subject itself moves the way its kind naturally does, slowly and smoothly: a vehicle pulls gently forward or away along the visible ground with its wheels turning, a door or product turns slightly. It remains the very same subject throughout; nothing else enters the frame.',
}

const paceInstructions: Record<VideoCreativePlan['shot']['pacing'], string> = {
  calm: 'Keep the movement calm and unhurried.',
  measured: 'Keep the movement measured.',
  punchy: 'Give the movement a brisk but controlled pace.',
}

// Strategy prose can contain copy, rationale and comparisons with other posts.
// Keep only clauses that direct the photographed subject or its physical motion.
// Quoted words are the post's copy, and a motion model given copy draws it, so
// any clause that quotes text is dropped whole, wherever its full stop falls.
const quotedText = /[“"„«‘][^”"»’]*[”"»’]/g
const quoteMark = /[“”"„«»‘’]/

function visualClauses(value: string | undefined) {
  if (!value) return []
  return value.split(/[;\n]+|\.(?=\s|$)/).map(part => part.trim()).filter(part =>
    part.length > 0
    && !quoteMark.test(part)
    && part.replace(quotedText, '') === part
    && !/\b(because|why|audienc|algorit|engagement|platform|caption|headline|hook|cta|logo|typograph|tipograf|font|copy|marketing|research|other posts|different from|sepse|titull|tekst|shkronj|postim|ndryshe nga)\w*/i.test(part)
    && !/\btext\b/i.test(part),
  )
}

function time(value: number) {
  return `${Number(value.toFixed(1))}s`
}

export function buildVideoExecutionBrief(input: {
  plan: VideoCreativePlan
  sourceContext: SourceContext
  durationSeconds: number
  guardrails?: string[]
  // The motion model's prompt limit in characters, when it has one.
  maxLength?: number
}) {
  const { plan, sourceContext, durationSeconds } = input
  const subjectDirection = visualClauses(sourceContext.assetDirection)
  const layoutDirection = visualClauses(sourceContext.visualLayout)
  let elapsed = 0
  const timeline = plan.timeline.map((beat) => {
    const start = elapsed
    elapsed += beat.weight * durationSeconds
    const action = beat.role === 'body'
      ? 'Continue the same camera movement and natural scene motion.'
      : beat.role === 'endcard'
        ? 'Settle on the real scene; leave a clean frame for the application transition.'
        : beat.role === 'hook'
          ? 'Establish the subject from the supplied first frame.'
          : 'Settle on the subject without adding text or changing scene.'
    return `${time(start)}-${time(elapsed)}: ${action}`
  })
  const anchor = plan.shot.subjectAnchor === 'centre' ? 'centre' : plan.shot.subjectAnchor
  const space = plan.shot.textZone === 'full'
    ? 'Keep the central mobile-safe area clear where the source allows.'
    : `Preserve clean negative space toward the ${plan.shot.textZone} for later application composition.`
  const guardrails = (input.guardrails || []).map(rule => rule.trim()).filter(Boolean)

  const opening = [
    plan.shot.action === 'subject_moves'
      ? `Create one continuous ${durationSeconds}-second video that starts exactly on the supplied first frame, a real photograph.`
      : `Create one continuous ${durationSeconds}-second video that starts exactly on the supplied first frame and ends exactly on the supplied last frame. Both are views of the same real photograph; move smoothly between them.`,
    'SUBJECT',
    ...subjectRules,
  ]
  // The rules sent whole every time, with the strategy's own clauses for
  // this photograph slotted in where they belong.
  const direction = (subject: string[], layout: string[]) => [
    ...subject,
    'ACTION',
    actionInstructions[plan.shot.action],
    'CAMERA',
    cameraInstructions[plan.shot.camera],
    paceInstructions[plan.shot.pacing],
    'COMPOSITION',
    `Keep the subject anchored ${anchor} as the shot evolves. ${space}`,
    ...layout,
    'MOTION',
    'Animate only physically plausible movement supported by the first frame. Preserve subject identity, geometry, material textures, coherent light and reflections.',
    'TIMELINE',
    ...timeline,
    'AVOID',
    'No cuts, scene changes, invented objects or people, subject distortion, abrupt camera moves, flicker, watermarks, padding, letterboxing or black bars. Fill the prepared frame edge to edge.',
    'Do not generate hook or CTA typography, marketing copy, business name, logos, new signage or an end-card. Existing physical text in the source may remain when preserving the scene requires it; Framic adds exact branding and text later.',
    ...(guardrails.length ? [`Business restrictions take precedence over all creative direction: ${guardrails.join('; ')}`] : []),
  ]
  // Background for the strategy's direction, most useful to the motion model
  // first. It is what gives way when the model's prompt limit is reached.
  const context = [
    sourceContext.verifiedFacts?.length
      ? ['VERIFIED BUSINESS FACTS', ...sourceContext.verifiedFacts.map(fact => `- ${fact}`)].join('\n')
      : '',
    sourceContext.businessBrain ? `BUSINESS BRAIN FOR THIS SLOT\n${sourceContext.businessBrain}` : '',
    sourceContext.researchFindings ? `MARKET RESEARCH FINDINGS\n${sourceContext.researchFindings}` : '',
    sourceContext.researchSources?.length
      ? `RESEARCH SOURCES USED BY THE STRATEGY: ${sourceContext.researchSources.join(', ')}`
      : '',
  ].filter(Boolean)
  const limit = input.maxLength
  if (!limit) return [...opening, ...context, ...direction(subjectDirection, layoutDirection)].join('\n')
  // The rules are always sent whole. What the limit leaves is filled, in
  // order of use to the motion model, by the strategy's clauses for this
  // photograph and then the background context, each cut at a line boundary
  // rather than mid-sentence.
  let budget = limit - [...opening, ...direction([], [])].join('\n').length
  const fit = (lines: string[]) => {
    const kept: string[] = []
    for (const line of lines) {
      if (line.length + 1 > budget) break
      kept.push(line)
      budget -= line.length + 1
    }
    return kept
  }
  const subject = fit(subjectDirection)
  const layout = fit(layoutDirection)
  const kept: string[] = []
  for (const block of context) {
    if (block.length + 1 <= budget) {
      kept.push(block)
      budget -= block.length + 1
      continue
    }
    const partial: string[] = []
    for (const line of block.split('\n')) {
      if ([...partial, line].join('\n').length + 1 > budget) break
      partial.push(line)
    }
    // A heading alone carries nothing, so a block cut down to it is dropped.
    if (partial.length > 1) kept.push(partial.join('\n'))
    break
  }
  return [...opening, ...kept, ...direction(subject, layout)].join('\n')
}

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
      `${clip(shot.camera.move)} Lens: ${clip(shot.camera.lens)}. Speed: ${clip(shot.camera.speed)}. Ease: ${clip(shot.camera.ease)}. Turn around the subject no more than ${shot.camera.rotationDegrees} degrees.`,
      'LIGHT AND ATMOSPHERE',
      clip(shot.atmosphere),
      'EFFECTS',
      clip(shot.effects),
      'AVOID',
      'No cuts, scene changes, invented people or objects, subject distortion, flicker, watermarks, padding, letterboxing or black bars. Fill the prepared frame edge to edge.',
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
