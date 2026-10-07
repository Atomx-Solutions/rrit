import type { VideoCreativePlan } from './video-plan'

type SourceContext = {
  assetDirection?: string
  visualLayout?: string
}

const cameraInstructions: Record<VideoCreativePlan['shot']['camera'], string> = {
  static: 'Locked camera; only natural movement within the scene.',
  slow_push: 'One slow push toward the subject.',
  slow_pull: 'One slow pull away from the subject.',
  arc: 'One continuous, restrained arc around the subject.',
  parallax_drift: 'Gentle parallax drift following the real depth of the scene.',
  handheld_settle: 'Restrained handheld movement that settles on the subject.',
}

const paceInstructions: Record<VideoCreativePlan['shot']['pacing'], string> = {
  calm: 'Keep the movement calm and unhurried.',
  measured: 'Keep the movement measured.',
  punchy: 'Give the movement a brisk but controlled pace.',
}

// Strategy prose can contain copy, rationale and comparisons with other posts.
// Keep only clauses that direct the photographed subject or its physical motion.
function visualClauses(value: string | undefined) {
  if (!value) return []
  return value.split(/[.;\n]+/).map(part => part.trim()).filter(part =>
    part.length > 0
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

  return [
    `Create one continuous ${durationSeconds}-second vertical video from the supplied prepared first frame.`,
    'SUBJECT',
    'Preserve the exact primary subject, people, products, existing signage and environment visible in the first frame. The first frame is the visual truth.',
    ...subjectDirection,
    'CAMERA',
    cameraInstructions[plan.shot.camera],
    paceInstructions[plan.shot.pacing],
    'COMPOSITION',
    `Keep the subject anchored ${anchor} as the shot evolves. ${space}`,
    ...layoutDirection,
    'MOTION',
    'Animate only physically plausible movement supported by the first frame. Preserve subject identity, geometry, material textures, coherent light and reflections.',
    'TIMELINE',
    ...timeline,
    'AVOID',
    'No cuts, scene changes, invented objects or people, subject distortion, abrupt camera moves, flicker, watermarks, padding, letterboxing or black bars. Fill the prepared vertical frame edge to edge.',
    'Do not generate hook or CTA typography, marketing copy, business name, logos, new signage or an end-card. Existing physical text in the source may remain when preserving the scene requires it; RRIT adds exact branding and text later.',
    ...(guardrails.length ? [`Business restrictions take precedence over all creative direction: ${guardrails.join('; ')}`] : []),
  ].join('\n')
}
